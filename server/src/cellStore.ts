import Redis, { type Result } from "ioredis";
import { GRID_SIZE, LOCK_MS } from "./config.js";

// ---------------------------------------------------------------------------
// Config & keys
// ---------------------------------------------------------------------------

// The {game} hash tag keeps all keys on the same Redis Cluster slot,
// which a Lua script requires when it touches multiple keys.
export const KEYS = {
  grid: "{game}:grid", // HASH   cellId -> "ownerId|color|lockedUntil"
  leaderboard: "{game}:leaderboard", // ZSET   userId -> cells owned
  version: "{game}:version", // STRING global monotonic version
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CellState {
  ownerId: string;
  color: string;
  lockedUntil: number; // epoch ms, from Redis's clock
}

export interface ClaimInput {
  cellId: number;
  userId: string; // server-assigned from the token, never from the client
  color: string; // "#rrggbb"
}

export type ClaimResult =
  | {
      ok: true;
      cellId: number;
      ownerId: string;
      color: string;
      lockedUntil: number;
      version: number;
      previousOwnerId: string | null;
    }
  | {
      ok: false;
      reason: "locked";
      cellId: number;
      ownerId: string;
      color: string;
      lockedUntil: number;
    }
  | { ok: false; reason: "invalid_cell" | "invalid_color" };

// ---------------------------------------------------------------------------
// Lua: check lock + write cell + leaderboard + version, atomically
// ---------------------------------------------------------------------------

const CLAIM_SCRIPT = `
local gridKey, lbKey, verKey = KEYS[1], KEYS[2], KEYS[3]
local cellId, userId, color = ARGV[1], ARGV[2], ARGV[3]
local lockMs = tonumber(ARGV[4])

-- One clock for every server instance: Redis's own.
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local prevOwner = false
local cur = redis.call('HGET', gridKey, cellId)
if cur then
  local owner, ownerColor, lockedUntil = string.match(cur, '^([^|]*)|([^|]*)|(%d+)$')
  if owner and tonumber(lockedUntil) > now then
    return {0, owner, ownerColor, lockedUntil}
  end
  prevOwner = owner
end

local lockedUntil = now + lockMs
redis.call('HSET', gridKey, cellId, userId .. '|' .. color .. '|' .. lockedUntil)

-- Leaderboard only changes when ownership actually changes hands.
if prevOwner ~= userId then
  if prevOwner then
    local left = redis.call('ZINCRBY', lbKey, -1, prevOwner)
    if tonumber(left) <= 0 then redis.call('ZREM', lbKey, prevOwner) end
  end
  redis.call('ZINCRBY', lbKey, 1, userId)
end

local version = redis.call('INCR', verKey)
return {1, version, lockedUntil, prevOwner or ''}
`;

// Typed custom command so redis.claimCell(...) type-checks.
declare module "ioredis" {
  interface RedisCommander<Context> {
    claimCell(
      gridKey: string,
      leaderboardKey: string,
      versionKey: string,
      cellId: string,
      userId: string,
      color: string,
      lockMs: string
    ): Result<(string | number)[], Context>;
  }
}

/** Call once per Redis connection at startup. ioredis caches the script
 *  by SHA and uses EVALSHA after the first call. */
export function registerScripts(redis: Redis): void {
  redis.defineCommand("claimCell", { numberOfKeys: 3, lua: CLAIM_SCRIPT });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// "|" is our field delimiter; ids must never contain it.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isValidCellId(cellId: number): boolean {
  return Number.isInteger(cellId) && cellId >= 0 && cellId < GRID_SIZE * GRID_SIZE;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function claimCell(redis: Redis, input: ClaimInput): Promise<ClaimResult> {
  const { cellId, userId, color } = input;

  // Client-controlled input -> soft rejection.
  if (!isValidCellId(cellId)) return { ok: false, reason: "invalid_cell" };
  if (!COLOR_RE.test(color)) return { ok: false, reason: "invalid_color" };
  // Server-controlled input -> a bad value is a bug, so fail loudly.
  if (!USER_ID_RE.test(userId)) throw new Error(`Invalid userId: ${userId}`);

  const reply = await redis.claimCell(
    KEYS.grid,
    KEYS.leaderboard,
    KEYS.version,
    String(cellId),
    userId,
    color.toLowerCase(),
    String(LOCK_MS)
  );
  // reply = [success, version, lockedUntil, previousOwnerId]

  if (Number(reply[0]) === 1) {
    const prev = String(reply[3]);
    return {
      ok: true,
      cellId,
      ownerId: userId,
      color: color.toLowerCase(),
      version: Number(reply[1]),
      lockedUntil: Number(reply[2]),
      previousOwnerId: prev === "" ? null : prev,
    };
  }

  return {
    ok: false,
    reason: "locked",
    cellId,
    ownerId: String(reply[1]),
    color: String(reply[2]),
    lockedUntil: Number(reply[3]),
  };
}

/** Parses a raw grid hash value. Reused when building the connect snapshot. */
export function parseCellValue(raw: string): CellState | null {
  // raw = "ownerId|color|lockedUntil"

  const [ownerId, color, lockedUntil] = raw.split("|");
  if (!ownerId || !color || !lockedUntil) return null;
  return { ownerId, color, lockedUntil: Number(lockedUntil) };
}
