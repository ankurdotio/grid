// Tests the atomic claim logic directly against Redis.
// Uses Redis database 15 so it never touches the real game data (database 0).
import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { claimCell, registerScripts, KEYS, parseCellValue } from "../src/cellStore.js";
import { GRID_SIZE, LOCK_MS } from "../src/config.js";

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";

// Two separate connections, like two server instances talking to the same Redis.
const redisA = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
const redisB = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });

const redisAvailable = await Promise.all([redisA.connect(), redisB.connect()])
  .then(() => true)
  .catch(() => false);

if (!redisAvailable) {
  console.warn(`\n⚠️  Skipping cellStore tests: Redis not reachable at ${REDIS_URL}\n`);
}

describe.skipIf(!redisAvailable)("claimCell", () => {
  registerScripts(redisA);
  registerScripts(redisB);

  beforeEach(async () => {
    await redisA.flushdb();
  });

  afterAll(() => {
    redisA.disconnect();
    redisB.disconnect();
  });

  // Makes a cell's lock expire immediately, so we don't have to wait 10 seconds.
  async function expireLock(cellId: number) {
    const cell = parseCellValue((await redisA.hget(KEYS.grid, String(cellId)))!)!;
    await redisA.hset(KEYS.grid, String(cellId), `${cell.ownerId}|${cell.color}|1`);
  }

  it("lets exactly one of 50 simultaneous claims on the same cell win", async () => {
    const claims = Array.from({ length: 50 }, (_, i) =>
      claimCell(i % 2 === 0 ? redisA : redisB, { cellId: 7, userId: `user${i}`, color: "#ff0000" })
    );
    const results = await Promise.all(claims);

    const winners = results.filter((r) => r.ok);
    const lockedRejections = results.filter((r) => !r.ok && r.reason === "locked");
    expect(winners).toHaveLength(1);
    expect(lockedRejections).toHaveLength(49);

    // Redis agrees with the winner, and the leaderboard has exactly one point.
    const winner = winners[0] as Extract<typeof winners[0], { ok: true }>;
    const stored = parseCellValue((await redisA.hget(KEYS.grid, "7"))!);
    expect(stored?.ownerId).toBe(winner.ownerId);
    expect(await redisA.zrange(KEYS.leaderboard, 0, -1, "WITHSCORES")).toEqual([winner.ownerId, "1"]);
  });

  it("rejects a claim on a locked cell and says who owns it until when", async () => {
    await claimCell(redisA, { cellId: 1, userId: "ankur", color: "#ff0000" });
    const result = await claimCell(redisB, { cellId: 1, userId: "rahul", color: "#00ff00" });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "locked") {
      expect(result.ownerId).toBe("ankur");
      expect(result.lockedUntil).toBeGreaterThan(Date.now());
    }
  });

  it("locks the cell for LOCK_MS, measured with Redis's own clock", async () => {
    const result = await claimCell(redisA, { cellId: 2, userId: "ankur", color: "#ff0000" });
    const [seconds, micros] = await redisA.time();
    const redisNow = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const remaining = result.lockedUntil - redisNow;
      expect(remaining).toBeGreaterThan(LOCK_MS - 1000);
      expect(remaining).toBeLessThanOrEqual(LOCK_MS);
    }
  });

  it("lets another user steal the cell after the lock expires and moves the leaderboard point", async () => {
    await claimCell(redisA, { cellId: 3, userId: "ankur", color: "#ff0000" });
    await expireLock(3);

    const steal = await claimCell(redisB, { cellId: 3, userId: "rahul", color: "#00ff00" });

    expect(steal.ok).toBe(true);
    if (steal.ok) expect(steal.previousOwnerId).toBe("ankur");
    // Ankur dropped to 0, so he is removed from the leaderboard entirely.
    expect(await redisA.zrange(KEYS.leaderboard, 0, -1, "WITHSCORES")).toEqual(["rahul", "1"]);
  });

  it("re-locks your own cell after expiry without changing your score", async () => {
    await claimCell(redisA, { cellId: 4, userId: "ankur", color: "#ff0000" });
    await expireLock(4);

    const reclaim = await claimCell(redisA, { cellId: 4, userId: "ankur", color: "#ff0000" });

    expect(reclaim.ok).toBe(true);
    expect(await redisA.zscore(KEYS.leaderboard, "ankur")).toBe("1");
  });

  it("increments the version only on successful claims", async () => {
    const first = await claimCell(redisA, { cellId: 5, userId: "ankur", color: "#ff0000" });
    await claimCell(redisA, { cellId: 5, userId: "rahul", color: "#00ff00" }); // rejected: locked
    const second = await claimCell(redisA, { cellId: 6, userId: "rahul", color: "#00ff00" });

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.version).toBe(first.version + 1);
    expect(await redisA.get(KEYS.version)).toBe("2");
  });

  it("rejects cell ids outside the grid", async () => {
    for (const cellId of [-1, GRID_SIZE * GRID_SIZE, 1.5]) {
      const result = await claimCell(redisA, { cellId, userId: "ankur", color: "#ff0000" });
      expect(result).toEqual({ ok: false, reason: "invalid_cell" });
    }
    expect(await redisA.hlen(KEYS.grid)).toBe(0);
  });

  it("rejects colors that aren't #rrggbb, so they can't break the stored format", async () => {
    for (const color of ["red", "#fff", "#ff0000|evil"]) {
      const result = await claimCell(redisA, { cellId: 9, userId: "ankur", color });
      expect(result).toEqual({ ok: false, reason: "invalid_color" });
    }
  });
});
