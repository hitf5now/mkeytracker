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
});

const SignupSchema = z.object({
  discordId: z.string().regex(/^\d{17,20}$/),
  characterName: z.string().min(2).max(12),
  characterRealm: z.string().min(1).max(50),
  characterRegion: z.enum(["us", "eu", "kr", "tw", "cn"]),
  rolePreference: z.enum(["tank", "healer", "dps"]),
});

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
        },
      });

      req.log.info({ eventId: event.id, name: event.name }, "Event created");
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

      const user = await prisma.user.findUnique({ where: { discordId: body.discordId } });
      if (!user) return reply.code(404).send({ error: "user_not_registered", message: "Register with /register first." });

      const character = await prisma.character.findUnique({
        where: {
          region_realm_name: {
            region: body.characterRegion,
            realm: body.characterRealm,
            name: body.characterName,
          },
        },
      });
      if (!character) return reply.code(404).send({ error: "character_not_found" });
      if (character.userId !== user.id) return reply.code(403).send({ error: "character_not_yours" });

      // Check for duplicate signup
      const existing = await prisma.eventSignup.findUnique({
        where: { eventId_userId: { eventId, userId: user.id } },
      });
      if (existing) {
        // Update role preference if they're changing it
        const updated = await prisma.eventSignup.update({
          where: { id: existing.id },
          data: { rolePreference: body.rolePreference, characterId: character.id },
        });
        return reply.code(200).send({ signup: updated, updated: true });
      }

      const signup = await prisma.eventSignup.create({
        data: {
          eventId,
          userId: user.id,
          characterId: character.id,
          rolePreference: body.rolePreference,
        },
      });

      req.log.info({ eventId, userId: user.id, role: body.rolePreference }, "Event signup");
      return reply.code(201).send({ signup, updated: false });
    });

    // ── Close signups + assign teams ────────────────────────────
    scope.post<{ Params: { id: string } }>("/events/:id/close-signups", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: "event_not_found" });
      if (event.status !== "open") {
        return reply.code(409).send({ error: "event_not_open", message: `Event is ${event.status}.` });
      }

      // Get all signups
      const signups = await prisma.eventSignup.findMany({
        where: { eventId },
        include: { character: true },
      });

      if (signups.length < 5) {
        return reply.code(409).send({
          error: "not_enough_signups",
          message: `Need at least 5 signups to form a team. Currently ${signups.length}.`,
        });
      }

      // Build the matchmaking input
      const pool: SignupForMatching[] = signups.map((s) => ({
        signupId: s.id,
        userId: s.userId,
        characterId: s.characterId,
        rolePreference: s.rolePreference as "tank" | "healer" | "dps",
        characterName: s.character.name,
        realm: s.character.realm,
      }));

      const result = assignTeams(pool);

      // Persist teams + update signups in a transaction
      await prisma.$transaction(async (tx) => {
        for (const team of result.teams) {
          const created = await tx.eventTeam.create({
            data: {
              eventId,
              name: team.name,
              status: "assigned",
            },
          });
          // Update each signup in this team with the teamId
          for (const member of team.members) {
            await tx.eventSignup.update({
              where: { id: member.signupId },
              data: { teamId: created.id },
            });
          }
        }

        // Update event status
        await tx.event.update({
          where: { id: eventId },
          data: { status: "signups_closed" },
        });
      });

      req.log.info(
        { eventId, teams: result.stats.teamsFormed, benched: result.stats.benchedCount },
        "Teams assigned",
      );

      return reply.code(200).send({
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
      });
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
  });

  // ── Public read routes ──────────────────────────────────────
  app.get("/events", async (_req, reply) => {
    const events = await prisma.event.findMany({
      where: { status: { in: ["open", "signups_closed", "in_progress"] } },
      include: {
        dungeon: true,
        _count: { select: { signups: true, teams: true } },
      },
      orderBy: { startsAt: "asc" },
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
