/**
 * Events API routes.
 *
 * Event CRUD:
 *   POST   /events                — create (internal auth)
 *   PATCH  /events/:id            — edit (internal auth)
 *   GET    /events                — list (public)
 *   GET    /events/:id            — detail (public)
 *   POST   /events/:id/transition — status change (internal auth)
 *
 * Signup (roster intent; stays open until event is completed):
 *   POST   /events/:id/signup         — create/update signup (internal auth)
 *   DELETE /events/:id/signup         — remove (internal auth)
 *   GET    /events/:id/signup-check   — has this user signed up? (internal auth)
 *
 * Ready Check (group formation):
 *   POST   /events/:id/ready-check           — start-or-join the active RC
 *   POST   /events/:id/ready-check/:rcId/cancel — cancel my participation
 *   POST   /ready-checks/:rcId/expire        — force expire (scheduler/testing)
 *   GET    /events/:id/ready-check           — current active RC, if any
 *
 * Ops (scheduler):
 *   POST   /ready-checks/sweep-expired   — run expiry for any overdue RCs
 *   POST   /events/:id/groups/sweep-timed-out — auto-disband stale `forming` groups
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";
import {
  startOrJoin,
  cancelParticipation,
  expireReadyCheck,
  sweepExpiredReadyChecks,
  autoDisbandTimedOutGroups,
  recordDisbandVote,
  ReadyCheckError,
} from "../services/ready-check.js";
import { computeEventResults } from "../services/event-results.js";
import { getAllEventTypes, getEventTypeConfig } from "../config/event-types.js";

const CreateEventSchema = z.object({
  name: z.string().min(3).max(100),
  type: z.enum(["fastest_clear_race", "speed_sprint", "random_draft", "key_climbing", "marathon", "best_average", "bracket_tournament"]).default("fastest_clear_race"),
  mode: z.enum(["group", "team"]).default("group"),
  dungeonSlug: z.string().optional(),
  minKeyLevel: z.number().int().min(2).max(40).default(2),
  maxKeyLevel: z.number().int().min(2).max(40).default(40),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  signupClosesAt: z.string().datetime({ offset: true }).optional(),
  description: z.string().max(1000).optional(),
  typeConfig: z.record(z.string(), z.unknown()).optional(),
  createdByDiscordId: z.string().regex(/^\d{17,20}$/),
  discordGuildId: z.string().regex(/^\d{17,20}$/).optional(),
});

/**
 * Resolve a signup identity from a request body that may contain either:
 *   - `signupId` (direct, used by tests / admin tools), OR
 *   - `discordId` (used by the bot — look up the user's signup on this event)
 */
async function resolveSignupId(body: unknown, eventId: number): Promise<number | null> {
  const b = (body ?? {}) as { signupId?: number; discordId?: string };
  if (typeof b.signupId === "number") {
    const s = await prisma.eventSignup.findUnique({
      where: { id: b.signupId },
      select: { id: true, eventId: true },
    });
    return s && s.eventId === eventId ? s.id : null;
  }
  if (typeof b.discordId === "string") {
    const s = await prisma.eventSignup.findUnique({
      where: { eventId_discordUserId: { eventId, discordUserId: b.discordId } },
      select: { id: true },
    });
    return s?.id ?? null;
  }
  return null;
}

