/**
 * Event lifecycle auto-transitions — called by the scheduler worker.
 *
 * Handles the two time-based transitions from docs/EVENT_READY_CHECK_SYSTEM.md §3:
 *   - Posted (open) → In Progress at startsAt
 *   - In Progress → Completed at endsAt
 *
 * Each transition publishes an event_updated notification so the bot
 * refreshes the Discord embed (this is what makes the Ready Check
 * button appear when the event becomes in_progress). Completions also
 * compute results and publish event_completed.
 */

import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { computeEventResults } from "./event-results.js";

const BOT_CHANNEL = "mplus:bot-notifications";

export interface LifecycleSweepResult {
  started: number[];
  completed: number[];
}

/**
 * Transition any due events. Conditional WHERE clauses guard against
 * double-transitions when two sweep ticks overlap.
 */
export async function sweepEventLifecycle(): Promise<LifecycleSweepResult> {
  const now = new Date();
  const started: number[] = [];
  const completed: number[] = [];

  // ── open → in_progress (startsAt reached) ─────────────────────
  const toStart = await prisma.event.findMany({
    where: { status: "open", startsAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of toStart) {
    const { count } = await prisma.event.updateMany({
      where: { id, status: "open" },
      data: { status: "in_progress" },
    });
    if (count === 1) {
      started.push(id);
      await redis
        .publish(BOT_CHANNEL, JSON.stringify({ type: "event_updated", eventId: id }))
        .catch((err) => console.error(`[lifecycle] publish event_updated failed for ${id}:`, err));
    }
  }

  // ── in_progress → completed (endsAt reached) ──────────────────
  const toComplete = await prisma.event.findMany({
    where: { status: "in_progress", endsAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of toComplete) {
    const { count } = await prisma.event.updateMany({
      where: { id, status: "in_progress" },
      data: { status: "completed" },
    });
    if (count !== 1) continue;
    completed.push(id);

    // Clear any leftover priority flags (can't be consumed after completion).
    await prisma.eventSignup.updateMany({
      where: { eventId: id, priorityFlag: true },
      data: { priorityFlag: false },
    });

    try {
      const results = await computeEventResults(id);
      await redis.publish(
        BOT_CHANNEL,
        JSON.stringify({ type: "event_completed", eventId: id, results }),
      );
    } catch (err) {
      console.error(`[lifecycle] failed to compute results for event ${id}:`, err);
    }
    await redis
      .publish(BOT_CHANNEL, JSON.stringify({ type: "event_updated", eventId: id }))
      .catch((err) => console.error(`[lifecycle] publish event_updated failed for ${id}:`, err));
  }

  return { started, completed };
}
