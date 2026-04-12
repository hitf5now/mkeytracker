/**
 * GET /api/v1/characters/:region/:realm/:name — public profile endpoint.
 *
 * Returns the character metadata + aggregated stats for the current
 * season. No auth required — all profile data is public (like RaiderIO).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { toRealmSlug } from "../lib/realm.js";
import { getCharacterProfile } from "../services/stats.js";

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
}
