/**
 * GET /api/v1/dungeons — returns current season's dungeons.
 *
 * Used by the web event creation form to populate the dungeon dropdown.
 * Public, no auth required.
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export async function dungeonsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dungeons", async (_req, reply) => {
    const season = await prisma.season.findFirst({
      where: { isActive: true },
      include: {
        dungeons: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            slug: true,
            name: true,
            shortCode: true,
            parTimeSec: true,
          },
        },
      },
    });

    if (!season) {
      return reply.code(200).send({ season: null, dungeons: [] });
    }

    return reply.code(200).send({
      season: { id: season.id, slug: season.slug, name: season.name },
      dungeons: season.dungeons,
    });
  });
}
