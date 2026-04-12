/**
 * User-related routes for bot interactions.
 *
 * GET /api/v1/users/by-discord/:discordId/characters — returns a user's
 *   claimed characters with hasCompanionApp flag. Used by the bot when
 *   a user clicks "Sign Up" on an event embed.
 *
 * GET /api/v1/raiderio/lookup — proxies a RaiderIO character lookup.
 *   Used by the bot for manual signup validation.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { fetchCharacter, CharacterNotFoundError } from "../lib/raiderio.js";
import { toRealmSlug } from "../lib/realm.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    // ── Get characters by Discord ID ────────────────────────────
    scope.get<{
      Params: { discordId: string };
    }>("/users/by-discord/:discordId/characters", async (req, reply) => {
      const { discordId } = req.params;
      if (!/^\d{17,20}$/.test(discordId)) {
        return reply.code(400).send({ error: "invalid_discord_id" });
      }

      const user = await prisma.user.findUnique({
        where: { discordId },
        include: {
          characters: {
            where: { userId: { not: null } },
            orderBy: { rioScore: "desc" },
          },
        },
      });

      if (!user) {
        return reply.code(200).send({ user: null, characters: [] });
      }

      return reply.code(200).send({
        user: { id: user.id, discordId: user.discordId },
        characters: user.characters.map((c) => ({
          id: c.id,
          name: c.name,
          realm: c.realm,
          region: c.region,
          class: c.class,
          spec: c.spec,
          role: c.role,
          rioScore: c.rioScore,
          hasCompanionApp: c.hasCompanionApp,
        })),
      });
    });

    // ── RaiderIO character lookup proxy ──────────────────────────
    scope.get<{
      Querystring: { name?: string; realm?: string; region?: string };
    }>("/raiderio/lookup", async (req, reply) => {
      const schema = z.object({
        name: z.string().min(2).max(12),
        realm: z.string().min(1).max(50),
        region: z.enum(["us", "eu", "kr", "tw", "cn"]).default("us"),
      });

      const parsed = schema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_query",
          issues: parsed.error.issues,
        });
      }

      const { name, realm, region } = parsed.data;
      const realmSlug = toRealmSlug(realm);

      try {
        const result = await fetchCharacter(region, realmSlug, name);
        return reply.code(200).send({
          found: true,
          character: {
            name: result.name,
            realm: result.realmSlug,
            region,
            class: result.classSlug,
            spec: result.specName,
            role: result.role,
            rioScore: result.rioScore,
            profileUrl: result.profileUrl,
          },
        });
      } catch (err) {
        if (err instanceof CharacterNotFoundError) {
          return reply.code(200).send({
            found: false,
            character: null,
          });
        }
        req.log.error({ err, name, realm, region }, "RaiderIO lookup failed");
        return reply.code(502).send({
          error: "raiderio_unavailable",
          message: "Could not reach RaiderIO. Try again shortly.",
        });
      }
    });
  });
}
