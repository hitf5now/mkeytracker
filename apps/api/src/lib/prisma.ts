/**
 * Singleton Prisma client.
 *
 * Exported as `prisma` so all routes and services share one connection pool.
 * In dev with `tsx watch`, we attach to globalThis to survive HMR without
 * exhausting connections.
 */

import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

declare global {
  // eslint-disable-next-line no-var
  var __mplusPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__mplusPrisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (env.NODE_ENV !== "production") {
  globalThis.__mplusPrisma = prisma;
}
