/**
 * GET /api/v1/users/:userId/dashboard — personal dashboard data.
 *
 * Internal auth only — called by the web server component,
 * not directly by browsers.
 */

import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../plugins/internal-auth.js";
import { getUserDashboard } from "../services/dashboard.js";

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
  });
}
