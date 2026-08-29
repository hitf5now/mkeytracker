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
import { listSeasonOptions } from "../services/seasons.js";

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
  // Powers every season picker on the website. Returned newest-first and
  // pre-grouped by expansion so the client renders <optgroup> without having
  // to know how expansions are ordered.
  app.get("/seasons", async (_req, reply) => {
    const seasons = await listSeasonOptions(prisma);

    // Group in list order, so expansions come out newest-first for free.
    const groups: Array<{ expansion: string; seasons: typeof seasons }> = [];
    for (const season of seasons) {
      // Seasons whose upstream slug wasn't recognisable have no expansion.
      // They still belong somewhere, so collect them under "Other" rather
      // than dropping them out of the picker entirely.
      const label = season.expansion ?? "Other";
      const existing = groups.find((g) => g.expansion === label);
      if (existing) existing.seasons.push(season);
      else groups.push({ expansion: label, seasons: [season] });
    }

    return reply.code(200).send({
      seasons,
      groups,
      activeSlug: seasons.find((s) => s.isActive)?.slug ?? null,
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
