// End-to-end tests against a RUNNING server (start Redis + the server first).
// They only use the public API (HTTP + WebSocket), never import server code,
// so they test exactly what a browser would experience.
//
// Note: POST /api/join is rate limited to 10/min per IP. This file makes 5 join
// requests, so running it twice within a minute can hit the limit.
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE_URL = process.env.TEST_SERVER_URL ?? "http://localhost:3000";
const WS_URL = BASE_URL.replace(/^http/, "ws") + "/ws";

const serverAvailable = await fetch(`${BASE_URL}/api/leaderboard`)
  .then((response) => response.ok)
  .catch(() => false);

if (!serverAvailable) {
  console.warn(`\n⚠️  Skipping API tests: server not reachable at ${BASE_URL}\n`);
}

type Message = { type: string; [key: string]: any };
type TestSocket = {
  socket: WebSocket;
  send: (data: unknown) => void;
  waitFor: (match: (message: Message) => boolean, timeoutMs?: number) => Promise<Message>;
};

const openSockets: WebSocket[] = [];

async function join(name: string, color: string) {
  const response = await fetch(`${BASE_URL}/api/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  if (response.status === 429) throw new Error("Join rate limit hit. Wait a minute and re-run.");
  return { status: response.status, body: await response.json() };
}

// Opens a socket and records every message, so tests can wait for a specific one
// even if it arrived before they started waiting.
function connect(token: string): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_URL}?token=${token}`);
    const received: Message[] = [];
    const waiters: { match: (m: Message) => boolean; resolve: (m: Message) => void }[] = [];
    openSockets.push(socket);

    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Message;
      received.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.match(message)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    socket.on("error", reject);
    socket.on("open", () =>
      resolve({
        socket,
        send: (data) => socket.send(typeof data === "string" ? data : JSON.stringify(data)),
        waitFor: (match, timeoutMs = 3000) => {
          const earlier = received.find(match);
          if (earlier) return Promise.resolve(earlier);
          return new Promise((resolveWait, rejectWait) => {
            const waiter = { match, resolve: resolveWait };
            waiters.push(waiter);
            setTimeout(() => rejectWait(new Error("Timed out waiting for message")), timeoutMs);
          });
        },
      })
    );
  });
}

// Picks random cells that are not currently locked, so tests don't collide with
// cells claimed by earlier test runs.
async function pickFreeCells(count: number): Promise<number[]> {
  const grid = await (await fetch(`${BASE_URL}/api/grid`)).json();
  const locked = new Set(
    grid.cells
      .filter((cell: { lockedUntil: number }) => cell.lockedUntil > grid.serverTime)
      .map((cell: { cellId: number }) => cell.cellId)
  );
  const free = Array.from({ length: grid.gridSize * grid.gridSize }, (_, id) => id).filter((id) => !locked.has(id));
  return free.sort(() => Math.random() - 0.5).slice(0, count);
}

const isClaimResult = (cellId: number) => (m: Message) => m.type === "claim_result" && m.cellId === cellId;

describe.skipIf(!serverAvailable)("REST API", () => {
  it("rejects a name that is too short", async () => {
    const { status } = await join("a", "#ff0000");
    expect(status).toBe(400);
  });

  it("rejects an invalid color", async () => {
    const { status } = await join("Ankur", "red");
    expect(status).toBe(400);
  });

  it("trims the name and returns a user with a token", async () => {
    const { status, body } = await join("  Ankur  ", "#ff0000");
    expect(status).toBe(201);
    expect(body.user.name).toBe("Ankur");
    expect(typeof body.token).toBe("string");
  });

  it("returns the grid with its settings and a version", async () => {
    const grid = await (await fetch(`${BASE_URL}/api/grid`)).json();
    expect(grid.gridSize).toBe(40);
    expect(grid.lockMs).toBe(10_000);
    expect(typeof grid.version).toBe("number");
    expect(typeof grid.serverTime).toBe("number");
    expect(Array.isArray(grid.cells)).toBe(true);
  });
});

