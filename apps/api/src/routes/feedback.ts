/**
 * Event feedback routes.
 *
 * POST /api/v1/feedback              — submit feedback (token-gated via header)
 * GET  /api/v1/admin/feedback         — list all feedback (internal auth)
 * GET  /api/v1/admin/feedback/summary — aggregate stats (internal auth)
 */

import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { requireInternalAuth } from "../plugins/internal-auth.js";

const VALID_EVENT_TYPES = [
  "key_climbing",
  "marathon",
  "best_average",
  "bracket_tournament",
] as const;

function hashIp(ip: string): string {
  const parts = ip.split(".");
  const truncated = parts.length === 4 ? parts.slice(0, 3).join(".") + ".0" : ip;
  return createHash("sha256").update(truncated).digest("hex").slice(0, 16);
}

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  // ── Public: submit feedback (token-gated) ─────────────────────
  app.post("/feedback", async (req, reply) => {
    const token = (req.headers["x-feedback-token"] as string) ?? "";
    const validTokens = (process.env.FEEDBACK_TOKENS ?? "").split(",").filter(Boolean);

    if (validTokens.length === 0 || !validTokens.includes(token)) {
      return reply.code(404).send({ error: "not_found" });
    }

    // Rate limiting: 1 per (IP, eventType) per 5 min
    const ipHash = hashIp(req.ip);
    const schema = z.object({
      eventType: z.enum(VALID_EVENT_TYPES),
      reviewerName: z.string().min(1).max(100),
      reviewerEmail: z.string().email().max(200).optional().nullable(),
      scoringPreference: z.string().max(50).optional().nullable(),
      scoringRanking: z.array(z.string().max(10)).max(5).optional(),
      ratings: z
        .object({
          fun: z.number().int().min(1).max(5),
          clarity: z.number().int().min(1).max(5),
          competitiveness: z.number().int().min(1).max(5),
        })
        .optional()
        .nullable(),
      comments: z.string().max(4000).optional().nullable(),
      website: z.string().max(0).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }

    // Honeypot
    if (parsed.data.website) {
      return reply.code(200).send({ submitted: true });
    }

    // Rate limit check
    const rateKey = `feedback:rate:${ipHash}:${parsed.data.eventType}`;
    const existing = await redis.get(rateKey);
    if (existing) {
      return reply.code(429).send({ error: "rate_limited", message: "Please wait a few minutes before submitting again." });
    }

    const feedback = await prisma.eventFeedback.create({
      data: {
        eventType: parsed.data.eventType,
        reviewerName: parsed.data.reviewerName,
        reviewerEmail: parsed.data.reviewerEmail ?? null,
        scoringPreference: parsed.data.scoringPreference ?? null,
        scoringRanking: parsed.data.scoringRanking ?? [],
        ratings: parsed.data.ratings ?? undefined,
        comments: parsed.data.comments ?? null,
        submittedViaToken: createHash("sha256").update(token).digest("hex").slice(0, 8),
        submitterIpHash: ipHash,
      },
    });

    await redis.set(rateKey, "1", "EX", 300);

    return reply.code(201).send({ submitted: true, id: feedback.id });
  });

  // ── Admin: list feedback ──────────────────────────────────────
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    scope.get("/admin/feedback", async (req, reply) => {
      const { eventType, page } = req.query as { eventType?: string; page?: string };
      const pageNum = Math.max(1, parseInt(page ?? "1", 10));
      const limit = 50;

      const where = eventType ? { eventType } : {};

      const [items, total] = await Promise.all([
        prisma.eventFeedback.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (pageNum - 1) * limit,
          take: limit,
        }),
        prisma.eventFeedback.count({ where }),
      ]);

      return reply.code(200).send({
        items,
        total,
        page: pageNum,
        pages: Math.ceil(total / limit),
      });
    });

    scope.get("/admin/feedback/summary", async (_req, reply) => {
      const all = await prisma.eventFeedback.findMany({
        select: {
          eventType: true,
          scoringPreference: true,
          ratings: true,
        },
      });

      const summary: Record<string, {
        count: number;
        votes: Record<string, number>;
        avgFun: number;
        avgClarity: number;
        avgCompetitiveness: number;
      }> = {};

      for (const type of VALID_EVENT_TYPES) {
        const items = all.filter((f) => f.eventType === type);
        const votes: Record<string, number> = {};
        let funSum = 0, claritySum = 0, compSum = 0, ratingCount = 0;

        for (const item of items) {
          if (item.scoringPreference) {
            votes[item.scoringPreference] = (votes[item.scoringPreference] ?? 0) + 1;
          }
          if (item.ratings && typeof item.ratings === "object" && item.ratings !== null) {
            const r = item.ratings as { fun?: number; clarity?: number; competitiveness?: number };
            if (r.fun) { funSum += r.fun; ratingCount++; }
            if (r.clarity) claritySum += r.clarity;
            if (r.competitiveness) compSum += r.competitiveness;
          }
        }

        summary[type] = {
          count: items.length,
          votes,
          avgFun: ratingCount ? funSum / ratingCount : 0,
          avgClarity: ratingCount ? claritySum / ratingCount : 0,
          avgCompetitiveness: ratingCount ? compSum / ratingCount : 0,
        };
      }

      return reply.code(200).send({ summary });
    });
  });
}