const SignupSchema = z.object({
  discordId: z.string().regex(/^\d{17,20}$/),
  characterName: z.string().min(2).max(12),
  characterRealm: z.string().min(1).max(50),
  characterRegion: z.enum(["us", "eu", "kr", "tw", "cn"]),
  rolePreference: z.enum(["tank", "healer", "dps"]),
  /** Secondary role the player is willing to flex to. "none" is valid. */
  flexRole: z.enum(["tank", "healer", "dps", "none"]).default("none"),
  signupStatus: z.enum(["confirmed", "tentative"]).default("confirmed"),
  spec: z.string().max(30).optional(),
  characterClass: z.string().max(30).optional(),
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

      // Resolve serverId from discordGuildId
      let serverId: number | null = null;
      if (body.discordGuildId) {
        const server = await prisma.discordServer.findUnique({
          where: { discordGuildId: body.discordGuildId },
          select: { id: true },
        });
        serverId = server?.id ?? null;
      }

      const event = await prisma.event.create({
        data: {
          name: body.name,
          type: body.type,
          mode: body.mode,
          status: "open",
          seasonId: season.id,
          dungeonId,
          minKeyLevel: body.minKeyLevel,
          maxKeyLevel: body.maxKeyLevel,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          signupClosesAt: body.signupClosesAt ? new Date(body.signupClosesAt) : null,
          description: body.description,
          typeConfig: body.typeConfig ? JSON.parse(JSON.stringify(body.typeConfig)) : undefined,
          createdByUserId: creator.id,
          discordGuildId: body.discordGuildId ?? null,
          serverId,
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
      // Under the Ready Check system, signups stay open through Posted (`open`)
      // and In Progress. Only draft/completed/cancelled reject signups.
      if (event.status !== "open" && event.status !== "in_progress") {
        return reply.code(409).send({ error: "event_not_accepting_signups", message: `Event is ${event.status}, not accepting signups.` });
      }
      if (event.mode === "team") {
        return reply.code(409).send({ error: "team_mode_event", message: "This is a team-mode event. Sign up your team instead of individually." });
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
        // Update signup details. Role/flex changes apply to future Ready
        // Checks only; groups already formed are not re-shuffled.
        const updated = await prisma.eventSignup.update({
          where: { id: existing.id },
          data: {
            rolePreference: body.rolePreference,
            flexRole: body.flexRole,
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
          flexRole: body.flexRole,
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

    // ── Ready Check: start-or-join the active RC ────────────────
    // Body: { discordId } OR { signupId }
    scope.post<{ Params: { id: string } }>("/events/:id/ready-check", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const signupId = await resolveSignupId(req.body, eventId);
      if (!signupId) {
        return reply.code(400).send({
          error: "signup_not_found",
          message: "Supply either `signupId` or `discordId` of a signed-up player",
        });
      }

      try {
        const result = await startOrJoin(eventId, signupId);
        req.log.info(
          { eventId, signupId, startedNew: result.startedNew, rcId: result.readyCheckId },
          result.startedNew ? "Ready Check started" : "Joined active Ready Check",
        );
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof ReadyCheckError) {
          return reply.code(err.statusCode).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    });

    // ── Ready Check: cancel participation ────────────────────────
    scope.post<{ Params: { id: string; rcId: string } }>(
      "/events/:id/ready-check/:rcId/cancel",
      async (req, reply) => {
        const eventId = parseInt(req.params.id, 10);
        const rcId = parseInt(req.params.rcId, 10);
        if (isNaN(eventId) || isNaN(rcId))
          return reply.code(400).send({ error: "invalid_ids" });

        const signupId = await resolveSignupId(req.body, eventId);
        if (!signupId) {
          return reply.code(400).send({
            error: "signup_not_found",
            message: "Supply either `signupId` or `discordId`",
          });
        }

        try {
          await cancelParticipation(rcId, signupId);
          return reply.code(200).send({ cancelled: true });
        } catch (err) {
          if (err instanceof ReadyCheckError) {
            return reply.code(err.statusCode).send({ error: err.code, message: err.message });
          }
          throw err;
        }
      },
    );

    // ── Ready Check: force expire (scheduler / testing) ──────────
    // Returns the formed group summary. Idempotent.
    scope.post<{ Params: { rcId: string } }>(
      "/ready-checks/:rcId/expire",
      async (req, reply) => {
        const rcId = parseInt(req.params.rcId, 10);
        if (isNaN(rcId)) return reply.code(400).send({ error: "invalid_ready_check_id" });

        try {
          const result = await expireReadyCheck(rcId);
          req.log.info(
            { rcId, groupsFormed: result.groupsFormed, bounced: result.bouncedSignupIds.length },
            "Ready Check expired",
          );

          // Notify the bot so Discord can post the formed groups
          await redis.publish(
            "mplus:bot-notifications",
            JSON.stringify({ type: "ready_check_expired", ...result }),
          );

          return reply.code(200).send(result);
        } catch (err) {
          if (err instanceof ReadyCheckError) {
            return reply.code(err.statusCode).send({ error: err.code, message: err.message });
          }
          throw err;
        }
      },
    );

    // ── Sweep: expire any overdue Ready Checks ───────────────────
    scope.post("/ready-checks/sweep-expired", async (req, reply) => {
      const expired = await sweepExpiredReadyChecks();
      req.log.info({ count: expired.length, ids: expired }, "Swept expired Ready Checks");
      return reply.code(200).send({ expiredReadyCheckIds: expired });
    });

    // ── Sweep: auto-disband `forming` groups past 2h OR event end ─
    // Not scoped to an event; the sweep considers every forming group.
    scope.post("/event-groups/sweep-timed-out", async (req, reply) => {
      const disbanded = await autoDisbandTimedOutGroups();
      req.log.info({ count: disbanded.length }, "Swept timed-out groups");
      return reply.code(200).send({ timedOutGroupIds: disbanded });
    });

    // ── Group disband vote ───────────────────────────────────────
    // Body: { signupId } OR { discordId } — must be a member of the group.
    // Any 2 members voting disbands the group. Vote tally is in-memory
    // on the api container; it resets on restart (groups auto-disband
    // after 2h anyway, so a lost tally is self-healing).
    scope.post<{ Params: { id: string } }>(
      "/event-groups/:id/disband-vote",
      async (req, reply) => {
        const groupId = parseInt(req.params.id, 10);
        if (isNaN(groupId)) return reply.code(400).send({ error: "invalid_group_id" });

        // Resolve signupId; group.eventId is looked up by the service.
        const body = (req.body ?? {}) as { signupId?: number; discordId?: string };
        let signupId: number | undefined;
        if (typeof body.signupId === "number") {
          signupId = body.signupId;
        } else if (typeof body.discordId === "string") {
          // We need the event to resolve the signup — use the group's eventId.
          const group = await prisma.eventGroup.findUnique({
            where: { id: groupId },
            select: { eventId: true },
          });
          if (!group) return reply.code(404).send({ error: "group_not_found" });
          const signup = await prisma.eventSignup.findUnique({
            where: {
              eventId_discordUserId: { eventId: group.eventId, discordUserId: body.discordId },
            },
            select: { id: true },
          });
          signupId = signup?.id;
        }
        if (!signupId) return reply.code(400).send({ error: "signup_not_found" });

        try {
          const result = await recordDisbandVote(groupId, signupId);
          return reply.code(200).send(result);
        } catch (err) {
          if (err instanceof ReadyCheckError) {
            return reply.code(err.statusCode).send({ error: err.code, message: err.message });
          }
          throw err;
        }
      },
    );

    // ── Repost event (§3 — append pointer message, don't replace) ─
    scope.post<{ Params: { id: string } }>(
      "/events/:id/repost",
      async (req, reply) => {
        const eventId = parseInt(req.params.id, 10);
        if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

        const event = await prisma.event.findUnique({ where: { id: eventId } });
        if (!event) return reply.code(404).send({ error: "event_not_found" });

        await redis.publish(
          "mplus:bot-notifications",
          JSON.stringify({ type: "event_reposted", eventId }),
        );

        req.log.info({ eventId }, "Event repost requested");
        return reply.code(200).send({ reposted: true });
      },
    );

    // ── Team signup (team-mode events) ──────────────────────────
    scope.post<{ Params: { id: string } }>("/events/:id/team-signup", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

      const body = req.body as { teamId?: number; discordId?: string };
      if (!body.teamId || !body.discordId) {
        return reply.code(400).send({ error: "missing_fields", message: "teamId and discordId required" });
      }

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: "event_not_found" });
      if (event.mode !== "team") {
        return reply.code(409).send({ error: "not_team_mode", message: "This event uses individual signups, not team signups." });
      }
      if (event.status !== "open") {
        return reply.code(409).send({ error: "event_not_open", message: `Event is ${event.status}, not accepting signups.` });
      }

      const team = await prisma.team.findUnique({
        where: { id: body.teamId },
        include: { captain: true },
      });
      if (!team) return reply.code(404).send({ error: "team_not_found" });
      if (!team.active) {
        return reply.code(409).send({ error: "team_inactive", message: "This team has been inactivated." });
      }
      if (team.captain.discordId !== body.discordId) {
        return reply.code(403).send({ error: "not_captain", message: "Only the team captain can sign up for events." });
      }

      // Check for duplicate
      const existing = await prisma.teamEventSignup.findUnique({
        where: { eventId_teamId: { eventId, teamId: body.teamId } },
      });
      if (existing && existing.status === "registered") {
        return reply.code(409).send({ error: "already_signed_up", message: "This team is already registered for this event." });
      }

      const signup = existing
        ? await prisma.teamEventSignup.update({
            where: { id: existing.id },
            data: { status: "registered", signedUpAt: new Date() },
          })
        : await prisma.teamEventSignup.create({
            data: { eventId, teamId: body.teamId },
          });

      req.log.info({ eventId, teamId: body.teamId }, "Team signed up for event");
      return reply.code(201).send({ teamSignup: signup });
    });

    // ── Withdraw team from event ────────────────────────────────
    scope.delete<{ Params: { id: string; teamId: string } }>("/events/:id/team-signup/:teamId", async (req, reply) => {
      const eventId = parseInt(req.params.id, 10);
      const teamId = parseInt(req.params.teamId, 10);
      if (isNaN(eventId) || isNaN(teamId)) {
        return reply.code(400).send({ error: "invalid_ids" });
      }

      const body = req.body as { discordId?: string };
      const discordId = body?.discordId || (req.query as { discordId?: string }).discordId;
      if (!discordId) {
        return reply.code(400).send({ error: "missing_discord_id" });
      }

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: "event_not_found" });

      // Can only withdraw before event starts
      if (event.status === "in_progress" || event.status === "completed") {
        return reply.code(409).send({
          error: "event_started",
          message: "Cannot withdraw after the event has started.",
        });
      }

      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { captain: true },
      });
      if (!team) return reply.code(404).send({ error: "team_not_found" });
      if (team.captain.discordId !== discordId) {
        return reply.code(403).send({ error: "not_captain" });
      }

      const signup = await prisma.teamEventSignup.findUnique({
        where: { eventId_teamId: { eventId, teamId } },
      });
      if (!signup || signup.status !== "registered") {
        return reply.code(404).send({ error: "signup_not_found" });
      }

      await prisma.teamEventSignup.update({
        where: { id: signup.id },
        data: { status: "withdrawn" },
      });

      req.log.info({ eventId, teamId }, "Team withdrew from event");
      return reply.code(200).send({ withdrawn: true });
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

      // Validate allowed transitions. `signups_closed` was removed with the
      // Ready Check system — signups never close until completion.
      const allowed: Record<string, string[]> = {
        draft: ["open", "cancelled"],
        open: ["in_progress", "cancelled"],
        in_progress: ["completed", "cancelled"],
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

      // On completion: clear priority flags on any remaining signups, compute
      // results, and notify the bot.
      if (body.targetStatus === "completed") {
        await prisma.eventSignup.updateMany({
          where: { eventId, priorityFlag: true },
          data: { priorityFlag: false },
        });
        try {
          const results = await computeEventResults(eventId);
          await redis.publish(
            "mplus:bot-notifications",
            JSON.stringify({ type: "event_completed", eventId, results }),
          );
          req.log.info({ eventId, groups: results.standings.length }, "Event results computed");
        } catch (err) {
          req.log.error({ eventId, err }, "Failed to compute event results");
        }
      }

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

  // Active Ready Check for an event, if any. Returns null when none active.
  app.get<{ Params: { id: string } }>("/events/:id/ready-check", async (req, reply) => {
    const eventId = parseInt(req.params.id, 10);
    if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

    const active = await prisma.readyCheck.findFirst({
      where: { eventId, state: "active" },
      orderBy: { startedAt: "desc" },
      include: {
        participants: {
          where: { cancelledAt: null },
          include: { signup: { include: { character: true } } },
          orderBy: { joinedAt: "asc" },
        },
      },
    });

    if (!active) return reply.code(200).send({ active: null });

    return reply.code(200).send({
      active: {
        id: active.id,
        startedAt: active.startedAt,
        expiresAt: active.expiresAt,
        state: active.state,
        participants: active.participants.map((p) => ({
          signupId: p.signupId,
          joinedAt: p.joinedAt,
          characterName: p.signup.character.name,
          realm: p.signup.character.realm,
          primaryRole: p.signup.rolePreference,
          flexRole: p.signup.flexRole,
          priorityFlag: p.signup.priorityFlag,
        })),
      },
    });
  });

  // Event type registry — returns rules, scoring, and config for all types
  app.get("/event-types", async (_req, reply) => {
    return reply.code(200).send({ eventTypes: getAllEventTypes() });
  });

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
      where.status = { in: ["open", "in_progress"] };
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
        _count: { select: { signups: true, groups: true } },
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
          include: { character: true, group: true },
          orderBy: { signedUpAt: "asc" },
        },
        groups: {
          // Hide disbanded groups from the public view per §12.1.
          where: { state: { in: ["forming", "matched", "timed_out"] } },
          include: {
            members: { include: { character: true } },
            runs: {
              select: {
                id: true,
                completionMs: true,
                onTime: true,
                upgrades: true,
                keystoneLevel: true,
                dungeon: { select: { name: true, shortCode: true } },
              },
              orderBy: { recordedAt: "desc" },
              take: 1,
            },
          },
          orderBy: { assignedAt: "asc" },
        },
        teamSignups: {
          where: { status: "registered" },
          include: {
            team: {
              include: {
                members: { include: { character: true } },
                captain: true,
              },
            },
          },
          orderBy: { signedUpAt: "asc" },
        },
      },
    });
    if (!event) return reply.code(404).send({ error: "event_not_found" });

    // Surface the active Ready Check inline so clients don't need a second call.
    const activeRC = await prisma.readyCheck.findFirst({
      where: { eventId, state: "active" },
      orderBy: { startedAt: "desc" },
      include: {
        participants: {
          where: { cancelledAt: null },
          include: { signup: { include: { character: true } } },
          orderBy: { joinedAt: "asc" },
        },
      },
    });

    // Include the type config from the registry
    const typeInfo = getEventTypeConfig(event.type);

    return reply.code(200).send({ event, typeInfo, activeReadyCheck: activeRC });
  });

  // ── Event results (computed standings) ──────────────────────
  // Available for any non-cancelled event so the website can show a
  // live leaderboard during in_progress events, not just completed ones.
  app.get<{ Params: { id: string } }>("/events/:id/results", async (req, reply) => {
    const eventId = parseInt(req.params.id, 10);
    if (isNaN(eventId)) return reply.code(400).send({ error: "invalid_event_id" });

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!event) return reply.code(404).send({ error: "event_not_found" });
    if (event.status === "cancelled") {
      return reply.code(409).send({ error: "event_cancelled", message: "Results are not available for cancelled events." });
    }

    const results = await computeEventResults(eventId);
    return reply.code(200).send(results);
  });
}
