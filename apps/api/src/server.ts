/**
 * Fastify bootstrap for the M+ API.
 *
 * Entry point for `npm run dev` (tsx watch) and production `node dist/server.js`.
 */

import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import helmet from "@fastify/helmet";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { registerJwtPlugin } from "./plugins/jwt-auth.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { registerRoutes } from "./routes/register.js";
import { runsRoutes } from "./routes/runs.js";
import { telemetryRoutes } from "./routes/telemetry.js";

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
          : undefined,
    },
    trustProxy: true, // behind Nginx Proxy Manager in prod
  });

  await app.register(helmet);
  await app.register(sensible);
  await registerJwtPlugin(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api/v1" });
  await app.register(registerRoutes, { prefix: "/api/v1" });
  await app.register(runsRoutes, { prefix: "/api/v1" });
  await app.register(telemetryRoutes, { prefix: "/api/v1" });

  // Future routes plug in here:
  // await app.register(authRoutes, { prefix: "/api/v1/auth" });
  // await app.register(eventsRoutes, { prefix: "/api/v1/events" });
  // await app.register(leaderboardsRoutes, { prefix: "/api/v1/leaderboards" });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });

  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
    app.log.info(`M+ API listening on ${env.API_HOST}:${env.API_PORT} (${env.NODE_ENV})`);
  } catch (err) {
    app.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

void main();
