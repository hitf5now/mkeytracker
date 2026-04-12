/**
 * Companion app pairing flow.
 *
 * Two routes:
 *
 *   POST /api/v1/auth/link-code       (internal auth — bot only)
 *     Called by the Discord bot's /link command. Generates a 6-digit
 *     pairing code, stores it in Redis with a 5-minute TTL mapping
 *     code → userId, returns the code to the bot.
 *
 *   POST /api/v1/auth/link-exchange   (no auth)
 *     Called by the companion app's first-run wizard. Swaps a valid
 *     pairing code for a long-lived JWT. One-time use — the code is
 *     deleted after successful exchange.
 *
 * Why this pattern: the user never copy-pastes a raw token. The secret
 * transit is a 6-digit code that only the user sees (Discord ephemeral
 * reply) and is worthless after 5 minutes or a single use.
 */

import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";
import { signUserToken, JWT_EXPIRY_SECONDS } from "../plugins/jwt-auth.js";

const LINK_CODE_TTL_SECONDS = 300; // 5 minutes
const LINK_CODE_KEY_PREFIX = "auth:link:";

function redisKeyForCode(code: string): string {
  return `${LINK_CODE_KEY_PREFIX}${code}`;
}

function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

const LinkCodeRequestSchema = z.object({
  discordId: z.string().regex(/^\d{17,20}$/, "discordId must be a Discord snowflake"),
});

const LinkExchangeRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── /auth/link-code — internal, called by bot ──────────────────
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    scope.post("/auth/link-code", async (req, reply) => {
      const parsed = LinkCodeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
      }

      const user = await prisma.user.findUnique({
        where: { discordId: parsed.data.discordId },
      });
      if (!user) {
        return reply.code(404).send({
          error: "user_not_registered",
          message: "No user found for this Discord ID. Register a character first with /register.",
        });
      }

      // Generate a code with up to 3 retries in the (very unlikely) case
      // of collision with an existing active code.
      let code = generatePairingCode();
      for (let attempt = 0; attempt < 3; attempt++) {
        const ok = await redis.set(
          redisKeyForCode(code),
          user.id.toString(),
          "EX",
          LINK_CODE_TTL_SECONDS,
          "NX",
        );
        if (ok === "OK") break;
        code = generatePairingCode();
      }

      req.log.info({ userId: user.id }, "Issued pairing code");

      return reply.code(200).send({
        code,
        expiresInSeconds: LINK_CODE_TTL_SECONDS,
      });
    });
  });

  // ── /auth/link-exchange — public, called by companion ─────────
  app.post("/auth/link-exchange", async (req, reply) => {
    const parsed = LinkExchangeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }

    const key = redisKeyForCode(parsed.data.code);
    const userIdStr = await redis.get(key);
    if (!userIdStr) {
      return reply.code(404).send({
        error: "code_not_found_or_expired",
        message: "The pairing code is invalid or has expired. Request a new one with /link.",
      });
    }

    // Consume the code immediately so it cannot be used twice.
    await redis.del(key);

    const userId = Number.parseInt(userIdStr, 10);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      // Pairing code pointed to a user that no longer exists. Unlikely
      // but possible if the user was deleted between code issue and
      // exchange.
      return reply.code(404).send({ error: "user_not_found" });
    }

    const token = signUserToken(app, user.id);
    const expiresAt = new Date(Date.now() + JWT_EXPIRY_SECONDS * 1000).toISOString();

    req.log.info({ userId: user.id }, "Issued companion JWT");

    return reply.code(200).send({
      token,
      expiresAt,
      user: {
        id: user.id,
        discordId: user.discordId,
      },
    });
  });
}
