/**
 * Internal auth plugin.
 *
 * Used to gate API routes that are only called by trusted internal
 * services — specifically the Discord bot (server-side, never from
 * a user's browser). Simple pre-shared bearer token.
 *
 * External user-facing routes use JWT (added in a later sprint).
 *
 * Usage in a route file:
 *
 *   app.register(async (scope) => {
 *     scope.addHook("onRequest", requireInternalAuth);
 *     scope.post("/some-internal-route", handler);
 *   });
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";

export async function requireInternalAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "missing_bearer_token" });
  }
  const provided = header.slice("Bearer ".length).trim();
  if (provided !== env.API_INTERNAL_SECRET) {
    req.log.warn(
      { ip: req.ip, route: req.routeOptions.url },
      "Rejected internal auth — token mismatch",
    );
    return reply.code(403).send({ error: "invalid_internal_token" });
  }
}
