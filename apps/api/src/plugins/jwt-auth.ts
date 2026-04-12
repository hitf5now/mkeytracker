/**
 * JWT auth plugin.
 *
 * Registers @fastify/jwt with our signing secret and exposes a
 * `requireJwt` preHandler for protected routes. Adds a typed
 * `userId` field to the request after successful verification.
 *
 * Token payload shape:
 *   { sub: string }          // userId as string
 *   { iat: number, exp: number } // standard JWT claims
 *
 * Usage:
 *
 *   app.register(async (scope) => {
 *     scope.addHook("onRequest", requireJwt);
 *     scope.post("/protected", async (req) => req.userId);
 *   });
 */

import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";

/** JWT lifetime for companion app tokens. */
export const JWT_EXPIRY_SECONDS = 60 * 60 * 24 * 30; // 30 days

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by requireJwt on successful verification. */
    userId?: number;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string; iat?: number; exp?: number };
  }
}

export async function registerJwtPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: JWT_EXPIRY_SECONDS,
    },
  });
}

/**
 * onRequest hook: requires a valid JWT in the Authorization header.
 * On success, populates `req.userId`. On failure, responds 401.
 */
export async function requireJwt(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await req.jwtVerify();
    const sub = req.user.sub;
    const parsed = Number.parseInt(sub, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return reply.code(401).send({ error: "invalid_jwt_subject" });
    }
    req.userId = parsed;
  } catch (err) {
    req.log.debug({ err }, "JWT verification failed");
    return reply.code(401).send({ error: "unauthorized" });
  }
}

/**
 * Sign a new token for a user. Expires in 30 days.
 */
export function signUserToken(app: FastifyInstance, userId: number): string {
  return app.jwt.sign({ sub: userId.toString() });
}
