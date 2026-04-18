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
import { redis } from "../lib/redis.js";
import { computeDedupHash } from "../services/run-dedup.js";
import { matchRunToEvents } from "../services/event-matcher.js";
import { scoreRun } from "../services/scoring.js";

const RegionSchema = z.enum(["us", "eu", "kr", "tw", "cn"]);

const MemberPayloadSchema = z.object({
  name: z.string().min(2).max(12),
  realm: z.string().min(2).max(50),
  class: z.string().min(2).max(30),
  spec: z.string().min(2).max(30),
  role: z.enum(["tank", "healer", "dps"]),
});

// ─── Combat-log enrichment schemas (Sprint 15) ──────────────────────────────
//
// Optional additive payload produced by the companion after parsing
// WoWCombatLog.txt. When present, the API creates RunEnrichment + children.
// When absent, the run is still recorded normally.

const EnrichmentPlayerStatsSchema = z.object({
  playerGuid: z.string().min(1).max(64),
  playerName: z.string().min(1).max(80),
  specId: z.number().int().nullable(),
  damageDone: z.number().nonnegative().default(0),
  damageDoneSupport: z.number().nonnegative().default(0),
  healingDone: z.number().nonnegative().default(0),
  healingDoneSupport: z.number().nonnegative().default(0),
  interrupts: z.number().int().nonnegative().default(0),
  dispels: z.number().int().nonnegative().default(0),
  deaths: z.number().int().nonnegative().default(0),
  /** Per-5s-bucket damage from segment start. Optional for legacy payloads. */
  damageBuckets: z.array(z.number().nonnegative()).max(2000).optional(),
  peakBucketIndex: z.number().int().nonnegative().optional(),
  peakDamage: z.number().nonnegative().optional(),
  /** Full COMBATANT_INFO payload (gear/talents/auras). Opaque JSON. */
  combatantInfoRaw: z.unknown().optional(),
});

const EnrichmentEncounterSchema = z.object({
  encounterId: z.number().int(),
  encounterName: z.string().min(1).max(120),
  success: z.boolean(),
  fightTimeMs: z.number().int().nonnegative(),
  difficultyId: z.number().int(),
  groupSize: z.number().int().nonnegative(),
  /** Unix ms of ENCOUNTER_START */
  startedAt: z.number().int(),
  sequenceIndex: z.number().int().nonnegative(),
});

