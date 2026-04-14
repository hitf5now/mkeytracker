/**
 * POST /api/v1/runs — accept a run submission from the companion app.
 *
 * Flow:
 *   1. Validate body with zod
 *   2. Look up the active dungeon by challenge_mode_id
 *   3. Normalize each member's realm and look up all 5 Character rows
 *   4. Compute dedup hash — return existing run if already stored (idempotent)
 *   5. Score the run (shared-score portion — PR bonuses deferred to leaderboards)
 *   6. Insert run + run_members in a transaction
 *   7. Return the persisted run
 *
 * Auth: internal bearer token for now. When we ship the companion app
 * pairing flow, this swaps to JWT-gated.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { toRealmSlug } from "../lib/realm.js";
import { postRunCompleted } from "../lib/discord-webhook.js";
import { computeDedupHash } from "../services/run-dedup.js";
import { scoreRun } from "../services/scoring.js";

const RegionSchema = z.enum(["us", "eu", "kr", "tw", "cn"]);

const MemberPayloadSchema = z.object({
  name: z.string().min(2).max(12),
  realm: z.string().min(2).max(50),
  class: z.string().min(2).max(30),
  spec: z.string().min(2).max(30),
  role: z.enum(["tank", "healer", "dps"]),
});

const RunSubmissionSchema = z.object({
  challengeModeId: z.number().int(),
  keystoneLevel: z.number().int().min(2).max(40),
  completionMs: z.number().int().positive(),
  onTime: z.boolean(),
  upgrades: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  deaths: z.number().int().nonnegative(),
  timeLostSec: z.number().int().nonnegative().default(0),
  serverTime: z.number().int().positive(),
  affixes: z.array(z.number().int()).default([]),
  region: RegionSchema,
  members: z.array(MemberPayloadSchema).min(3).max(6),
  eventId: z.number().int().positive().optional(),
  source: z.enum(["addon", "manual", "raiderio"]).default("addon"),
  submitterCharacterName: z.string().min(2).max(12).optional(),
  // Dynamic dungeon metadata from addon
  dungeonName: z.string().optional(),
  dungeonTimeLimitSec: z.number().int().positive().optional(),
  // Rating data (local player only)
  oldRating: z.number().int().nonnegative().optional().nullable(),
  newRating: z.number().int().nonnegative().optional().nullable(),
  ratingGained: z.number().int().optional(),
  isMapRecord: z.boolean().optional(),
  isAffixRecord: z.boolean().optional(),
  isEligibleForScore: z.boolean().optional(),
  // Season tracking (dynamic WoW season ID)
  wowSeasonId: z.number().int().optional().nullable(),
});

type RunSubmissionBody = z.infer<typeof RunSubmissionSchema>;

/**
 * Prisma returns `serverTime` as a BigInt to match the PostgreSQL BIGINT
 * column. JSON.stringify (and by extension Fastify's default serializer)
 * refuses to touch BigInts, so we convert to a string at the boundary.
 * Anything consuming this API should parse it back to Number or BigInt
 * on their side.
 */
function serializeRun<T extends { serverTime: bigint }>(run: T): Omit<T, "serverTime"> & { serverTime: string } {
  return { ...run, serverTime: run.serverTime.toString() };
}

/**
 * Dual-auth resolver.
 *
 * A /runs request can come from two sources:
 *   1. The companion app, authenticated with a JWT. We enforce that
 *      the token's userId owns at least one of the 5 run members.
 *   2. Internal tooling (tests, admin scripts), authenticated with
 *      the shared internal bearer. We bypass the ownership check.
 *
 * Returns:
 *   - { mode: "internal" } on successful internal bearer match
 *   - { mode: "jwt", userId } on successful JWT verification
 *   - sends the response directly and returns null on auth failure
 */
type AuthResult = { mode: "internal" } | { mode: "jwt"; userId: number };

