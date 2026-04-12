/**
 * Events API routes.
 *
 * POST   /events              — create a new event (internal auth)
 * GET    /events              — list active/upcoming events (public)
 * GET    /events/:id          — event detail + signups + teams (public)
 * POST   /events/:id/signup   — sign up for an event (internal auth, bot forwards)
 * POST   /events/:id/close-signups — lock signups + trigger matchmaking (internal)
 * POST   /events/:id/start    — mark event in_progress (internal)
 * POST   /events/:id/complete — mark event completed (internal)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";
import { assignTeams, type SignupForMatching } from "../services/matchmaking.js";

const CreateEventSchema = z.object({
  name: z.string().min(3).max(100),
  type: z.enum(["fastest_clear_race", "speed_sprint", "random_draft"]).default("fastest_clear_race"),
  dungeonSlug: z.string().optional(),
  minKeyLevel: z.number().int().min(2).max(40).default(2),
  maxKeyLevel: z.number().int().min(2).max(40).default(40),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  signupClosesAt: z.string().datetime({ offset: true }).optional(),
  description: z.string().max(1000).optional(),
  createdByDiscordId: z.string().regex(/^\d{17,20}$/),
  discordGuildId: z.string().regex(/^\d{17,20}$/).optional(),
});

const SignupSchema = z.object({
  discordId: z.string().regex(/^\d{17,20}$/),
  characterName: z.string().min(2).max(12),
  characterRealm: z.string().min(1).max(50),
  characterRegion: z.enum(["us", "eu", "kr", "tw", "cn"]),
  rolePreference: z.enum(["tank", "healer", "dps"]),
  signupStatus: z.enum(["confirmed", "tentative"]).default("confirmed"),
  spec: z.string().max(30).optional(),
  characterClass: z.string().max(30).optional(),
});

/** Shared matchmaking logic used by close-signups (autoAssign) and assign-teams */
async function runMatchmaking(eventId: number, req: { log: { info: (...args: unknown[]) => void } }) {
  const signups = await prisma.eventSignup.findMany({
    where: { eventId, signupStatus: "confirmed" },
    include: { character: true },
  });

  if (signups.length < 5) {
    throw { statusCode: 409, error: "not_enough_signups", message: `Need at least 5 confirmed signups. Currently ${signups.length}.` };
  }

  const pool: SignupForMatching[] = signups.map((s) => ({
    signupId: s.id,
    userId: s.userId,
    characterId: s.characterId,
    rolePreference: s.rolePreference as "tank" | "healer" | "dps",
    characterName: s.character.name,
    realm: s.character.realm,
    hasCompanionApp: s.character.hasCompanionApp,
  }));

  const result = assignTeams(pool);

  await prisma.$transaction(async (tx) => {
    for (const team of result.teams) {
      const created = await tx.eventTeam.create({
        data: { eventId, name: team.name, status: "assigned" },
      });
      for (const member of team.members) {
        await tx.eventSignup.update({
          where: { id: member.signupId },
          data: { teamId: created.id },
        });
      }
    }
    await tx.event.update({
      where: { id: eventId },
      data: { status: "signups_closed" },
    });
  });

  req.log.info(
    { eventId, teams: result.stats.teamsFormed, benched: result.stats.benchedCount },
    "Teams assigned",
  );

  return {
    teams: result.teams.map((t) => ({
      name: t.name,
      members: t.members.map((m) => ({
        characterName: m.characterName,
        realm: m.realm,
        role: m.rolePreference,
      })),
    })),
    benched: result.benched.map((b) => ({
      characterName: b.characterName,
      realm: b.realm,
      role: b.rolePreference,
    })),
    stats: result.stats,
  };
}

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  // ── Create event (internal auth) ────────────────────────────
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    scope.post("/events", async (req, reply) => {
      const parsed = CreateEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const body = parsed.data;

      const season = await prisma.season.findFirst({ where: { isActive: true } });
      if (!season) return reply.code(500).send({ error: "no_active_season" });

      const creator = await prisma.user.findUnique({ where: { discordId: body.createdByDiscordId } });
      if (!creator) return reply.code(404).send({ error: "creator_not_registered" });

      let dungeonId: number | null = null;
      if (body.dungeonSlug) {
        const dungeon = await prisma.dungeon.findFirst({
          where: { seasonId: season.id, slug: body.dungeonSlug },
        });
        if (!dungeon) return reply.code(404).send({ error: "dungeon_not_found", message: `No dungeon with slug "${body.dungeonSlug}" in current season.` });
        dungeonId = dungeon.id;
      }

      const event = await prisma.event.create({
        data: {
          name: body.name,
          type: body.type,
          status: "open",
          seasonId: season.id,
          dungeonId,
          minKeyLevel: body.minKeyLevel,
          maxKeyLevel: body.maxKeyLevel,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          signupClosesAt: body.signupClosesAt ? new Date(body.signupClosesAt) : null,
          description: body.description,
          createdByUserId: creator.id,
          discordGuildId: body.discordGuildId ?? null,
        },
      });

      req.log.info({ eventId: event.id, name: event.name }, "Event created");

      // Notify the bot via Redis pub/sub so it can post the embed to Discord
      redis.publish(
        "mplus:bot-notifications",
        JSON.stringify({ type: "event_created", eventId: event.id }),
      ).catch((err) => req.log.error({ err }, "Failed to publish event_created notification"));

      return reply.code(201).send({ event });
    });

    // ── Signup (internal auth, bot forwards user's Discord ID) ──
    scope.post<{ Params: { id: string } }>("/events/:id/signup", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const parsed = SignupSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const body = parsed.data;

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: "event_not_found" });
      if (event.status !== "open") {
        return reply.code(409).send({ error: "event_not_open", message: `Event is ${event.status}, not accepting signups.` });
      }

      // Upsert user — auto-create if they don't have a User row yet.
      // This enables manual signups from users who haven't run /register.
      const user = await prisma.user.upsert({
        where: { discordId: body.discordId },
        create: { discordId: body.discordId },
        update: {},
      });

      // Find or create the character. For manual signups via RaiderIO,
      // the character may not exist in our DB yet.
      let character = await prisma.character.findUnique({
        where: {
          region_realm_name: {
            region: body.characterRegion,
            realm: body.characterRealm,
            name: body.characterName,
          },
        },
      });

      if (!character) {
        // Auto-create the character — RaiderIO already validated it exists.
        // Class/spec/role come from the bot's RaiderIO lookup or from the
        // signup payload. If unknown, store defaults.
        character = await prisma.character.create({
          data: {
            name: body.characterName,
            realm: body.characterRealm,
            region: body.characterRegion,
            class: body.characterClass ?? "unknown",
            spec: body.spec ?? "Unknown",
            role: body.rolePreference,
            userId: user.id,
            claimedAt: new Date(),
          },
        });
        req.log.info(
          { characterId: character.id, name: character.name, userId: user.id },
          "Auto-created character from event signup",
        );
      } else if (character.userId === null) {
        // Unclaimed character — claim it for this user
        await prisma.character.update({
          where: { id: character.id },
          data: { userId: user.id, claimedAt: new Date() },
        });
        character = { ...character, userId: user.id };
      }
      // If character belongs to a different user, still allow the signup
      // (they may be signing up someone else's known character manually)

      // Check for duplicate signup (keyed on discordUserId now)
      const existing = await prisma.eventSignup.findUnique({
        where: { eventId_discordUserId: { eventId, discordUserId: body.discordId } },
      });
      if (existing) {
        // Update signup details
        const updated = await prisma.eventSignup.update({
          where: { id: existing.id },
          data: {
            rolePreference: body.rolePreference,
            characterId: character.id,
            signupStatus: body.signupStatus,
            spec: body.spec ?? existing.spec,
          },
        });
        return reply.code(200).send({ signup: updated, updated: true });
      }

      const signup = await prisma.eventSignup.create({
        data: {
          eventId,
          userId: user.id,
          discordUserId: body.discordId,
          characterId: character.id,
          rolePreference: body.rolePreference,
          signupStatus: body.signupStatus,
          spec: body.spec,
        },
      });

      req.log.info({ eventId, userId: user.id, role: body.rolePreference }, "Event signup");
      return reply.code(201).send({ signup, updated: false });
    });

    // ── Check if a user has a signup for an event ──────────────
    scope.get<{
      Params: { id: string };
      Querystring: { discordId?: string };
    }>("/events/:id/signup-check", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const discordId = (req.query as { discordId?: string }).discordId;
      if (!discordId) return reply.code(400).send({ error: "missing_discord_id" });

      const signup = await prisma.eventSignup.findUnique({
        where: { eventId_discordUserId: { eventId, discordUserId: discordId } },
        include: { character: true },
      });

      if (!signup) {
        return reply.code(200).send({ hasSignup: false });
      }

      return reply.code(200).send({
        hasSignup: true,
        signup: {
          id: signup.id,
          signupStatus: signup.signupStatus,
          rolePreference: signup.rolePreference,
          spec: signup.spec,
          characterName: signup.character.name,
          characterRealm: signup.character.realm,
          characterClass: signup.character.class,
        },
      });
    });

    // ── Remove a signup ──────────────────────────────────────────
    scope.delete<{
      Params: { id: string };
      Querystring: { discordId?: string };
    }>("/events/:id/signup", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const discordId = (req.query as { discordId?: string }).discordId;
      if (!discordId) return reply.code(400).send({ error: "missing_discord_id" });

      const signup = await prisma.eventSignup.findUnique({
        where: { eventId_discordUserId: { eventId, discordUserId: discordId } },
      });
      if (!signup) return reply.code(404).send({ error: "signup_not_found" });

      await prisma.eventSignup.delete({ where: { id: signup.id } });

      req.log.info({ eventId, discordUserId: discordId }, "Signup removed");
      return reply.code(200).send({ removed: true });
    });

    // ── Close signups (transition to Group Assignments) ──────────
    scope.post<{ Params: { id: string } }>("/events/:id/close-signups", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: "event_not_found" });
      if (event.status !== "open") {
        return reply.code(409).send({ error: "event_not_open", message: `Event is ${event.status}.` });
      }

      // Backward compat: ?autoAssign=true does close + matchmaking in one call
      const autoAssign = (req.query as { autoAssign?: string }).autoAssign === "true";

      if (autoAssign) {
        const result = await runMatchmaking(eventId, req);
        return reply.code(200).send(result);
      }

      // Just close signups — no matchmaking
      await prisma.event.update({
        where: { id: eventId },
        data: { status: "signups_closed" },
      });

      req.log.info({ eventId }, "Signups closed (Group Assignments phase)");
      return reply.code(200).send({ status: "signups_closed" });
    });

    // ── Assign teams (matchmaking during Group Assignments) ─────
    scope.post<{ Params: { id: string } }>("/events/:id/assign-teams", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: "event_not_found" });
      if (event.status !== "signups_closed") {
        return reply.code(409).send({
          error: "wrong_status",
          message: `Event must be in Group Assignments phase (signups_closed). Currently: ${event.status}.`,
        });
      }

      const result = await runMatchmaking(eventId, req);
      return reply.code(200).send(result);
    });

    // ── Status transition ──────────────────────────────────────
    scope.post<{ Params: { id: string } }>("/events/:id/transition", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const body = req.body as { targetStatus?: string };
      if (!body.targetStatus) {
        return reply.code(400).send({ error: "missing_target_status" });
      }

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: "event_not_found" });

      // Validate allowed transitions
      const allowed: Record<string, string[]> = {
        open: ["signups_closed", "cancelled"],
        signups_closed: ["in_progress", "open", "cancelled"],
        in_progress: ["completed", "cancelled"],
        draft: ["open", "cancelled"],
      };

      const validTargets = allowed[event.status] ?? ["cancelled"];
      if (!validTargets.includes(body.targetStatus)) {
        return reply.code(409).send({
          error: "invalid_transition",
          message: `Cannot transition from ${event.status} to ${body.targetStatus}. Allowed: ${validTargets.join(", ")}`,
        });
      }

      const updated = await prisma.event.update({
        where: { id: eventId },
        data: { status: body.targetStatus as import("@prisma/client").EventStatus },
      });

      req.log.info({ eventId, from: event.status, to: body.targetStatus }, "Event status transition");
      return reply.code(200).send({ event: updated });
    });

    // ── Store Discord embed message/channel IDs ─────────────────
    scope.patch<{ Params: { id: string } }>("/events/:id/discord-message", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const body = req.body as { messageId?: string; channelId?: string };
      if (!body.messageId || !body.channelId) {
        return reply.code(400).send({ error: "missing_fields", message: "messageId and channelId required" });
      }

      const event = await prisma.event.update({
        where: { id: eventId },
        data: {
          discordMessageId: body.messageId,
          discordChannelId: body.channelId,
        },
      });

      return reply.code(200).send({ event: { id: event.id, discordMessageId: event.discordMessageId, discordChannelId: event.discordChannelId } });
    });

    // ── Lifecycle transitions ───────────────────────────────────
    scope.post<{ Params: { id: string } }>("/events/:id/start", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });
      const event = await prisma.event.update({
        where: { id: eventId },
        data: { status: "in_progress" },
      });
      return reply.code(200).send({ event });
    });

    scope.post<{ Params: { id: string } }>("/events/:id/complete", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });
      const event = await prisma.event.update({
        where: { id: eventId },
        data: { status: "completed" },
      });
      return reply.code(200).send({ event });
    });

    // ── Edit event details ────────────────────────────────────
    scope.patch<{ Params: { id: string } }>("/events/:id", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const body = req.body as {
        name?: string;
        description?: string | null;
        startsAt?: string;
        endsAt?: string;
        minKeyLevel?: number;
        maxKeyLevel?: number;
      };

      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.description !== undefined) data.description = body.description;
      if (body.startsAt !== undefined) data.startsAt = new Date(body.startsAt);
      if (body.endsAt !== undefined) data.endsAt = new Date(body.endsAt);
      if (body.minKeyLevel !== undefined) data.minKeyLevel = body.minKeyLevel;
      if (body.maxKeyLevel !== undefined) data.maxKeyLevel = body.maxKeyLevel;

      const event = await prisma.event.update({
        where: { id: eventId },
        data,
      });

      req.log.info({ eventId }, "Event details updated");
      return reply.code(200).send({ event });
    });

    // ── Sync Discord embed ────────────────────────────────────
    // Publishes a notification to refresh the Discord embed with current data
    scope.post<{ Params: { id: string } }>("/events/:id/sync-discord", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: "event_not_found" });

      await redis.publish(
        "mplus:bot-notifications",
        JSON.stringify({ type: "event_updated", eventId }),
      );

      req.log.info({ eventId }, "Discord sync requested");
      return reply.code(200).send({ synced: true });
    });
  });

  // ── Public read routes ──────────────────────────────────────
  app.get("/events", async (req, reply) => {
    const query = req.query as {
      guildIds?: string;
      status?: string;
      type?: string;
    };

    const guildIds = query.guildIds ? query.guildIds.split(",").filter(Boolean) : undefined;

    const where: Record<string, unknown> = {};

    // Status filter — default to active statuses if no filter specified
    if (query.status) {
      where.status = query.status;
    } else {
      where.status = { in: ["open", "signups_closed", "in_progress"] };
    }

    // Type filter
    if (query.type) {
      where.type = query.type;
    }

    // Guild filter
    if (guildIds && guildIds.length > 0) {
      where.discordGuildId = { in: guildIds };
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        dungeon: true,
        _count: { select: { signups: true, teams: true } },
      },
      orderBy: { startsAt: "desc" },
    });
    return reply.code(200).send({ events });
  });

  app.get<{ Params: { id: string } }>("/events/:id", async (req, reply) => {
    const eventId = parseInt(req.params.id, 10);
    if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        dungeon: true,
        season: true,
        signups: {
          include: { character: true, team: true },
          orderBy: { signedUpAt: "asc" },
        },
        teams: {
          include: {
            members: { include: { character: true } },
          },
        },
      },
    });
    if (!event) return reply.code(404).send({ error: "event_not_found" });

    return reply.code(200).send({ event });
  });
}
