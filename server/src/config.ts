export const PORT = Number(process.env.PORT ?? 3000);
export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
export const STATIC_DIR = process.env.STATIC_DIR;
export const GRID_SIZE = 40;
export const LOCK_MS = 10_000;
