/**
 * GET /api/v1/leaderboards/:category — public leaderboard endpoint.
 *
 * Supported categories:
 *   - season-juice
 *   - highest-key
 *   - most-timed
 *   - fastest-clear-<dungeonSlug>  (e.g. fastest-clear-algethar-academy)
 *
 * Query params:
 *   ?limit=10           (max 50)
 *   ?season=<slug|id>   defaults to the active season
 *
 * Leaderboards are always scoped to one season — `season=all` is
 * deliberately not supported, because ranking a finished season against a
 * three-week-old one produces a meaningless board.
 *
 * No auth required — all leaderboards are public.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getLeaderboard } from "../services/stats.js";
import { resolveSeasonParam } from "../services/seasons.js";

const CategorySchema = z.string().regex(
  /^(season-juice|highest-key|most-timed|fastest-clear-[a-z0-9-]+)$/,
  "category must be one of: season-juice, highest-key, most-timed, fastest-clear-<dungeonSlug>",
);

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  season: z.string().optional(),
});

export async function leaderboardsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { category: string };
    Querystring: { limit?: string; season?: string };
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

    if (queryParse.data.season === "all") {
      return reply.code(400).send({
        error: "season_required",
        message: "Leaderboards are ranked within a single season; `all` is not supported.",
      });
    }

    const resolved = await resolveSeasonParam(prisma, queryParse.data.season);
    if (!resolved?.season) {
      return reply.code(404).send({ error: "season_not_found" });
    }

    const result = await getLeaderboard(
      categoryParse.data,
      queryParse.data.limit,
      resolved.season.id,
    );
    if (!result) {
      return reply.code(404).send({
        error: "leaderboard_not_found",
        message: `No such leaderboard in season ${resolved.season.slug}. The dungeon pool changes each season.`,
      });
    }
    return reply.code(200).send(result);
  });
}