const RunEnrichmentSubmissionSchema = z.object({
  status: z.enum(["complete", "partial", "unavailable"]),
  statusReason: z.string().max(120).optional(),
  parserVersion: z.string().min(1).max(40),
  totalDamage: z.number().nonnegative().default(0),
  totalDamageSupport: z.number().nonnegative().default(0),
  totalHealing: z.number().nonnegative().default(0),
  totalHealingSupport: z.number().nonnegative().default(0),
  totalInterrupts: z.number().int().nonnegative().default(0),
  totalDispels: z.number().int().nonnegative().default(0),
  partyDeaths: z.number().int().nonnegative().default(0),
  endTrailingFields: z.array(z.number()).default([]),
  eventCountsRaw: z.record(z.string(), z.number()).optional(),
  /** Width of each damageBuckets entry, in ms. Omitted on legacy payloads. */
  bucketSizeMs: z.number().int().positive().optional(),
  /** CHALLENGE_MODE_START as unix ms. Reference for boss-kill markers. */
  segmentStartedAt: z.number().int().positive().optional(),
  players: z.array(EnrichmentPlayerStatsSchema).default([]),
  encounters: z.array(EnrichmentEncounterSchema).default([]),
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
  // Combat-log enrichment (Sprint 15) — optional, additive.
  enrichment: RunEnrichmentSubmissionSchema.optional(),
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
 * Serialize a RunEnrichment record (with nested players + encounters) for JSON
 * output. BigInt damage/healing totals are stringified so JSON.stringify works
 * and to give the client full precision. Clients can parse back to Number
 * (safe up to 2^53) or BigInt as needed.
 */
function serializeEnrichment(enrichment: {
  id: number;
  status: string;
  statusReason: string | null;
  parserVersion: string;
  totalDamage: bigint;
  totalDamageSupport: bigint;
  totalHealing: bigint;
  totalHealingSupport: bigint;
  totalInterrupts: number;
  totalDispels: number;
  partyDeaths: number;
  endTrailingFields: number[];
  eventCountsRaw: unknown;
  bucketSizeMs: number | null;
  segmentStartedAt: Date | null;
  createdAt: Date;
  players: Array<{
    id: number;
    playerGuid: string;
    playerName: string;
    specId: number | null;
    characterId: number | null;
    damageDone: bigint;
    damageDoneSupport: bigint;
    healingDone: bigint;
    healingDoneSupport: bigint;
    interrupts: number;
    dispels: number;
    deaths: number;
    damageBuckets: unknown;
    peakBucketIndex: number | null;
    peakDamage: bigint | null;
    combatantInfoRaw: unknown;
  }>;
  encounters: Array<{
    id: number;
    encounterId: number;
    encounterName: string;
    success: boolean;
    fightTimeMs: number;
    difficultyId: number;
    groupSize: number;
    startedAt: Date;
    sequenceIndex: number;
  }>;
}) {
  return {
    id: enrichment.id,
    status: enrichment.status,
    statusReason: enrichment.statusReason,
    parserVersion: enrichment.parserVersion,
    totalDamage: enrichment.totalDamage.toString(),
    totalDamageSupport: enrichment.totalDamageSupport.toString(),
    totalHealing: enrichment.totalHealing.toString(),
    totalHealingSupport: enrichment.totalHealingSupport.toString(),
    totalInterrupts: enrichment.totalInterrupts,
    totalDispels: enrichment.totalDispels,
    partyDeaths: enrichment.partyDeaths,
    endTrailingFields: enrichment.endTrailingFields,
    eventCountsRaw: enrichment.eventCountsRaw,
    bucketSizeMs: enrichment.bucketSizeMs,
    segmentStartedAt: enrichment.segmentStartedAt
      ? enrichment.segmentStartedAt.toISOString()
      : null,
    createdAt: enrichment.createdAt.toISOString(),
    players: enrichment.players.map((p) => ({
      id: p.id,
      playerGuid: p.playerGuid,
      playerName: p.playerName,
      specId: p.specId,
      characterId: p.characterId,
      damageDone: p.damageDone.toString(),
      damageDoneSupport: p.damageDoneSupport.toString(),
      healingDone: p.healingDone.toString(),
      healingDoneSupport: p.healingDoneSupport.toString(),
      interrupts: p.interrupts,
      dispels: p.dispels,
      deaths: p.deaths,
      damageBuckets: (p.damageBuckets as number[] | null) ?? null,
      peakBucketIndex: p.peakBucketIndex,
      peakDamage: p.peakDamage !== null ? p.peakDamage.toString() : null,
      combatantInfoRaw: p.combatantInfoRaw,
    })),
    encounters: enrichment.encounters.map((e) => ({
      id: e.id,
      encounterId: e.encounterId,
      encounterName: e.encounterName,
      success: e.success,
      fightTimeMs: e.fightTimeMs,
      difficultyId: e.difficultyId,
      groupSize: e.groupSize,
      startedAt: e.startedAt.toISOString(),
      sequenceIndex: e.sequenceIndex,
    })),
  };
}

/**
 * Parse a combat-log player name of the form "Name-Realm-Region" (or
 * "Name-Multi-Word-Realm-Region") and try to map it to a resolved character
 * id via the party-member characters we already looked up.
 *
 * Returns null when the shape is malformed or no match is found — unmatched
 * enrichment-player rows are still persisted, just without a character_id.
 */
function matchLogPlayerToCharacter(
  logPlayerName: string,
  characterByKey: Map<string, number>,
): number | null {
  const parts = logPlayerName.split("-");
  if (parts.length < 2) return null;
  const name = parts[0]!.toLowerCase();
  // Everything between first and last segment is the realm. Some realms
  // (e.g. "Area-52", "Mal'Ganis") contain dashes, so we preserve that.
  // If only 2 parts exist the log omitted the region; treat slice(1,-1) as realm.
  const realmSegments = parts.length > 2 ? parts.slice(1, -1) : [parts[1]!];
  const realm = realmSegments.join("-").toLowerCase();
  return characterByKey.get(`${name}|${realm}`) ?? null;
}

/**
 * Publish a run_completed notification so the bot can announce the run in
 * Discord. Includes `submitterUserId` so the bot can apply the submitter's
 * `runResultsMode` preference. Skips publishing when no submitter is known
 * (e.g. internal-auth submissions from tests/admin tooling).
 *
 * Called from both the fresh-insert path and the dedup path: every party
 * member who runs the companion app gets the chance to publish to their
 * own preferred server(s); the bot deduplicates per-channel via
 * RunDiscordPost so the same channel never receives the same run twice.
 */
function publishRunCompleted(args: {
  runId: number;
  submitterUserId: number | null;
  dungeonName: string;
  keystoneLevel: number;
  onTime: boolean;
  upgrades: number;
  completionMs: number;
  parMs: number;
  deaths: number;
  juice: number;
  members: Array<{ name: string; realm: string; class: string; role: string }>;
  log: { warn: (...a: unknown[]) => void };
}): void {
  if (args.submitterUserId == null) return; // internal/admin submission — no Discord post
  void redis.publish("mplus:bot-notifications", JSON.stringify({
    type: "run_completed",
    runId: args.runId,
    submitterUserId: args.submitterUserId,
    dungeonName: args.dungeonName,
    keystoneLevel: args.keystoneLevel,
    onTime: args.onTime,
    upgrades: args.upgrades,
    completionMs: args.completionMs,
    parMs: args.parMs,
    deaths: args.deaths,
    juice: args.juice,
    members: args.members,
  })).catch((err) => args.log.warn({ err }, "Failed to publish run notification"));
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
        // Each companion submitter should still drive their own publish so
        // the bot can apply their preference. RunDiscordPost dedupes per
        // channel, so a server is never spammed with the same run twice.
        publishRunCompleted({
          runId: existing.id,
          submitterUserId: auth.mode === "jwt" ? auth.userId : null,
          dungeonName: dungeon.name,
          keystoneLevel: existing.keystoneLevel,
          onTime: existing.onTime,
          upgrades: existing.upgrades,
          completionMs: existing.completionMs,
          parMs: existing.parMs,
          deaths: existing.deaths,
          juice: existing.personalJuice,
          members: normalizedMembers.map((m) => ({
            name: m.name,
            realm: m.realmSlug,
            class: m.class,
            role: m.role,
          })),
          log: req.log,
        });
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
        isEventParticipation: false, // Event bonus applied via auto-matcher
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

          // Persist enrichment if the companion attempted it. We record even
          // "unavailable" attempts so the UI can show "core only — reason"
          // without inference.
          if (body.enrichment) {
            const e = body.enrichment;
            const characterByKey = new Map<string, number>();
            for (let i = 0; i < characters.length; i++) {
              const m = normalizedMembers[i]!;
              characterByKey.set(`${m.name.toLowerCase()}|${m.realmSlug}`, characters[i]!.id);
            }

            await tx.runEnrichment.create({
              data: {
                runId: created.id,
                status: e.status,
                statusReason: e.statusReason ?? null,
                parserVersion: e.parserVersion,
                totalDamage: BigInt(Math.floor(e.totalDamage)),
                totalDamageSupport: BigInt(Math.floor(e.totalDamageSupport)),
                totalHealing: BigInt(Math.floor(e.totalHealing)),
                totalHealingSupport: BigInt(Math.floor(e.totalHealingSupport)),
                totalInterrupts: e.totalInterrupts,
                totalDispels: e.totalDispels,
                partyDeaths: e.partyDeaths,
                endTrailingFields: e.endTrailingFields,
                eventCountsRaw: (e.eventCountsRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                bucketSizeMs: e.bucketSizeMs ?? null,
                segmentStartedAt: e.segmentStartedAt ? new Date(e.segmentStartedAt) : null,
                players: {
                  create: e.players.map((p) => ({
                    playerGuid: p.playerGuid,
                    playerName: p.playerName,
                    specId: p.specId,
                    characterId: matchLogPlayerToCharacter(p.playerName, characterByKey),
                    damageDone: BigInt(Math.floor(p.damageDone)),
                    damageDoneSupport: BigInt(Math.floor(p.damageDoneSupport)),
                    healingDone: BigInt(Math.floor(p.healingDone)),
                    healingDoneSupport: BigInt(Math.floor(p.healingDoneSupport)),
                    interrupts: p.interrupts,
                    dispels: p.dispels,
                    deaths: p.deaths,
                    damageBuckets:
                      p.damageBuckets === undefined
                        ? Prisma.JsonNull
                        : (p.damageBuckets as Prisma.InputJsonValue),
                    peakBucketIndex: p.peakBucketIndex ?? null,
                    peakDamage:
                      p.peakDamage === undefined ? null : BigInt(Math.floor(p.peakDamage)),
                    combatantInfoRaw:
                      p.combatantInfoRaw === undefined
                        ? Prisma.JsonNull
                        : (p.combatantInfoRaw as Prisma.InputJsonValue),
                  })),
                },
                encounters: {
                  create: e.encounters.map((enc) => ({
                    encounterId: enc.encounterId,
                    encounterName: enc.encounterName,
                    success: enc.success,
                    fightTimeMs: enc.fightTimeMs,
                    difficultyId: enc.difficultyId,
                    groupSize: enc.groupSize,
                    startedAt: new Date(enc.startedAt),
                    sequenceIndex: enc.sequenceIndex,
                  })),
                },
              },
            });

            req.log.info(
              {
                runId: created.id,
                enrichmentStatus: e.status,
                players: e.players.length,
                encounters: e.encounters.length,
              },
              "Run enrichment persisted",
            );
          }

          return created;
        });

        // 6. Auto-match run to active events
        const eventMatches = await matchRunToEvents({
          seasonId: activeSeason.id,
          dungeonId: dungeon.id,
          keystoneLevel: body.keystoneLevel,
          serverTime: BigInt(body.serverTime),
          memberCharacterIds: characters.map((c) => c.id),
        });

        if (eventMatches.length > 0) {
          const eventBreakdown = scoreRun({
            keystoneLevel: body.keystoneLevel,
            upgrades: body.upgrades,
            onTime: body.onTime,
            deaths: body.deaths,
            isPersonalDungeonRecord: false,
            isPersonalOverallRecord: false,
            isEventParticipation: true,
          });

          await prisma.runEvent.createMany({
            data: eventMatches.map((m) => ({
              runId: run.id,
              eventId: m.eventId,
              groupId: m.groupId,
              eventJuice: eventBreakdown.total,
            })),
          });

          // Backward compat: set Run.eventId/eventJuice to first match
          await prisma.run.update({
            where: { id: run.id },
            data: {
              eventId: eventMatches[0]!.eventId,
              groupId: eventMatches[0]!.groupId,
              eventJuice: eventBreakdown.total,
            },
          });

          req.log.info(
            { runId: run.id, events: eventMatches.map((m) => m.eventId) },
            "Run matched to events",
          );
        }

        req.log.info(
          {
            runId: run.id,
            dungeon: dungeon.slug,
            level: body.keystoneLevel,
            personalJuice: breakdown.total,
          },
          "Run recorded",
        );

        // Publish run-completed notification for bot to announce
        publishRunCompleted({
          runId: run.id,
          submitterUserId: auth.mode === "jwt" ? auth.userId : null,
          dungeonName: dungeon.name,
          keystoneLevel: body.keystoneLevel,
          onTime: body.onTime,
          upgrades: body.upgrades,
          completionMs: body.completionMs,
          parMs: dungeon.parTimeSec * 1000,
          deaths: body.deaths,
          juice: breakdown.total,
          members: normalizedMembers.map((m) => ({
            name: m.name,
            realm: m.realmSlug,
            class: m.class,
            role: m.role,
          })),
          log: req.log,
        });

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
            publishRunCompleted({
              runId: winner.id,
              submitterUserId: auth.mode === "jwt" ? auth.userId : null,
              dungeonName: dungeon.name,
              keystoneLevel: winner.keystoneLevel,
              onTime: winner.onTime,
              upgrades: winner.upgrades,
              completionMs: winner.completionMs,
              parMs: winner.parMs,
              deaths: winner.deaths,
              juice: winner.personalJuice,
              members: normalizedMembers.map((m) => ({
                name: m.name,
                realm: m.realmSlug,
                class: m.class,
                role: m.role,
              })),
              log: req.log,
            });
            return reply.code(200).send({
              run: serializeRun(winner),
              deduplicated: true,
            });
          }
        }
        throw err;
      }
    });

  // ─── GET /api/v1/runs/:id — fetch a run with its enrichment ──────────────
  //
  // Public read: no auth required. Returns the run plus dungeon/season meta,
  // members (with character/class/spec/role), and enrichment (players +
  // encounters) if present. Used by the web run-detail page.
  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: "invalid_run_id" });
    }

    const run = await prisma.run.findUnique({
      where: { id },
      include: {
        dungeon: { select: { id: true, name: true, slug: true, shortCode: true, parTimeSec: true, challengeModeId: true } },
        season: { select: { id: true, name: true, slug: true } },
        members: {
          include: {
            character: {
              select: {
                id: true,
                name: true,
                realm: true,
                region: true,
                class: true,
                thumbnailUrl: true,
              },
            },
          },
        },
        enrichment: {
          include: {
            players: { orderBy: { damageDone: "desc" } },
            encounters: { orderBy: { sequenceIndex: "asc" } },
          },
        },
      },
    });

    if (!run) {
      return reply.code(404).send({ error: "run_not_found" });
    }

    return reply.send({
      run: {
        id: run.id,
        keystoneLevel: run.keystoneLevel,
        completionMs: run.completionMs,
        parMs: run.parMs,
        onTime: run.onTime,
        upgrades: run.upgrades,
        deaths: run.deaths,
        timeLostSec: run.timeLostSec,
        affixes: run.affixes,
        serverTime: run.serverTime.toString(),
        recordedAt: run.recordedAt.toISOString(),
        source: run.source,
        verified: run.verified,
        personalJuice: run.personalJuice,
        eventJuice: run.eventJuice,
        teamJuice: run.teamJuice,
        dungeonName: run.dungeonName,
        oldRating: run.oldRating,
        newRating: run.newRating,
        ratingGained: run.ratingGained,
        isMapRecord: run.isMapRecord,
        isAffixRecord: run.isAffixRecord,
        dungeon: run.dungeon,
        season: run.season,
        members: run.members.map((m) => ({
          id: m.id,
          characterId: m.characterId,
          userId: m.userId,
          classSnapshot: m.classSnapshot,
          specSnapshot: m.specSnapshot,
          roleSnapshot: m.roleSnapshot,
          character: m.character
            ? {
                id: m.character.id,
                name: m.character.name,
                realm: m.character.realm,
                region: m.character.region,
                class: m.character.class,
                thumbnailUrl: m.character.thumbnailUrl,
              }
            : null,
        })),
        enrichment: run.enrichment ? serializeEnrichment(run.enrichment) : null,
      },
    });
  });

  // ─── POST /api/v1/runs/:id/enrichment — retroactive enrichment ───────────
  //
  // Attach combat-log enrichment to a run that was submitted without it
  // (e.g. because the companion couldn't find the log file at submission
  // time). Idempotent: 409 if enrichment already exists for the run.
  //
  // Auth: same as POST /runs — JWT holder must own at least one member, or
  // internal bearer bypasses the check.
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/runs/:id/enrichment",
    async (req, reply) => {
      const auth = await resolveAuth(req, reply);
      if (auth === null) return;

      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: "invalid_run_id" });
      }

      const parsed = RunEnrichmentSubmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          issues: parsed.error.issues,
        });
      }
      const e = parsed.data;

      const run = await prisma.run.findUnique({
        where: { id },
        include: {
          enrichment: { select: { id: true } },
          members: {
            select: {
              characterId: true,
              character: {
                select: { id: true, userId: true, name: true, realm: true },
              },
            },
          },
        },
      });
      if (!run) {
        return reply.code(404).send({ error: "run_not_found" });
      }
      if (run.enrichment) {
        return reply.code(409).send({
          error: "enrichment_exists",
          message: `Run ${id} already has enrichment id=${run.enrichment.id}.`,
          enrichmentId: run.enrichment.id,
        });
      }

      if (auth.mode === "jwt") {
        const ownsMember = run.members.some(
          (m) => m.character?.userId === auth.userId,
        );
        if (!ownsMember) {
          return reply.code(403).send({
            error: "not_party_member",
            message:
              "You can only enrich runs you participated in. None of the party members belong to your account.",
          });
        }
      }

      const characterByKey = new Map<string, number>();
      for (const m of run.members) {
        if (!m.character) continue;
        characterByKey.set(
          `${m.character.name.toLowerCase()}|${m.character.realm}`,
          m.character.id,
        );
      }

      const enrichment = await prisma.runEnrichment.create({
        data: {
          runId: id,
          status: e.status,
          statusReason: e.statusReason ?? null,
          parserVersion: e.parserVersion,
          totalDamage: BigInt(Math.floor(e.totalDamage)),
          totalDamageSupport: BigInt(Math.floor(e.totalDamageSupport)),
          totalHealing: BigInt(Math.floor(e.totalHealing)),
          totalHealingSupport: BigInt(Math.floor(e.totalHealingSupport)),
          totalInterrupts: e.totalInterrupts,
          totalDispels: e.totalDispels,
          partyDeaths: e.partyDeaths,
          endTrailingFields: e.endTrailingFields,
          eventCountsRaw: (e.eventCountsRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          bucketSizeMs: e.bucketSizeMs ?? null,
          segmentStartedAt: e.segmentStartedAt ? new Date(e.segmentStartedAt) : null,
          players: {
            create: e.players.map((p) => ({
              playerGuid: p.playerGuid,
              playerName: p.playerName,
              specId: p.specId,
              characterId: matchLogPlayerToCharacter(p.playerName, characterByKey),
              damageDone: BigInt(Math.floor(p.damageDone)),
              damageDoneSupport: BigInt(Math.floor(p.damageDoneSupport)),
              healingDone: BigInt(Math.floor(p.healingDone)),
              healingDoneSupport: BigInt(Math.floor(p.healingDoneSupport)),
              interrupts: p.interrupts,
              dispels: p.dispels,
              deaths: p.deaths,
              damageBuckets:
                p.damageBuckets === undefined
                  ? Prisma.JsonNull
                  : (p.damageBuckets as Prisma.InputJsonValue),
              peakBucketIndex: p.peakBucketIndex ?? null,
              peakDamage:
                p.peakDamage === undefined ? null : BigInt(Math.floor(p.peakDamage)),
              combatantInfoRaw:
                p.combatantInfoRaw === undefined
                  ? Prisma.JsonNull
                  : (p.combatantInfoRaw as Prisma.InputJsonValue),
            })),
          },
          encounters: {
            create: e.encounters.map((enc) => ({
              encounterId: enc.encounterId,
              encounterName: enc.encounterName,
              success: enc.success,
              fightTimeMs: enc.fightTimeMs,
              difficultyId: enc.difficultyId,
              groupSize: enc.groupSize,
              startedAt: new Date(enc.startedAt),
              sequenceIndex: enc.sequenceIndex,
            })),
          },
        },
      });

      req.log.info(
        {
          runId: id,
          enrichmentId: enrichment.id,
          status: e.status,
          players: e.players.length,
          encounters: e.encounters.length,
        },
        "Run enrichment persisted (retroactive)",
      );

      return reply.code(201).send({ enrichmentId: enrichment.id });
    },
  );
}
