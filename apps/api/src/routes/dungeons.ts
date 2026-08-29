/**
 * GET /api/v1/dungeons — dungeon pool for a season.
 *
 * `?season=<slug|id>` selects the season; omitted means the active one.
 * Used by the web event-creation form and by the leaderboards page to build
 * its per-dungeon fastest-clear categories, which must follow the selected
 * season's pool rather than the live one.
 *
 * Public, no auth required.
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveSeasonParam } from "../services/seasons.js";

export async function dungeonsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { season?: string } }>("/dungeons", async (req, reply) => {
    const resolved = await resolveSeasonParam(prisma, req.query?.season);
    if (!resolved?.season) {
      return reply.code(200).send({ season: null, dungeons: [] });
    }

    const dungeons = await prisma.dungeon.findMany({
      where: { seasonId: resolved.season.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        shortCode: true,
        parTimeSec: true,
      },
    });

    return reply.code(200).send({
      season: resolved.season,
      dungeons,
    });
  });
}
