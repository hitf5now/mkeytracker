/**
 * Season routes.
 *
 * - GET  /api/v1/seasons        — public list, newest first.
 * - POST /api/v1/seasons/sync   — internal; reconciles seasons + dungeon
 *   pools against upstream (Raider.IO, cross-checked with Blizzard). Called
 *   on a schedule by the scheduler worker, and callable by hand to force a
 *   rollover check.
 *
 * The sync itself lives in `services/season-sync.ts`; this file is only the
 * HTTP surface plus the Discord announcement on an actual rollover.
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { env } from "../config/env.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";
import { syncSeasons, type SeasonSyncResult } from "../services/season-sync.js";

/**
 * Announce a rollover to every server that has an announcements or results
 * channel configured. Best-effort: a Redis hiccup must not fail the sync.
 */
async function announceRollover(result: SeasonSyncResult): Promise<void> {
  const servers = await prisma.discordServer.findMany({
    where: { botActive: true },
    select: { announcementsChannelId: true, resultsChannelId: true },
  });

  const channelIds = servers
    .map((s) => s.announcementsChannelId ?? s.resultsChannelId)
    .filter((id): id is string => Boolean(id));

  if (channelIds.length === 0) return;

  await redis.publish(
    "mplus:bot-notifications",
    JSON.stringify({
      type: "season_rollover",
      channelIds,
      seasonSlug: result.seasonSlug,
      previousSeasonSlug: result.previousSeasonSlug,
      dungeonCount: result.dungeonsUpserted,
    }),
  );
}

export async function seasonsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/seasons", async (_req, reply) => {
    const seasons = await prisma.season.findMany({
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        slug: true,
        name: true,
        patch: true,
        startsAt: true,
        endsAt: true,
        isActive: true,
        wowSeasonId: true,
        _count: { select: { dungeons: true, runs: true } },
      },
    });
    return reply.code(200).send({
      seasons: seasons.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        patch: s.patch,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        isActive: s.isActive,
        wowSeasonId: s.wowSeasonId,
        dungeonCount: s._count.dungeons,
        runCount: s._count.runs,
      })),
    });
  });

  await app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    scope.post("/seasons/sync", async (req, reply) => {
      if (!env.SEASON_SYNC_ENABLED) {
        return reply.code(200).send({
          action: "skipped",
          reason: "SEASON_SYNC_ENABLED is false",
        } satisfies SeasonSyncResult);
      }

      const result = await syncSeasons(prisma);

      if (result.action === "failed") {
        req.log.warn(result, "Season sync failed");
      } else if (result.action === "activated") {
        req.log.info(result, "Season rollover — new season activated");
        try {
          await announceRollover(result);
        } catch (err) {
          req.log.warn({ err }, "Season rollover announce failed");
        }
      } else if (result.action !== "noop") {
        req.log.info(result, "Season sync");
      }

      return reply.code(200).send(result);
    });
  });
}
