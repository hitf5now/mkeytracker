/**
 * Singleton Redis client.
 *
 * Used for:
 *   - Short-lived pairing codes for the companion app link flow
 *   - Weekly leaderboard sorted sets (future sprint)
 *   - BullMQ job queue (future sprint)
 *
 * One connection shared across the process. Graceful shutdown is
 * wired up in server.ts via `onClose`.
 */

import { Redis } from "ioredis";
import { env } from "../config/env.js";

declare global {
  // eslint-disable-next-line no-var
  var __mplusRedis: Redis | undefined;
}

function createClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    enableOfflineQueue: true,
  });

  client.on("error", (err) => {
    // ioredis emits this aggressively on startup — log but don't crash
    console.error("[redis] error:", err.message);
  });

  return client;
}

export const redis: Redis = globalThis.__mplusRedis ?? createClient();

if (env.NODE_ENV !== "production") {
  globalThis.__mplusRedis = redis;
}
