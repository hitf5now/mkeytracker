/**
 * Health check routes.
 *
 * - GET /health        — liveness (process is up)
 * - GET /health/ready  — readiness (DB reachable)
 * - GET /health/env    — non-secret env visibility (dev only)
 *
 * Used by docker healthchecks, Nginx Proxy Manager, and uptime monitoring.
 */

import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/ready", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ready", db: "ok" };
    } catch (err) {
      app.log.error({ err }, "Readiness check failed");
      return reply.code(503).send({ status: "not_ready", db: "error" });
    }
  });

  // Dev-only: reports whether non-secret feature env vars are populated.
  // Reports presence/length but never the actual secret values.
  if (env.NODE_ENV === "development") {
    app.get("/health/env", async () => ({
      NODE_ENV: env.NODE_ENV,
      DISCORD_BOT_TOKEN: env.DISCORD_BOT_TOKEN ? "set" : "empty",
      DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID ?? "empty",
      DISCORD_GUILD_ID: env.DISCORD_GUILD_ID ?? "empty",
    }));
  }
}