async function resolveAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthResult | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    await reply.code(401).send({ error: "missing_bearer_token" });
    return null;
  }
  const token = header.slice("Bearer ".length).trim();

  // Internal bearer match first — it's the cheap O(1) comparison.
  if (token === env.API_INTERNAL_SECRET) {
    return { mode: "internal" };
  }

  // Otherwise treat as JWT.
  try {
    await req.jwtVerify();
    const sub = req.user.sub;
    const userId = Number.parseInt(sub, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
      await reply.code(401).send({ error: "invalid_jwt_subject" });
      return null;
    }
    return { mode: "jwt", userId };
  } catch (err) {
    req.log.debug({ err }, "/runs JWT verification failed");
    await reply.code(401).send({ error: "unauthorized" });
    return null;
  }
}

export async function runsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RunSubmissionBody }>("/runs", async (req, reply) => {
      const auth = await resolveAuth(req, reply);
      if (auth === null) return; // response already sent

      const parsed = RunSubmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          issues: parsed.error.issues,
        });
      }
      const body = parsed.data;

      // 1. Resolve dungeon against the currently active season.
      const activeSeason = await prisma.season.findFirst({
        where: { isActive: true },
      });
      if (!activeSeason) {
        return reply.code(500).send({
          error: "no_active_season",
          message: "Database has no active season. Run the seed script.",
        });
      }

      const dungeon = await prisma.dungeon.findUnique({
        where: {
          seasonId_challengeModeId: {
            seasonId: activeSeason.id,
            challengeModeId: body.challengeModeId,
          },
        },
      });
      if (!dungeon) {
        return reply.code(404).send({
          error: "dungeon_not_found",
          message: `No dungeon with challenge_mode_id=${body.challengeModeId} in season ${activeSeason.slug}.`,
        });
      }

      // 2. Deduplicate members (addon may include player twice) and normalize.
      const seen = new Set<string>();
      const dedupedMembers = body.members.filter((m) => {
        const key = `${m.name.toLowerCase()}|${m.realm.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 5);

      if (dedupedMembers.length < 3) {
        return reply.code(400).send({
          error: "invalid_members",
          message: `Expected at least 3 members, got ${dedupedMembers.length}.`,
        });
      }

      const normalizedMembers = dedupedMembers.map((m) => ({
        ...m,
        realmSlug: toRealmSlug(m.realm),
      }));

      const characters = await Promise.all(
        normalizedMembers.map(async (m) => {
          const existing = await prisma.character.findUnique({
            where: {
              region_realm_name: {
                region: body.region,
                realm: m.realmSlug,
                name: m.name,
              },
            },
          });
          if (existing) return existing;

          // Create as unclaimed. Spec/role may be "Unknown" for addon-captured
          // teammates (the client only reliably knows its own spec), so we
          // store whatever was sent.
          req.log.info(
            { name: m.name, realm: m.realmSlug, region: body.region },
            "Creating unclaimed character for unknown run member",
          );
          return prisma.character.create({
            data: {
              userId: null,
              claimedAt: null,
              name: m.name,
              realm: m.realmSlug,
              region: body.region,
              class: m.class,
              spec: m.spec,
              role: m.role,
              rioScore: 0,
            },
          });
        }),
      );

      // 2b. Auto-claim + ownership check for JWT path.
      if (auth.mode === "jwt") {
        // If the companion app told us which character is the submitter,
        // try to auto-claim it and set hasCompanionApp.
        if (body.submitterCharacterName) {
          const submitterChar = characters.find(
            (c) => c.name.toLowerCase() === body.submitterCharacterName!.toLowerCase(),
          );
          if (submitterChar) {
            if (submitterChar.userId === null) {
              // Auto-claim unclaimed character
              await prisma.character.update({
                where: { id: submitterChar.id },
                data: {
                  userId: auth.userId,
                  claimedAt: new Date(),
                  hasCompanionApp: true,
                },
              });
              submitterChar.userId = auth.userId;
              req.log.info(
                { characterId: submitterChar.id, name: submitterChar.name, userId: auth.userId },
                "Auto-claimed character from run submission",
              );
            } else if (submitterChar.userId === auth.userId) {
              // Already claimed by this user — just ensure hasCompanionApp is set
              if (!submitterChar.hasCompanionApp) {
                await prisma.character.update({
                  where: { id: submitterChar.id },
                  data: { hasCompanionApp: true },
                });
              }
            }
          }
        }

        // At least one member must belong to the authenticated user
        const ownsMember = characters.some(
          (c) => c.userId !== null && c.userId === auth.userId,
        );
        if (!ownsMember) {
          return reply.code(403).send({
            error: "not_party_member",
            message:
              "You can only submit runs you participated in. None of the party members belong to your account.",
          });
        }
      }

      // 3. Dedup hash.
      const dedupHash = computeDedupHash({
        challengeModeId: body.challengeModeId,
        keystoneLevel: body.keystoneLevel,
        serverTime: body.serverTime,
        members: normalizedMembers.map((m) => ({
          name: m.name,
          realm: m.realmSlug,
          region: body.region,
        })),
      });

      const existing = await prisma.run.findUnique({ where: { dedupHash } });
      if (existing) {
        req.log.info({ runId: existing.id, dedupHash }, "Duplicate run — returning existing");
        return reply.code(200).send({
          run: serializeRun(existing),
          deduplicated: true,
        });
      }

      // 4. Score the run (shared-score portion — PR bonuses deferred).
      const breakdown = scoreRun({
        keystoneLevel: body.keystoneLevel,
        upgrades: body.upgrades,
        onTime: body.onTime,
        deaths: body.deaths,
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: false,
        isEventParticipation: body.eventId != null,
      });

      // 5. Transactional insert.
      try {
        const run = await prisma.$transaction(async (tx) => {
          const created = await tx.run.create({
            data: {
              dungeonId: dungeon.id,
              seasonId: activeSeason.id,
              keystoneLevel: body.keystoneLevel,
              completionMs: body.completionMs,
              parMs: dungeon.parTimeSec * 1000,
              onTime: body.onTime,
              upgrades: body.upgrades,
              deaths: body.deaths,
              timeLostSec: body.timeLostSec,
              affixes: body.affixes,
              serverTime: BigInt(body.serverTime),
              source: body.source,
              dedupHash,
              personalJuice: breakdown.total,
              eventId: body.eventId ?? null,
              // Enhanced data from addon v0.2.0
              dungeonName: body.dungeonName ?? null,
              wowSeasonId: body.wowSeasonId ?? null,
              oldRating: body.oldRating ?? null,
              newRating: body.newRating ?? null,
              ratingGained: body.ratingGained ?? null,
              isMapRecord: body.isMapRecord ?? false,
              isAffixRecord: body.isAffixRecord ?? false,
              members: {
                create: normalizedMembers.map((m, i) => ({
                  userId: characters[i]!.userId, // nullable — unclaimed members
                  characterId: characters[i]!.id,
                  classSnapshot: m.class,
                  specSnapshot: m.spec,
                  roleSnapshot: m.role,
                })),
              },
            },
            include: { members: true },
          });
          return created;
        });

        req.log.info(
          {
            runId: run.id,
            dungeon: dungeon.slug,
            level: body.keystoneLevel,
            personalJuice: breakdown.total,
          },
          "Run recorded",
        );

        // Fire-and-forget Discord webhook announcement. Must not fail
        // the request if the webhook is unreachable.
        const webhookUrl = env.DISCORD_WEBHOOK_RESULTS;
        if (webhookUrl) {
          void postRunCompleted(
            webhookUrl,
            {
              dungeonName: dungeon.name,
              keystoneLevel: body.keystoneLevel,
              onTime: body.onTime,
              upgrades: body.upgrades,
              completionMs: body.completionMs,
              parMs: dungeon.parTimeSec * 1000,
              deaths: body.deaths,
              juice: breakdown.total,
              affixes: body.affixes,
              members: normalizedMembers.map((m) => ({
                name: m.name,
                realm: m.realmSlug,
                class: m.class,
                role: m.role,
              })),
            },
            req.log,
          );
        }

        return reply.code(201).send({
          run: serializeRun(run),
          scoring: breakdown,
          deduplicated: false,
        });
      } catch (err) {
        // Race condition: another request won the insert between our
        // findUnique and our create. Look up the winning row and return it.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          const winner = await prisma.run.findUnique({ where: { dedupHash } });
          if (winner) {
            return reply.code(200).send({
              run: serializeRun(winner),
              deduplicated: true,
            });
          }
        }
        throw err;
      }
    });
}
