/**
 * Guild configuration routes.
 *
 * POST /api/v1/guilds/:guildId/config  — upsert guild config (internal auth)
 * GET  /api/v1/guilds/:guildId/config  — read guild config (internal auth)
 * GET  /api/v1/bot/guilds              — read bot's guild list from Redis (internal auth)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";

export async function guildsRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    // ── Upsert guild config ──────────────────────────────────────
    scope.post<{ Params: { guildId: string } }>("/guilds/:guildId/config", async (req, reply) => {
      const { guildId } = req.params;
      const schema = z.object({
        eventsChannelId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
        guildName: z.string().max(100).optional().nullable(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }

      const config = await prisma.guildConfig.upsert({
        where: { discordGuildId: guildId },
        create: {
          discordGuildId: guildId,
          eventsChannelId: parsed.data.eventsChannelId ?? null,
          guildName: parsed.data.guildName ?? null,
        },
        update: {
          ...(parsed.data.eventsChannelId !== undefined && { eventsChannelId: parsed.data.eventsChannelId }),
          ...(parsed.data.guildName !== undefined && { guildName: parsed.data.guildName }),
        },
      });

      return reply.code(200).send({ config });
    });

    // ── Read guild config ────────────────────────────────────────
    scope.get<{ Params: { guildId: string } }>("/guilds/:guildId/config", async (req, reply) => {
      const config = await prisma.guildConfig.findUnique({
        where: { discordGuildId: req.params.guildId },
      });

      if (!config) {
        return reply.code(200).send({ config: null });
      }

      return reply.code(200).send({ config });
    });

    // ── Bot's guild list (cached in Redis by the bot) ────────────
    scope.get("/bot/guilds", async (_req, reply) => {
      const raw = await redis.get("bot:guilds");
      if (!raw) {
        return reply.code(200).send({ guilds: [] });
      }

      try {
        const guilds = JSON.parse(raw) as Array<{ id: string; name: string; icon: string | null }>;
        return reply.code(200).send({ guilds });
      } catch {
        return reply.code(200).send({ guilds: [] });
      }
    });
  });
}
