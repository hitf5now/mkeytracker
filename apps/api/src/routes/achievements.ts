/**
 * Achievements admin + read routes.
 *
 *   POST /api/v1/admin/achievements/reload  — internal-auth; re-runs the
 *     seed loader from prisma/seeds/achievements/*.json and upserts the DB
 *     catalog. Use this after editing flavor JSON without redeploying.
 *
 *   POST /api/v1/admin/achievements/backfill — internal-auth; re-evaluates
 *     a window of historical runs and persists their achievements. Used
 *     after a content change to retroactively populate.
 *
 *   GET  /api/v1/runs/:id/achievements — public read; returns the
 *     persisted RunAchievement rows for a run.
 *
 *   GET  /api/v1/characters/:id/achievements — public read; gallery view
 *     of every distinct flavor a character has ever earned.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";
import { evaluateAndPersist } from "../services/achievements/evaluator.js";
import { loadAchievementSeed } from "../services/achievements/seed-loader.js";

export async function achievementsRoutes(app: FastifyInstance): Promise<void> {
  // ── Internal-auth admin routes ─────────────────────────────────────
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    scope.post("/admin/achievements/reload", async (_req, reply) => {
      const report = await loadAchievementSeed(prisma);
      return reply.code(200).send(report);
    });

    scope.post("/admin/achievements/backfill", async (req, reply) => {
      const body = z
        .object({
          /** Re-evaluate runs newer than this id (exclusive). Default: 0 (all). */
          afterRunId: z.number().int().min(0).default(0),
          /** Cap on rows processed in one call. */
          limit: z.number().int().min(1).max(2000).default(500),
        })
        .safeParse(req.body ?? {});
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", issues: body.error.issues });
      }

      const runs = await prisma.run.findMany({
        where: { id: { gt: body.data.afterRunId } },
        orderBy: { id: "asc" },
        take: body.data.limit,
        select: { id: true },
      });

      let processed = 0;
      let totalRows = 0;
      let lastRunId = body.data.afterRunId;
      for (const r of runs) {
        try {
          const n = await evaluateAndPersist({ runId: r.id, prisma });
          totalRows += n;
        } catch (err) {
          req.log.error({ runId: r.id, err }, "Backfill: evaluator failed");
        }
        processed++;
        lastRunId = r.id;
      }

      return reply.code(200).send({
        processed,
        totalRowsWritten: totalRows,
        lastRunId,
        moreAvailable: runs.length === body.data.limit,
      });
    });
  });

  // ── Public read routes ─────────────────────────────────────────────
  app.get<{ Params: { runId: string } }>(
    "/runs/:runId/achievements",
    async (req, reply) => {
      const runId = parseInt(req.params.runId, 10);
      if (Number.isNaN(runId)) {
        return reply.code(400).send({ error: "invalid_run_id" });
      }
      const rows = await prisma.runAchievement.findMany({
        where: { runId },
        include: {
          archetype: { select: { key: true, category: true, tier: true } },
          flavor: true,
        },
        orderBy: [{ memberId: "asc" }, { id: "asc" }],
      });
      return reply.code(200).send({
        achievements: rows.map((r) => ({
          id: r.id,
          memberId: r.memberId,
          characterId: r.characterId,
          archetypeKey: r.archetype.key,
          archetypeCategory: r.archetype.category,
          archetypeTier: r.archetype.tier,
          flavorKey: r.flavor.key,
          name: r.flavor.name,
          flavorText: r.flavor.flavorText,
          description: r.flavor.description,
          icon: r.flavor.icon,
          severity: r.flavor.severity,
          rarity: r.rarity,
          reason: r.reason,
          awardedAt: r.awardedAt.toISOString(),
        })),
      });
    },
  );

  app.get<{
    Params: { characterId: string };
    Querystring: { limit?: string };
  }>("/characters/:characterId/achievements", async (req, reply) => {
    const characterId = parseInt(req.params.characterId, 10);
    if (Number.isNaN(characterId)) {
      return reply.code(400).send({ error: "invalid_character_id" });
    }
    const limit = Math.min(500, parseInt(req.query.limit ?? "100", 10) || 100);

    // Distinct flavors, with first-earned timestamp + earn count.
    const rows = await prisma.runAchievement.findMany({
      where: { characterId },
      include: { flavor: true, archetype: { select: { key: true, category: true } } },
      orderBy: { awardedAt: "desc" },
      take: limit * 4, // grab some headroom for distinct compaction below
    });

    const byFlavor = new Map<
      string,
      {
        flavorKey: string;
        archetypeKey: string;
        name: string;
        flavorText: string;
        icon: string;
        severity: string;
        rarity: string;
        firstEarnedAt: string;
        earnCount: number;
      }
    >();
    for (const r of rows) {
      const cur = byFlavor.get(r.flavor.key);
      if (cur) {
        cur.earnCount++;
        if (r.awardedAt.toISOString() < cur.firstEarnedAt) {
          cur.firstEarnedAt = r.awardedAt.toISOString();
        }
      } else {
        byFlavor.set(r.flavor.key, {
          flavorKey: r.flavor.key,
          archetypeKey: r.archetype.key,
          name: r.flavor.name,
          flavorText: r.flavor.flavorText,
          icon: r.flavor.icon,
          severity: r.flavor.severity,
          rarity: r.rarity,
          firstEarnedAt: r.awardedAt.toISOString(),
          earnCount: 1,
        });
      }
    }

    const distinct = Array.from(byFlavor.values()).slice(0, limit);
    return reply.code(200).send({ characterId, distinct, total: distinct.length });
  });
}
