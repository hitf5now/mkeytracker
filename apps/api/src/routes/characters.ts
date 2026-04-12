/**
 * Character routes.
 *
 * GET  /api/v1/characters/:region/:realm/:name — public profile endpoint
 * POST /api/v1/characters/:region/:realm/:name/refresh-portrait — refresh Blizzard portraits (internal auth)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { toRealmSlug } from "../lib/realm.js";
import { getCharacterProfile } from "../services/stats.js";
import { fetchCharacterMedia } from "../lib/blizzard.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";

const ParamsSchema = z.object({
  region: z.enum(["us", "eu", "kr", "tw", "cn"]),
  realm: z.string().min(1).max(50),
  name: z.string().min(2).max(12),
});

export async function charactersRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { region: string; realm: string; name: string };
  }>("/characters/:region/:realm/:name", async (req, reply) => {
    const parsed = ParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_params",
        issues: parsed.error.issues,
      });
    }

    const { region } = parsed.data;
    const realm = toRealmSlug(parsed.data.realm);
    const name = parsed.data.name;

    const profile = await getCharacterProfile(region, realm, name);
    if (!profile) {
      return reply.code(404).send({
        error: "character_not_found",
        message: `No character named ${name} on ${realm} (${region}) in our database. They may not have registered yet or been part of any captured run.`,
      });
    }

    return reply.code(200).send(profile);
  });

  // ── Refresh portrait (internal auth) ──────────────────────────
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    scope.post<{
      Params: { region: string; realm: string; name: string };
    }>("/characters/:region/:realm/:name/refresh-portrait", async (req, reply) => {
      const parsed = ParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_params" });
      }

      const { region } = parsed.data;
      const realm = toRealmSlug(parsed.data.realm);
      const name = parsed.data.name;

      const character = await prisma.character.findUnique({
        where: { region_realm_name: { region, realm, name } },
      });
      if (!character) {
        return reply.code(404).send({ error: "character_not_found" });
      }

      const media = await fetchCharacterMedia(region, realm, name);
      if (!media) {
        return reply.code(200).send({ refreshed: false, message: "No portrait available from Blizzard" });
      }

      await prisma.character.update({
        where: { id: character.id },
        data: {
          avatarUrl: media.avatar,
          insetUrl: media.inset,
          mainRawUrl: media.mainRaw,
        },
      });

      return reply.code(200).send({
        refreshed: true,
        avatarUrl: media.avatar,
        insetUrl: media.inset,
        mainRawUrl: media.mainRaw,
      });
    });
  });
}
