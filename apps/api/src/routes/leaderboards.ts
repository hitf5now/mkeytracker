/**
 * Leaderboard routes — all public, no auth.
 *
 *   GET /api/v1/leaderboards                     — catalog of available boards
 *   GET /api/v1/tier-sets                        — current tier art per class
 *   GET /api/v1/leaderboards/champions/:category — best player of each class
 *   GET /api/v1/leaderboards/:category           — one ranked board
 *
 * Query params on the board routes:
 *   ?limit=25          (max 50)
 *   ?season=<slug|id>  defaults to the active season
 *   ?class=<slug>      narrow to one class, e.g. "druid"
 *   ?role=tank|healer|dps
 *
 * Boards are always scoped to a single season — `season=all` is deliberately
 * rejected, because ranking a finished season against a three-week-old one
 * produces a meaningless order.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CLASS_SLUGS } from "@mplus/wow-constants";
import { prisma } from "../lib/prisma.js";
import {
  getLeaderboard,
  getClassChampions,
  listBoards,
  type BoardRole,
} from "../services/leaderboards.js";
import { resolveSeasonParam } from "../services/seasons.js";
import { getTierSets } from "../services/tier-sets.js";

const CategorySchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, "category must be a board key or fastest-clear-<dungeonSlug>");

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  season: z.string().optional(),
  class: z
    .string()
    .refine((v) => CLASS_SLUGS.includes(v), { message: "unknown class" })
    .optional(),
  role: z.enum(["tank", "healer", "dps"]).optional(),
});

/**
 * Shared season resolution for the board routes. Returns either a usable
 * season or the exact error the caller should be sent.
 */
async function resolveBoardSeason(
  seasonParam: string | undefined,
): Promise<
  | { ok: true; season: { id: number; slug: string; name: string } }
  | { ok: false; code: number; body: Record<string, unknown> }
> {
  if (seasonParam === "all") {
    return {
      ok: false,
      code: 400,
      body: {
        error: "season_required",
        message:
          "Leaderboards are ranked within a single season; `all` is not supported.",
      },
    };
  }
  const resolved = await resolveSeasonParam(prisma, seasonParam);
  if (!resolved?.season) {
    return { ok: false, code: 404, body: { error: "season_not_found" } };
  }
  return { ok: true, season: resolved.season };
}

export async function leaderboardsRoutes(app: FastifyInstance): Promise<void> {
  // Catalog — lets the website render the category list and its groupings
  // without keeping its own copy of the board keys.
  app.get("/leaderboards", async (_req, reply) =>
    reply.code(200).send({ boards: listBoards() }),
  );

  // Current-tier armour set art, one per class. Powers the Champions wall.
  // Cached for a week, so this is a Redis read in the normal case.
  app.get("/tier-sets", async (_req, reply) => {
    const result = await getTierSets();
    return reply.code(200).send(result);
  });

  app.get<{
    Params: { category: string };
    Querystring: Record<string, string | undefined>;
  }>("/leaderboards/champions/:category", async (req, reply) => {
    const categoryParse = CategorySchema.safeParse(req.params.category);
    if (!categoryParse.success) {
      return reply.code(400).send({ error: "invalid_category" });
    }
    const queryParse = QuerySchema.safeParse(req.query);
    if (!queryParse.success) {
      return reply
        .code(400)
        .send({ error: "invalid_query", issues: queryParse.error.issues });
    }

    const seasonResult = await resolveBoardSeason(queryParse.data.season);
    if (!seasonResult.ok) {
      return reply.code(seasonResult.code).send(seasonResult.body);
    }

    const result = await getClassChampions({
      category: categoryParse.data,
      seasonId: seasonResult.season.id,
      seasonSlug: seasonResult.season.slug,
      seasonName: seasonResult.season.name,
      roleFilter: (queryParse.data.role as BoardRole | undefined) ?? null,
    });
    if (!result) {
      return reply.code(404).send({
        error: "leaderboard_not_found",
        message: `No such leaderboard in season ${seasonResult.season.slug}.`,
      });
    }
    return reply.code(200).send(result);
  });

  app.get<{
    Params: { category: string };
    Querystring: Record<string, string | undefined>;
  }>("/leaderboards/:category", async (req, reply) => {
    const categoryParse = CategorySchema.safeParse(req.params.category);
    if (!categoryParse.success) {
      return reply.code(400).send({
        error: "invalid_category",
        message: categoryParse.error.issues[0]?.message,
      });
    }

    const queryParse = QuerySchema.safeParse(req.query);
    if (!queryParse.success) {
      return reply.code(400).send({
        error: "invalid_query",
        issues: queryParse.error.issues,
      });
    }

    const seasonResult = await resolveBoardSeason(queryParse.data.season);
    if (!seasonResult.ok) {
      return reply.code(seasonResult.code).send(seasonResult.body);
    }

    const result = await getLeaderboard({
      category: categoryParse.data,
      seasonId: seasonResult.season.id,
      seasonSlug: seasonResult.season.slug,
      seasonName: seasonResult.season.name,
      limit: queryParse.data.limit,
      classFilter: queryParse.data.class ?? null,
      roleFilter: (queryParse.data.role as BoardRole | undefined) ?? null,
    });
    if (!result) {
      return reply.code(404).send({
        error: "leaderboard_not_found",
        message: `No such leaderboard in season ${seasonResult.season.slug}. The dungeon pool changes each season.`,
      });
    }
    return reply.code(200).send(result);
  });
}
