import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { claimCell } from "./cellStore.js";
import { commands, KEYS, subscriber } from "./redis.js";

interface ClientState {
  alive: boolean;
  windowStarted: number;
  claims: number;
  userId?: string;
  name?: string;
  color?: string;
}

export function parseUser(raw: string | null): { name: string; color: string } {
  if (raw === null) throw new Error("Authenticated user is missing from Redis");
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || !("name" in value)
    || typeof value.name !== "string" || !("color" in value)
    || typeof value.color !== "string") throw new Error("Invalid user record in Redis");
  return { name: value.name, color: value.color };
}

export function attachRealtime(server: ReturnType<typeof createServer>): void {
  const wss = new WebSocketServer({ noServer: true });

  const clients = new Map<WebSocket, ClientState>();

  let leaderboardTimer: NodeJS.Timeout | undefined;

  const broadcast = (message: string): void => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  }

  const broadcastOnline = (): void => broadcast(JSON.stringify({ type: "online", count: wss.clients.size }));
  subscriber.on("message", (channel: string, message: string) => {
    if (channel !== KEYS.events) return;
    try {
      JSON.parse(message);
    } catch (error) {
      console.error("Invalid Redis event:", error); return;
    }
    // Pub/Sub makes every server instance forward each update to its own clients.
    broadcast(message);
  });
  void subscriber.subscribe(KEYS.events).catch((error: unknown) => console.error("Could not subscribe to grid events:", error));

  wss.on("connection", (socket, request) => {
    const state: ClientState = { alive: true, windowStarted: Date.now(), claims: 0 };
    clients.set(socket, state);
    socket.on("pong", () => { state.alive = true; });
    socket.on("close", () => {
      clients.delete(socket);
      if (state.userId) broadcastOnline();
    });
    socket.on("message", async (raw) => {
      try {
        if (!state.userId || !state.name || !state.color) return;
        let message: unknown;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (typeof message !== "object" || message === null || !("type" in message)
          || message.type !== "claim" || !("cellId" in message)
          || typeof message.cellId !== "number" || !Number.isInteger(message.cellId)) return;
        const now = Date.now();
        if (now - state.windowStarted >= 1000) {
          state.windowStarted = now;
          state.claims = 0;
        }
        // express-rate-limit is HTTP-only, so WebSocket claims need a per-socket limit.
        if (++state.claims > 10) {
          socket.send(JSON.stringify({ type: "claim_result", cellId: message.cellId, ok: false, reason: "rate_limited" }));
          return;
        }
        const result = await claimCell(commands, {
          cellId: message.cellId, userId: state.userId, color: state.color,
        });
        if (!result.ok) {
          const ownerName = result.reason === "locked" ? parseUser(await commands.hget(KEYS.users, result.ownerId)).name : undefined;
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
            type: "claim_result", cellId: message.cellId, ok: false, reason: result.reason,
            ownerName, lockedUntil: result.reason === "locked" ? result.lockedUntil : undefined,
          }));
          return;
        }
        const cell = {
          cellId: result.cellId, ownerId: result.ownerId, ownerName: state.name,
          color: result.color, lockedUntil: result.lockedUntil, version: result.version,
        };
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "claim_result", cellId: result.cellId, ok: true, cell }));
        await commands.publish(KEYS.events, JSON.stringify({ type: "cell", ...cell }));

        // Schedule leaderboard update if not already scheduled
        if (!leaderboardTimer) leaderboardTimer = setTimeout(async () => {
          leaderboardTimer = undefined;
          try {
            const scores = await commands.zrevrange(KEYS.leaderboard, 0, 9, "WITHSCORES");
            const rows = Array.from({ length: scores.length / 2 }, (_, index) => ({
              id: scores[index * 2], count: Number(scores[index * 2 + 1]),
            }));
            const users = rows.length ? await commands.hmget(KEYS.users, ...rows.map((row) => row.id)) : [];
            const top = rows.map((row, index) => ({
              ...row, ...parseUser(users[index] ?? null),
            }));
            await commands.publish(KEYS.events, JSON.stringify({ type: "leaderboard", top }));
          } catch (error) {
            console.error("Could not publish leaderboard:", error);
          }
        }, 1000);
      } catch (error) {
        console.error("Could not handle WebSocket message:", error);
      }
    });


    void (async () => {
      // Browsers cannot set WebSocket headers, so the token is sent in the query string.
      const token = new URL(request.url ?? "/", "http://localhost").searchParams.get("token");
      const userId = token ? await commands.hget(KEYS.tokens, token) : null;
      if (!userId) { socket.close(4001, "Invalid token"); return; }
      const user = parseUser(await commands.hget(KEYS.users, userId));
      state.userId = userId; state.name = user.name; state.color = user.color;
      broadcastOnline();
    })().catch((error: unknown) => {
      console.error("Could not authenticate WebSocket:", error); socket.close(1011, "Authentication failed");
    });
  });

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/ws") return socket.destroy();
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request);
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const state = clients.get(socket);
      if (!state) continue;
      if (socket.readyState !== WebSocket.OPEN) { socket.terminate(); continue; }
      if (!state.alive) socket.terminate();
      else {
        state.alive = false;
        socket.ping();
      }
    }
  }, 30_000);
  server.on("close", () => {
    clearInterval(heartbeat);
    if (leaderboardTimer) clearTimeout(leaderboardTimer);
  });
}
