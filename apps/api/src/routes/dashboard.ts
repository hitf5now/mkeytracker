/**
 * Dashboard-adjacent routes (internal auth only — called by web SSR).
 *
 *   GET /api/v1/users/:userId/dashboard    — full personal dashboard
 *   GET /api/v1/users/:userId/runs         — paginated, filterable run list
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalAuth } from "../plugins/internal-auth.js";
import { getUserDashboard } from "../services/dashboard.js";
import { getUserRuns } from "../services/user-runs.js";

const UserRunsQuerySchema = z.object({
  characterId: z.coerce.number().int().positive().optional(),
  dungeonId: z.coerce.number().int().positive().optional(),
  range: z.enum(["7d", "30d", "season", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (scope) => {
    scope.addHook("onRequest", requireInternalAuth);

    scope.get<{ Params: { userId: string } }>(
      "/users/:userId/dashboard",
      async (req, reply) => {
        const userId = parseInt(req.params.userId, 10);
        if (isNaN(userId) || userId <= 0) {
          return reply.code(400).send({ error: "invalid_user_id" });
        }

        const result = await getUserDashboard(userId);
        if (!result) {
          return reply.code(500).send({
            error: "no_active_season",
            message: "No active season configured.",
          });
        }

        return reply.code(200).send(result);
      },
    );

    scope.get<{ Params: { userId: string }; Querystring: unknown }>(
      "/users/:userId/runs",
      async (req, reply) => {
        const userId = parseInt(req.params.userId, 10);
        if (isNaN(userId) || userId <= 0) {
          return reply.code(400).send({ error: "invalid_user_id" });
        }

        const parsed = UserRunsQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return reply.code(400).send({
            error: "invalid_query",
            issues: parsed.error.issues,
          });
        }

        const result = await getUserRuns({ userId, ...parsed.data });
        if (!result) {
          return reply.code(500).send({
            error: "no_active_season",
            message: "No active season configured.",
          });
        }

        return reply.code(200).send(result);
      },
    );
  });
}
