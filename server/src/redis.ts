import Redis from "ioredis";
import { REDIS_URL } from "./config.js";
import { KEYS as CELL_KEYS, registerScripts } from "./cellStore.js";

export const KEYS = {
  ...CELL_KEYS,
  users: "{game}:users",
  tokens: "{game}:tokens",
  events: "{game}:events",
} as const;

export const commands = new Redis(REDIS_URL);
export const subscriber = new Redis(REDIS_URL);

commands.on("error", (error) => console.error("Redis command connection:", error));
subscriber.on("error", (error) => console.error("Redis subscriber connection:", error));

registerScripts(commands);
