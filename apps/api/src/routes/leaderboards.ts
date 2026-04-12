/**
 * GET /api/v1/leaderboards/:category — public leaderboard endpoint.
 *
 * Supported categories:
 *   - season-points
 *   - highest-key
 *   - most-timed
 *   - fastest-clear-<dungeonSlug>  (e.g. fastest-clear-algethar-academy)
 *
 * Query params:
 *   ?limit=10  (max 50)
 *
 * No auth required — all leaderboards are public.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getLeaderboard } from "../services/stats.js";

const CategorySchema = z.string().regex(
  /^(season-points|highest-key|most-timed|fastest-clear-[a-z0-9-]+)$/,
  "category must be one of: season-points, highest-key, most-timed, fastest-clear-<dungeonSlug>",
);

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function leaderboardsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { category: string };
    Querystring: { limit?: string };
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

    const result = await getLeaderboard(
      categoryParse.data,
      queryParse.data.limit,
    );
    return reply.code(200).send(result);
  });
}
