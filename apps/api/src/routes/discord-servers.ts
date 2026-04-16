/**
 * Discord server (multi-tenant) routes.
 *
 * POST /api/v1/servers/:guildId/init            — bot calls on GuildCreate
 * POST /api/v1/servers/:guildId/uninstall       — bot calls on GuildDelete
 * GET  /api/v1/servers/:guildId                 — server detail (admin)
 * PATCH /api/v1/servers/:guildId/config         — update channel mappings (admin)
 * GET  /api/v1/servers/:guildId/config          — read config (internal, backcompat)
 * POST /api/v1/servers/:guildId/admins/verify   — verify + upsert admin via Discord perms
 * GET  /api/v1/servers/:guildId/admins          — list admins (internal)
 * GET  /api/v1/servers/:guildId/channels        — list guild text channels via Discord API
 * POST /api/v1/users/me/primary-server          — set user's primary publish server
 * GET  /api/v1/users/me/servers                 — list user's server memberships
 * GET  /api/v1/bot/guilds                       — bot's guild list from Redis
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";
import { requireJwt } from "../plugins/jwt-auth.js";
import { env } from "../config/env.js";

const DISCORD_API = "https://discord.com/api/v10";
const CHANNEL_CACHE_TTL = 600; // 10 minutes

export async function discordServersRoutes(app: FastifyInstance): Promise<void> {
  // ── Internal-auth routes (bot → API) ─────────────────────────
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    // Bot calls this on GuildCreate
    scope.post<{ Params: { guildId: string } }>("/servers/:guildId/init", async (req, reply) => {
      const { guildId } = req.params;
      const body = z.object({
        guildName: z.string().max(100).optional().nullable(),
        guildIconUrl: z.string().url().optional().nullable(),
        installedByDiscordId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
      }).safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", issues: body.error.issues });
      }

      const server = await prisma.discordServer.upsert({
        where: { discordGuildId: guildId },
        create: {
          discordGuildId: guildId,
          guildName: body.data.guildName ?? null,
          guildIconUrl: body.data.guildIconUrl ?? null,
          installedByDiscordId: body.data.installedByDiscordId ?? null,
          botActive: true,
        },
        update: {
          guildName: body.data.guildName ?? undefined,
          guildIconUrl: body.data.guildIconUrl ?? undefined,
          botActive: true,
          ...(body.data.installedByDiscordId && { installedByDiscordId: body.data.installedByDiscordId }),
        },
      });

      return reply.code(200).send({ server });
    });

    // Bot calls this on GuildDelete
    scope.post<{ Params: { guildId: string } }>("/servers/:guildId/uninstall", async (req, reply) => {
      const { guildId } = req.params;

      const server = await prisma.discordServer.findUnique({
        where: { discordGuildId: guildId },
      });

      if (!server) {
        return reply.code(404).send({ error: "server_not_found" });
      }

      await prisma.discordServer.update({
        where: { id: server.id },
        data: { botActive: false },
      });

      return reply.code(200).send({ uninstalled: true });
    });

    // Backcompat: read config (bot uses this for channel resolution)
    scope.get<{ Params: { guildId: string } }>("/servers/:guildId/config", async (req, reply) => {
      const server = await prisma.discordServer.findUnique({
        where: { discordGuildId: req.params.guildId },
      });

      if (!server) {
        return reply.code(200).send({ config: null });
      }

      return reply.code(200).send({
        config: {
          eventsChannelId: server.eventsChannelId,
          resultsChannelId: server.resultsChannelId,
          guildName: server.guildName,
        },
      });
    });

    // Upsert config (bot /setup command + backcompat)
    scope.post<{ Params: { guildId: string } }>("/servers/:guildId/config", async (req, reply) => {
      const { guildId } = req.params;
      const schema = z.object({
        eventsChannelId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
        resultsChannelId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
        announcementsChannelId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
        resultsWebhookUrl: z.string().url().optional().nullable(),
        guildName: z.string().max(100).optional().nullable(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }

      const server = await prisma.discordServer.upsert({
        where: { discordGuildId: guildId },
        create: {
          discordGuildId: guildId,
          eventsChannelId: parsed.data.eventsChannelId ?? null,
          resultsChannelId: parsed.data.resultsChannelId ?? null,
          announcementsChannelId: parsed.data.announcementsChannelId ?? null,
          resultsWebhookUrl: parsed.data.resultsWebhookUrl ?? null,
          guildName: parsed.data.guildName ?? null,
        },
        update: {
          ...(parsed.data.eventsChannelId !== undefined && { eventsChannelId: parsed.data.eventsChannelId }),
          ...(parsed.data.resultsChannelId !== undefined && { resultsChannelId: parsed.data.resultsChannelId }),
          ...(parsed.data.announcementsChannelId !== undefined && { announcementsChannelId: parsed.data.announcementsChannelId }),
          ...(parsed.data.resultsWebhookUrl !== undefined && { resultsWebhookUrl: parsed.data.resultsWebhookUrl }),
          ...(parsed.data.guildName !== undefined && { guildName: parsed.data.guildName }),
        },
      });

      return reply.code(200).send({ config: server });
    });

    // List admins
    scope.get<{ Params: { guildId: string } }>("/servers/:guildId/admins", async (req, reply) => {
      const server = await prisma.discordServer.findUnique({
        where: { discordGuildId: req.params.guildId },
      });

      if (!server) {
        return reply.code(404).send({ error: "server_not_found" });
      }

      const admins = await prisma.discordServerAdmin.findMany({
        where: { serverId: server.id },
        include: { user: { select: { id: true, discordId: true } } },
      });

      return reply.code(200).send({ admins });
    });

    // All active results channel IDs (for run broadcast)
    scope.get("/servers/results-channels", async (_req, reply) => {
      const servers = await prisma.discordServer.findMany({
        where: { botActive: true, resultsChannelId: { not: null } },
        select: { resultsChannelId: true },
      });

      const channelIds = servers
        .map((s) => s.resultsChannelId)
        .filter((id): id is string => id !== null);

      return reply.code(200).send({ channelIds });
    });

    // Bot's guild cache
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

    // List text channels via Discord API (cached in Redis)
    scope.get<{ Params: { guildId: string } }>("/servers/:guildId/channels", async (req, reply) => {
      const { guildId } = req.params;

      const cacheKey = `discord:channels:${guildId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return reply.code(200).send({ channels: JSON.parse(cached) });
      }

      if (!env.DISCORD_BOT_TOKEN) {
        return reply.code(503).send({ error: "bot_token_not_configured" });
      }

      const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      });

      if (!res.ok) {
        return reply.code(502).send({ error: "discord_api_error", status: res.status });
      }

      const allChannels = (await res.json()) as Array<{ id: string; name: string; type: number; position: number; parent_id: string | null }>;
      const textChannels = allChannels
        .filter((c) => c.type === 0)
        .sort((a, b) => a.position - b.position)
        .map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id }));

      await redis.set(cacheKey, JSON.stringify(textChannels), "EX", CHANNEL_CACHE_TTL);

      return reply.code(200).send({ channels: textChannels });
    });
  });

  // ── JWT-auth routes (web app → API) ──────────────────────────
  app.register(async (scope) => {
    scope.addHook("onRequest", requireJwt);

    // Get server detail (for admin dashboard)
    scope.get<{ Params: { guildId: string } }>("/servers/:guildId", async (req, reply) => {
      const server = await prisma.discordServer.findUnique({
        where: { discordGuildId: req.params.guildId },
        include: {
          _count: { select: { events: true, admins: true, members: true } },
        },
      });

      if (!server) {
        return reply.code(404).send({ error: "server_not_found" });
      }

      return reply.code(200).send({ server });
    });

    // Update config (web admin dashboard)
    scope.patch<{ Params: { guildId: string } }>("/servers/:guildId/config", async (req, reply) => {
      const server = await prisma.discordServer.findUnique({
        where: { discordGuildId: req.params.guildId },
      });

      if (!server) {
        return reply.code(404).send({ error: "server_not_found" });
      }

      const admin = await prisma.discordServerAdmin.findUnique({
        where: { serverId_userId: { serverId: server.id, userId: req.userId! } },
      });

      if (!admin) {
        return reply.code(403).send({ error: "not_server_admin" });
      }

      const schema = z.object({
        eventsChannelId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
        resultsChannelId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
        announcementsChannelId: z.string().regex(/^\d{17,20}$/).optional().nullable(),
        resultsWebhookUrl: z.string().url().optional().nullable(),
        allowPublicEvents: z.boolean().optional(),
        timezone: z.string().max(50).optional().nullable(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }

      const updated = await prisma.discordServer.update({
        where: { id: server.id },
        data: {
          ...(parsed.data.eventsChannelId !== undefined && { eventsChannelId: parsed.data.eventsChannelId }),
          ...(parsed.data.resultsChannelId !== undefined && { resultsChannelId: parsed.data.resultsChannelId }),
          ...(parsed.data.announcementsChannelId !== undefined && { announcementsChannelId: parsed.data.announcementsChannelId }),
          ...(parsed.data.resultsWebhookUrl !== undefined && { resultsWebhookUrl: parsed.data.resultsWebhookUrl }),
          ...(parsed.data.allowPublicEvents !== undefined && { allowPublicEvents: parsed.data.allowPublicEvents }),
          ...(parsed.data.timezone !== undefined && { timezone: parsed.data.timezone }),
        },
      });

      return reply.code(200).send({ server: updated });
    });

    // Verify admin via Discord permissions
    scope.post<{ Params: { guildId: string } }>("/servers/:guildId/admins/verify", async (req, reply) => {
      const body = z.object({
        discordAccessToken: z.string().min(1),
      }).safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const server = await prisma.discordServer.findUnique({
        where: { discordGuildId: req.params.guildId },
      });

      if (!server) {
        return reply.code(404).send({ error: "server_not_found" });
      }

      // Check user's permissions in this guild via Discord API
      const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, {
        headers: { Authorization: `Bearer ${body.data.discordAccessToken}` },
      });

      if (!guildsRes.ok) {
        return reply.code(401).send({ error: "discord_token_invalid" });
      }

      const guilds = (await guildsRes.json()) as Array<{ id: string; permissions: string; owner: boolean }>;
      const match = guilds.find((g) => g.id === req.params.guildId);

      if (!match) {
        return reply.code(403).send({ error: "not_in_guild" });
      }

      // MANAGE_GUILD = 0x20
      const perms = BigInt(match.permissions);
      const isAdmin = match.owner || (perms & BigInt(0x20)) !== BigInt(0);

      if (!isAdmin) {
        return reply.code(403).send({ error: "insufficient_permissions", message: "Requires Manage Server permission." });
      }

      const admin = await prisma.discordServerAdmin.upsert({
        where: { serverId_userId: { serverId: server.id, userId: req.userId! } },
        create: {
          serverId: server.id,
          userId: req.userId!,
          role: match.owner ? "owner" : "admin",
        },
        update: {
          role: match.owner ? "owner" : "admin",
          verifiedAt: new Date(),
        },
      });

      return reply.code(200).send({ admin, verified: true });
    });

    // Set primary publish server
    scope.post("/users/me/primary-server", async (req, reply) => {
      const body = z.object({
        discordGuildId: z.string().regex(/^\d{17,20}$/),
      }).safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const server = await prisma.discordServer.findUnique({
        where: { discordGuildId: body.data.discordGuildId },
      });

      if (!server) {
        return reply.code(404).send({ error: "server_not_found" });
      }

      // Clear any existing primary
      await prisma.discordServerMember.updateMany({
        where: { userId: req.userId!, isPrimary: true },
        data: { isPrimary: false },
      });

      // Upsert membership + set primary
      const membership = await prisma.discordServerMember.upsert({
        where: { serverId_userId: { serverId: server.id, userId: req.userId! } },
        create: { serverId: server.id, userId: req.userId!, isPrimary: true },
        update: { isPrimary: true },
      });

      return reply.code(200).send({ membership });
    });

    // List user's server memberships
    scope.get("/users/me/servers", async (req, reply) => {
      const memberships = await prisma.discordServerMember.findMany({
        where: { userId: req.userId! },
        include: {
          server: {
            select: {
              id: true,
              discordGuildId: true,
              guildName: true,
              guildIconUrl: true,
              botActive: true,
              eventsChannelId: true,
              resultsChannelId: true,
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      });

      return reply.code(200).send({ memberships });
    });
  });
}
