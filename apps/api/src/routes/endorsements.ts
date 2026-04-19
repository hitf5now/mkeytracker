/**
 * Endorsement routes.
 *
 * Called from the web app (Next.js server) on behalf of authenticated
 * users, so protected with internal auth. The web layer is responsible
 * for verifying the user's session before forwarding.
 *
 *   POST /api/v1/endorsements
 *     Body: { giverDiscordId, receiverDiscordId, runId, category, note? }
 *     - Both users must have been in the run (via RunMember.userId)
 *     - Giver must have at least one claimed character
 *     - Giver must have a spendable token
 *     - One endorsement per giver→receiver per run (DB unique)
 *
 *   GET /api/v1/users/:userId/tokens/balance
 *     Returns the user's current spendable token balance, split into
 *     seasonal + starter pools.
 */

import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";
import {
  getTokenBalance,
  spendToken,
} from "../services/endorsement-tokens.js";
import { setFavoriteEndorsement } from "../services/endorsement-stats.js";

// 15 categories defined in prisma/schema.prisma: enum EndorsementCategory.
const CategorySchema = z.enum([
  "great_tank",
  "great_healer",
  "great_dps",
  "interrupt_master",
  "dispel_wizard",
  "cc_master",
  "cooldown_hero",
  "affix_slayer",
  "route_master",
  "patient_teacher",
  "calm_under_pressure",
  "positive_vibes",
  "shot_caller",
  "clutch_saviour",
  "comeback_kid",
]);

const CreateEndorsementSchema = z.object({
  giverUserId: z.number().int().positive(),
  receiverUserId: z.number().int().positive(),
  runId: z.number().int().positive(),
  category: CategorySchema,
  note: z.string().trim().max(280).optional(),
});

export async function endorsementsRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    // ── POST /endorsements — give an endorsement ───────────────
    scope.post("/endorsements", async (req, reply) => {
      const parsed = CreateEndorsementSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", issues: parsed.error.issues });
      }
      const body = parsed.data;

      if (body.giverUserId === body.receiverUserId) {
        return reply.code(400).send({ error: "self_endorsement_not_allowed" });
      }

      const [giver, receiver, run] = await Promise.all([
        prisma.user.findUnique({
          where: { id: body.giverUserId },
          include: {
            characters: {
              where: { userId: { not: null } },
              select: { id: true },
              take: 1,
            },
          },
        }),
        prisma.user.findUnique({
          where: { id: body.receiverUserId },
          select: { id: true },
        }),
        prisma.run.findUnique({
          where: { id: body.runId },
          select: { id: true, seasonId: true },
        }),
      ]);

      if (!giver) return reply.code(404).send({ error: "giver_not_registered" });
      if (!receiver) return reply.code(404).send({ error: "receiver_not_registered" });
      if (!run) return reply.code(404).send({ error: "run_not_found" });

      if (giver.characters.length === 0) {
        return reply.code(403).send({
          error: "giver_no_linked_character",
          message: "Link a character (/register) before giving endorsements.",
        });
      }

      // Both participants must have been in this run (RunMember.userId match).
      const members = await prisma.runMember.findMany({
        where: {
          runId: run.id,
          userId: { in: [giver.id, receiver.id] },
        },
        select: { userId: true },
      });
      const memberUserIds = new Set(members.map((m) => m.userId));
      if (!memberUserIds.has(giver.id)) {
        return reply.code(403).send({ error: "giver_not_in_run" });
      }
      if (!memberUserIds.has(receiver.id)) {
        return reply.code(400).send({ error: "receiver_not_in_run" });
      }

      try {
        const created = await prisma.$transaction(async (tx) => {
          const spent = await spendToken(giver.id, tx);
          if (!spent) {
            throw new InsufficientTokensError();
          }
          return tx.endorsement.create({
            data: {
              giverId: giver.id,
              receiverId: receiver.id,
              runId: run.id,
              category: body.category,
              note: body.note ?? null,
              seasonId: run.seasonId,
            },
          });
        });

        req.log.info(
          {
            endorsementId: created.id,
            giverId: giver.id,
            receiverId: receiver.id,
            runId: run.id,
            category: body.category,
          },
          "Endorsement given",
        );

        // Fire-and-forget notification to the bot. Failures here don't
        // affect the client response — the endorsement is already saved.
        void publishEndorsementGiven({
          endorsementId: created.id,
          giverUserId: giver.id,
          receiverUserId: receiver.id,
          runId: run.id,
          category: body.category,
          note: body.note ?? null,
          log: req.log,
        });

        return reply.code(201).send({
          endorsement: {
            id: created.id,
            giverId: created.giverId,
            receiverId: created.receiverId,
            runId: created.runId,
            category: created.category,
            note: created.note,
            createdAt: created.createdAt.toISOString(),
          },
        });
      } catch (err) {
        if (err instanceof InsufficientTokensError) {
          return reply.code(403).send({
            error: "no_tokens_available",
            message: "You don't have any endorsement tokens to spend.",
          });
        }
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          return reply.code(409).send({
            error: "already_endorsed",
            message: "You've already endorsed this player for this run.",
          });
        }
        throw err;
      }
    });

    // ── GET /users/:userId/tokens/balance ───────────────────────
    scope.get<{ Params: { userId: string } }>(
      "/users/:userId/tokens/balance",
      async (req, reply) => {
        const userId = Number.parseInt(req.params.userId, 10);
        if (!Number.isInteger(userId) || userId <= 0) {
          return reply.code(400).send({ error: "invalid_user_id" });
        }
        const balance = await getTokenBalance(userId);
        return reply.code(200).send(balance);
      },
    );

    // ── PUT /users/:userId/favorite-endorsement ─────────────────
    // Body: { endorsementId: number | null }
    // Sets or clears the user's pinned favorite endorsement. The
    // endorsement must belong to the user as receiver.
    scope.put<{ Params: { userId: string } }>(
      "/users/:userId/favorite-endorsement",
      async (req, reply) => {
        const userId = Number.parseInt(req.params.userId, 10);
        if (!Number.isInteger(userId) || userId <= 0) {
          return reply.code(400).send({ error: "invalid_user_id" });
        }
        const schema = z.object({
          endorsementId: z.number().int().positive().nullable(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send({
            error: "invalid_body",
            issues: parsed.error.issues,
          });
        }
        const ok = await setFavoriteEndorsement(userId, parsed.data.endorsementId);
        if (!ok) {
          return reply.code(403).send({
            error: "not_your_endorsement",
            message: "You can only pin endorsements you received.",
          });
        }
        return reply.code(200).send({ ok: true });
      },
    );
  });
}

