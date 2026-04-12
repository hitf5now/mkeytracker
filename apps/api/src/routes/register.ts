/**
 * Internal registration route.
 *
 * Called by the Discord bot's /register slash command. Validates the
 * character exists on RaiderIO, upserts User by Discord ID, and claims
 * the Character for that user.
 *
 * Auth: pre-shared bearer token (API_INTERNAL_SECRET) via requireInternalAuth.
 * This route must NEVER be exposed to untrusted callers.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  CharacterNotFoundError,
  fetchCharacter,
  RaiderIOError,
  type RaiderIORegion,
} from "../lib/raiderio.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";

const RegisterBodySchema = z.object({
  discordId: z.string().regex(/^\d{17,20}$/, "discordId must be a Discord snowflake"),
  character: z.string().min(2).max(12),
  realm: z.string().min(2).max(50),
  region: z.enum(["us", "eu", "kr", "tw", "cn"]),
});

type RegisterBody = z.infer<typeof RegisterBodySchema>;

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    scope.post<{ Body: RegisterBody }>("/register", async (req, reply) => {
      const parsed = RegisterBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          issues: parsed.error.issues,
        });
      }
      const body = parsed.data;

      // 1. Look up the character on RaiderIO. This both validates existence
      //    and gives us canonical casing + class/spec/role/score.
      let rioChar;
      try {
        rioChar = await fetchCharacter(
          body.region as RaiderIORegion,
          body.realm,
          body.character,
        );
      } catch (err) {
        if (err instanceof CharacterNotFoundError) {
          return reply.code(404).send({
            error: "character_not_found",
            message: `Could not find ${body.character}-${body.realm} (${body.region}) on RaiderIO.`,
          });
        }
        if (err instanceof RaiderIOError) {
          req.log.error({ err }, "RaiderIO lookup failed");
          return reply.code(502).send({
            error: "raiderio_unavailable",
            message: "RaiderIO is temporarily unreachable. Please try again.",
          });
        }
        throw err;
      }

      // 2. Transactional upsert of user + character to keep them consistent.
      //
      // Character resolution semantics:
      //   - No existing row → create owned by this user
      //   - Exists + userId == user.id → update (refresh from RIO)
      //   - Exists + userId == null  → CLAIM (set userId + claimedAt + refresh)
      //   - Exists + userId != user.id → 409 conflict
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { discordId: body.discordId },
          create: { discordId: body.discordId },
          update: {},
        });

        const existing = await tx.character.findUnique({
          where: {
            region_realm_name: {
              region: body.region,
              realm: rioChar.realmSlug,
              name: rioChar.name,
            },
          },
        });

        if (existing && existing.userId !== null && existing.userId !== user.id) {
          return { conflict: true as const, user, existing };
        }

        let character;
        if (existing) {
          // Either we already own it (refresh) or it's unclaimed (claim + refresh).
          const claimingNow = existing.userId === null;
          character = await tx.character.update({
            where: { id: existing.id },
            data: {
              class: rioChar.classSlug,
              spec: rioChar.specName,
              role: rioChar.role,
              rioScore: rioChar.rioScore,
              thumbnailUrl: rioChar.thumbnailUrl,
              ...(claimingNow
                ? { userId: user.id, claimedAt: new Date() }
                : {}),
            },
          });
        } else {
          character = await tx.character.create({
            data: {
              userId: user.id,
              claimedAt: new Date(),
              name: rioChar.name,
              realm: rioChar.realmSlug,
              region: body.region,
              class: rioChar.classSlug,
              spec: rioChar.specName,
              role: rioChar.role,
              rioScore: rioChar.rioScore,
              thumbnailUrl: rioChar.thumbnailUrl,
            },
          });
        }

        return { conflict: false as const, user, character };
      });

      if (result.conflict) {
        return reply.code(409).send({
          error: "character_already_claimed",
          message: `${rioChar.name}-${rioChar.realmSlug} is already linked to a different Discord user.`,
        });
      }

      req.log.info(
        {
          userId: result.user.id,
          characterId: result.character.id,
          rioScore: result.character.rioScore,
        },
        "Registered character",
      );

      return reply.code(200).send({
        user: {
          id: result.user.id,
          discordId: result.user.discordId,
        },
        character: {
          id: result.character.id,
          name: result.character.name,
          realm: result.character.realm,
          region: result.character.region,
          class: result.character.class,
          spec: result.character.spec,
          role: result.character.role,
          rioScore: result.character.rioScore,
          profileUrl: rioChar.profileUrl,
        },
      });
    });
  });
}
