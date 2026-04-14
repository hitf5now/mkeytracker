/**
 * Teams API routes — persistent pre-made rosters.
 *
 * POST   /teams              — create a team with full 5-member roster
 * GET    /teams              — list active teams (public, filterable)
 * GET    /teams/:id          — team detail with roster
 * PATCH  /teams/:id/inactivate — soft-delete (captain only)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";

const TeamMemberSchema = z.object({
  characterName: z.string().min(2).max(12),
  characterRealm: z.string().min(1).max(50),
  characterRegion: z.enum(["us", "eu", "kr", "tw", "cn"]),
  role: z.enum(["tank", "healer", "dps"]),
});

const CreateTeamSchema = z.object({
  name: z.string().min(2).max(50),
  discordId: z.string().regex(/^\d{17,20}$/),
  members: z.array(TeamMemberSchema).length(5),
});

export async function teamsRoutes(app: FastifyInstance): Promise<void> {
  // ── Authenticated routes ──────────────────────────────────
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    // ── Create team with full roster ────────────────────────
    scope.post("/teams", async (req, reply) => {
      const parsed = CreateTeamSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const body = parsed.data;

      // Validate role composition: exactly 1 tank, 1 healer, 3 DPS
      const roleCounts = { tank: 0, healer: 0, dps: 0 };
      for (const m of body.members) {
        roleCounts[m.role]++;
      }
      if (roleCounts.tank !== 1 || roleCounts.healer !== 1 || roleCounts.dps !== 3) {
        return reply.code(400).send({
          error: "invalid_composition",
          message: `Team must have exactly 1 tank, 1 healer, and 3 DPS. Got: ${roleCounts.tank}T/${roleCounts.healer}H/${roleCounts.dps}D.`,
        });
      }

      // Look up captain
      const captain = await prisma.user.findUnique({ where: { discordId: body.discordId } });
      if (!captain) {
        return reply.code(404).send({ error: "user_not_found", message: "You must be registered to create a team." });
      }

      // Get active season
      const season = await prisma.season.findFirst({ where: { isActive: true } });
      if (!season) {
        return reply.code(500).send({ error: "no_active_season" });
      }

      // Check for duplicate team name in this season
      const existing = await prisma.team.findUnique({
        where: { seasonId_name: { seasonId: season.id, name: body.name } },
      });
      if (existing) {
        return reply.code(409).send({
          error: "duplicate_name",
          message: `A team named "${body.name}" already exists this season.`,
        });
      }

      // Resolve all 5 characters
      const characters = await Promise.all(
        body.members.map(async (m) => {
          const char = await prisma.character.findUnique({
            where: {
              region_realm_name: {
                region: m.characterRegion,
                realm: m.characterRealm,
                name: m.characterName,
              },
            },
          });
          if (!char) {
            return { error: `Character ${m.characterName}-${m.characterRealm} (${m.characterRegion}) not found.`, member: m, char: null };
          }
          return { error: null, member: m, char };
        }),
      );

      const missing = characters.filter((c) => c.error);
      if (missing.length > 0) {
        return reply.code(404).send({
          error: "characters_not_found",
          message: missing.map((c) => c.error).join(" "),
        });
      }

      // Create team + members in a transaction
      const team = await prisma.$transaction(async (tx) => {
        const created = await tx.team.create({
          data: {
            name: body.name,
            captainUserId: captain.id,
            seasonId: season.id,
          },
        });

        for (const entry of characters) {
          await tx.teamMember.create({
            data: {
              teamId: created.id,
              characterId: entry.char!.id,
              role: entry.member.role,
            },
          });
        }

        return tx.team.findUnique({
          where: { id: created.id },
          include: {
            members: { include: { character: true } },
            captain: true,
            season: true,
          },
        });
      });

      req.log.info({ teamId: team!.id, name: body.name, captain: captain.id }, "Team created");
      return reply.code(201).send({ team });
    });

    // ── Inactivate team (captain only) ──────────────────────
    scope.patch<{ Params: { id: string } }>("/teams/:id/inactivate", async (req, reply) => {
      const teamId = parseInt(req.params.id, 10);
      if (isNaN(teamId)) return reply.code(400).send({ error: "invalid_team_id" });

      const body = req.body as { discordId?: string };
      if (!body.discordId) {
        return reply.code(400).send({ error: "missing_discord_id" });
      }

      const team = await prisma.team.findUnique({ where: { id: teamId }, include: { captain: true } });
      if (!team) return reply.code(404).send({ error: "team_not_found" });

      if (team.captain.discordId !== body.discordId) {
        return reply.code(403).send({ error: "not_captain", message: "Only the team captain can inactivate a team." });
      }

      const updated = await prisma.team.update({
        where: { id: teamId },
        data: { active: false },
      });

      req.log.info({ teamId }, "Team inactivated");
      return reply.code(200).send({ team: updated });
    });
  });

  // ── Public read routes ──────────────────────────────────────
  app.get("/teams", async (req, reply) => {
    const query = req.query as { seasonId?: string; active?: string };

    const where: Record<string, unknown> = {};

    if (query.active !== "false") {
      where.active = true;
    }

    if (query.seasonId) {
      where.seasonId = parseInt(query.seasonId, 10);
    } else {
      const season = await prisma.season.findFirst({ where: { isActive: true } });
      if (season) where.seasonId = season.id;
    }

    const teams = await prisma.team.findMany({
      where,
      include: {
        members: { include: { character: true } },
        captain: true,
        season: true,
        _count: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return reply.code(200).send({ teams });
  });

  app.get<{ Params: { id: string } }>("/teams/:id", async (req, reply) => {
    const teamId = parseInt(req.params.id, 10);
    if (isNaN(teamId)) return reply.code(400).send({ error: "invalid_team_id" });

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: { include: { character: true } },
        captain: true,
        season: true,
      },
    });

    if (!team) return reply.code(404).send({ error: "team_not_found" });

    return reply.code(200).send({ team });
  });
}