class InsufficientTokensError extends Error {
  constructor() {
    super("insufficient_tokens");
  }
}

/**
 * Publish an `endorsement_given` event to the bot-notifications channel.
 *
 * Payload includes everything the bot needs to render the embed and
 * ping the recipient — no further API round-trip required. Channel
 * list is scoped to whichever channels already received this run's
 * run-completed embed (RunDiscordPost rows), so the endorsement lands
 * in the same place as the original announcement.
 */
async function publishEndorsementGiven(args: {
  endorsementId: number;
  giverUserId: number;
  receiverUserId: number;
  runId: number;
  category: string;
  note: string | null;
  log: FastifyBaseLogger;
}): Promise<void> {
  try {
    const [giver, receiver, run, posts] = await Promise.all([
      prisma.user.findUnique({
        where: { id: args.giverUserId },
        select: {
          id: true,
          discordId: true,
          characters: {
            where: {
              userId: { not: null },
              runMembers: { some: { runId: args.runId } },
            },
            select: { name: true, class: true },
            take: 1,
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: args.receiverUserId },
        select: {
          id: true,
          discordId: true,
          characters: {
            where: {
              userId: { not: null },
              runMembers: { some: { runId: args.runId } },
            },
            select: { name: true, class: true },
            take: 1,
          },
        },
      }),
      prisma.run.findUnique({
        where: { id: args.runId },
        select: {
          keystoneLevel: true,
          dungeon: { select: { name: true } },
          dungeonName: true,
        },
      }),
      prisma.runDiscordPost.findMany({
        where: { runId: args.runId },
        select: { channelId: true },
      }),
    ]);

    if (!giver || !receiver || !run) {
      args.log.warn(
        { endorsementId: args.endorsementId },
        "endorsement_given: missing giver/receiver/run — skipping announce",
      );
      return;
    }

    const channelIds = posts.map((p) => p.channelId);
    if (channelIds.length === 0) {
      args.log.info(
        { endorsementId: args.endorsementId, runId: args.runId },
        "endorsement_given: no Discord posts for this run — skipping announce",
      );
      return;
    }

    const giverCharacter = giver.characters[0];
    const receiverCharacter = receiver.characters[0];

    await redis.publish(
      "mplus:bot-notifications",
      JSON.stringify({
        type: "endorsement_given",
        endorsementId: args.endorsementId,
        runId: args.runId,
        category: args.category,
        note: args.note,
        giverDiscordId: giver.discordId,
        receiverDiscordId: receiver.discordId,
        giverCharacterName: giverCharacter?.name ?? null,
        giverCharacterClass: giverCharacter?.class ?? null,
        receiverCharacterName: receiverCharacter?.name ?? null,
        receiverCharacterClass: receiverCharacter?.class ?? null,
        dungeonName: run.dungeonName ?? run.dungeon.name,
        keystoneLevel: run.keystoneLevel,
        channelIds,
      }),
    );
  } catch (err) {
    args.log.warn(
      { err, endorsementId: args.endorsementId },
      "Failed to publish endorsement notification",
    );
  }
}
