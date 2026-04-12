/**
 * POST /api/v1/telemetry — anonymous usage + error events from the companion.
 *
 * No auth required. The companion generates a stable install UUID on
 * first run and sends it with every event. The event payload is
 * explicitly anonymous: no character names, realms, Discord IDs, or
 * file paths.
 *
 * Events are batched client-side (up to 20 per POST) so a single
 * request can contain multiple rows.
 *
 * Rate-limited loosely by Fastify's default behavior. Since telemetry
 * is low-volume and anonymous, we accept whatever comes in.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const TelemetryEventSchema = z.object({
  installId: z
    .string()
    .min(8, "installId must be a non-trivial identifier")
    .max(64, "installId is too long"),
  name: z.string().min(1).max(64),
  at: z.string().datetime({ offset: true }),
  version: z.string().min(1).max(32),
  platform: z.string().min(1).max(128),
  meta: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

const TelemetryBatchSchema = z.object({
  events: z.array(TelemetryEventSchema).min(1).max(50),
});

export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/telemetry", async (req, reply) => {
    const parsed = TelemetryBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        issues: parsed.error.issues,
      });
    }

    const { events } = parsed.data;
    try {
      await prisma.telemetryEvent.createMany({
        data: events.map((e) => ({
          installId: e.installId,
          name: e.name,
          appVersion: e.version,
          platform: e.platform,
          meta: e.meta ?? undefined,
          occurredAt: new Date(e.at),
        })),
      });
      return reply.code(204).send();
    } catch (err) {
      req.log.warn({ err }, "telemetry insert failed");
      // Return 204 even on error — telemetry must never be a reason
      // for the client to retry (we don't want backpressure cascades).
      return reply.code(204).send();
    }
  });
}
