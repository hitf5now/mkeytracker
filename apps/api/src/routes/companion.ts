/**
 * Companion-only routes.
 *
 *   GET /api/v1/companion/inbound — the payload the companion writes into
 *   the addon's SavedVariables so the game can show a player their own
 *   standing without alt-tabbing.
 *
 * JWT-authenticated: the payload is personal (personal bests, who you have
 * grouped with), so it is scoped to the token's user.
 */

import type { FastifyInstance } from "fastify";
import { requireJwt } from "../plugins/jwt-auth.js";
import { buildInboundPayload } from "../services/companion-inbound.js";

export async function companionRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook("onRequest", requireJwt);

    scope.get<{ Querystring: { season?: string } }>(
      "/companion/inbound",
      async (req, reply) => {
        // requireJwt guarantees this, but the type is optional on the
        // request object shared with unauthenticated routes.
        if (!req.userId) return reply.code(401).send({ error: "unauthorized" });

        const payload = await buildInboundPayload(req.userId, req.query?.season);
        if (!payload) {
          // No characters yet, or no season to report on. The companion
          // leaves `inbound` untouched rather than writing an empty table
          // over data the addon is already using.
          return reply.code(204).send();
        }
        return reply.code(200).send(payload);
      },
    );
  });
}