describe.skipIf(!serverAvailable)("WebSocket", () => {
  let ankur: { user: { id: string; name: string }; token: string };
  let rahul: { user: { id: string; name: string }; token: string };

  beforeAll(async () => {
    ankur = (await join("Ankur", "#ff0000")).body;
    rahul = (await join("Rahul", "#00aaff")).body;
  });

  afterAll(() => {
    for (const socket of openSockets) socket.close();
  });

  it("closes the connection with code 4001 for an unknown token", async () => {
    const socket = new WebSocket(`${WS_URL}?token=not-a-real-token`);
    openSockets.push(socket);
    const code = await new Promise<number>((resolve) => socket.on("close", resolve));
    expect(code).toBe(4001);
  });

  it("confirms a claim to the claimer and broadcasts it to everyone else", async () => {
    const [cellId] = await pickFreeCells(1);
    const claimer = await connect(ankur.token);
    const watcher = await connect(rahul.token);

    claimer.send({ type: "claim", cellId });

    const result = await claimer.waitFor(isClaimResult(cellId));
    expect(result.ok).toBe(true);

    const broadcast = await watcher.waitFor((m) => m.type === "cell" && m.cellId === cellId);
    expect(broadcast.ownerId).toBe(ankur.user.id);
    expect(broadcast.ownerName).toBe("Ankur");
    expect(typeof broadcast.version).toBe("number");

    // The REST grid agrees with what was broadcast.
    const grid = await (await fetch(`${BASE_URL}/api/grid`)).json();
    const stored = grid.cells.find((cell: { cellId: number }) => cell.cellId === cellId);
    expect(stored.ownerId).toBe(ankur.user.id);
  });

  it("rejects a claim on a locked cell with the owner's name", async () => {
    const [cellId] = await pickFreeCells(1);
    const first = await connect(ankur.token);
    const second = await connect(rahul.token);

    first.send({ type: "claim", cellId });
    await first.waitFor(isClaimResult(cellId));
    second.send({ type: "claim", cellId });

    const result = await second.waitFor(isClaimResult(cellId));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("locked");
    expect(result.ownerName).toBe("Ankur");
    expect(result.lockedUntil).toBeGreaterThan(Date.now() - 5000);
  });

  it("lets exactly one of many simultaneous claims win", async () => {
    const [cellId] = await pickFreeCells(1);
    // 6 sockets (3 per user), 5 claims each = 30 claims at once, under the rate limit.
    const sockets = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => connect(i % 2 ? rahul.token : ankur.token)));

    for (const socket of sockets) {
      for (let i = 0; i < 5; i++) socket.send({ type: "claim", cellId });
    }

    // Each socket gets 5 results; collect them all.
    const results = await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<Message[]>((resolve) => {
            const mine: Message[] = [];
            socket.socket.on("message", (raw) => {
              const message = JSON.parse(raw.toString());
              if (message.type === "claim_result" && message.cellId === cellId) mine.push(message);
              if (mine.length === 5) resolve(mine);
            });
          })
      )
    ).then((perSocket) => perSocket.flat());

    expect(results).toHaveLength(30);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "locked")).toHaveLength(29);
  });

  it("rate limits a socket that sends more than 10 claims in a second", async () => {
    const cells = await pickFreeCells(15);
    const spammer = await connect(ankur.token);

    for (const cellId of cells) spammer.send({ type: "claim", cellId });
    const results = await Promise.all(cells.map((cellId) => spammer.waitFor(isClaimResult(cellId))));

    expect(results.filter((r) => r.reason === "rate_limited").length).toBeGreaterThan(0);
  });

  it("answers invalid_cell for a cell outside the grid", async () => {
    const client = await connect(ankur.token);
    client.send({ type: "claim", cellId: 99999 });
    const result = await client.waitFor(isClaimResult(99999));
    expect(result.reason).toBe("invalid_cell");
  });

  it("ignores garbage messages without closing the connection", async () => {
    const client = await connect(ankur.token);
    client.send("this is not json");
    client.send({ type: "claim", cellId: "abc" });
    client.send({ type: "something-else" });

    // The connection still works afterwards.
    const [cellId] = await pickFreeCells(1);
    client.send({ type: "claim", cellId });
    const result = await client.waitFor(isClaimResult(cellId));
    expect(result.ok).toBe(true);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });
});
