import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { body, matchedData, validationResult } from "express-validator";
import { v4 as uuidv4 } from "uuid";
import { GRID_SIZE, LOCK_MS } from "./config.js";
import { parseCellValue } from "./cellStore.js";
import { commands, KEYS } from "./redis.js";
import { parseUser } from "./realtime.js";

interface UserInfo {
  name: string;
  color: string;
}


async function getUsers(ids: string[]): Promise<Record<string, UserInfo>> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return {};
  const values = await commands.hmget(KEYS.users, ...uniqueIds);
  const users: Record<string, UserInfo> = {};
  uniqueIds.forEach((id, index) => {
    users[id] = parseUser(values[index]);
  });
  return users;
}

const router = Router();
const joinLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  handler: (_request, response) =>
    response.status(429).json({ error: "Too many requests, please try again later." }),
});
const apiLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  handler: (_request, response) =>
    response.status(429).json({ error: "Too many requests, please try again later." }),
});

router.post(
  "/join",
  joinLimit,
  body("name")
    .trim()
    .isLength({ min: 2, max: 20 })
    .withMessage("Name must be 2–20 characters")
    .matches(/^[A-Za-z0-9 _-]+$/)
    .withMessage("Name contains unsupported characters"),
  body("color").matches(/^#[0-9a-fA-F]{6}$/).withMessage("Color must be #rrggbb format"),
  async (request, response) => {
    const errors = validationResult(request);
    if (!errors.isEmpty()) {
      response.status(400).json({ errors: errors.array() });
      return;
    }

    // Do not escape names: React escapes text when it renders it.
    const { name, color } = matchedData<{ name: string; color: string }>(request);
    const user = {
      id: uuidv4(),
      name,
      color: color.toLowerCase(),
    };
    const token = uuidv4();
    const result = await commands
      .multi()
      .hset(KEYS.users, user.id, JSON.stringify({ name: user.name, color: user.color }))
      .hset(KEYS.tokens, token, user.id)
      .exec();
    if (result === null) throw new Error("Redis did not execute the join transaction");
    for (const [error] of result) {
      if (error) throw error;
    }
    response.status(201).json({ user, token });
  }
);

router.use(apiLimit);

router.get("/grid", async (_request, response) => {
  const result = await commands
    .multi()
    .get(KEYS.version)
    .hgetall(KEYS.grid)
    .time()
    .exec();
  if (result === null) throw new Error("Redis did not execute the grid snapshot");

  const [versionReply, gridReply, timeReply] = result;
  
  if (versionReply[0]) throw versionReply[0];
  // versionReply[1] = the value of the version key in Redis
  if (gridReply[0]) throw gridReply[0];
  // gridReply[1] = { cellId: cellValue, ... }
  if (timeReply[0]) throw timeReply[0];
  // timeReply[1] = [seconds, microseconds] from Redis TIME command

  const version = Number(versionReply[1] ?? 0);
  const rawCells = gridReply[1] as Record<string, string>;
  const redisTime = timeReply[1] as [string, string];

  const cells = Object.entries(rawCells).flatMap(([id, raw]) => {
    // id = the cell ID as a string
    // raw = the raw cell value from Redis
    
    const cell = parseCellValue(raw);
    return cell ? [{ cellId: Number(id), ...cell }] : [];
  });
  // cells = [{ cellId, ownerId, ownerName, color, lockedUntil, version }, ...]

  const users = await getUsers(cells.map((cell) => cell.ownerId));
  response.json({
    gridSize: GRID_SIZE,
    lockMs: LOCK_MS,
    serverTime: Number(redisTime[0]) * 1000 + Math.floor(Number(redisTime[1]) / 1000),
    version,
    cells,
    users,
  });
});

router.get("/leaderboard", async (_request, response) => {
  const scores = await commands.zrevrange(KEYS.leaderboard, 0, 9, "WITHSCORES");
  const rows = Array.from({ length: scores.length / 2 }, (_, index) => ({
    id: scores[index * 2],
    count: Number(scores[index * 2 + 1]),
  }));
  const users = await getUsers(rows.map((row) => row.id));
  response.json(
    rows.map((row) => ({ ...row, ...users[row.id] }))
  );
});

export default router;
