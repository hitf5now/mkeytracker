/**
 * One-off backfill: link run #49 to event 2 / group 2 ("Group 1").
 *
 * Run #49 was rejected by the auto-matcher because Shift (character 137)
 * signed up to the group but switched to Holdmybear (character 139) at run
 * time. The strict-coverage rule in resolveGroupMatches() failed, so
 * Run.eventId / Run.groupId are NULL and no Discord card was ever posted.
 *
 * This script writes the missing links and republishes the
 * `event_group_matched` notification so the bot edits the existing group
 * card into a "run logged" embed (group still has discordMessageId set).
 *
 * Idempotent: re-checks state at every step. Safe to run twice — the
 * second run is a no-op.
 */

import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { scoreRun } from "../src/services/scoring.js";

const RUN_ID = 49;
const EVENT_ID = 2;
const GROUP_ID = 2;

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL not set");

  const prisma = new PrismaClient();
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false });

  try {
    const run = await prisma.run.findUnique({
      where: { id: RUN_ID },
      include: { dungeon: true, members: true },
    });
    if (!run) throw new Error(`Run #${RUN_ID} not found`);
    if (run.eventId !== null || run.groupId !== null) {
      console.log(`Run #${RUN_ID} already linked (eventId=${run.eventId}, groupId=${run.groupId}). Nothing to do.`);
      return;
    }

    const group = await prisma.eventGroup.findUnique({
      where: { id: GROUP_ID },
      include: { event: true },
    });
    if (!group) throw new Error(`EventGroup #${GROUP_ID} not found`);
    if (group.eventId !== EVENT_ID) {
      throw new Error(`EventGroup #${GROUP_ID} belongs to event ${group.eventId}, expected ${EVENT_ID}`);
    }
    if (group.state !== "forming") {
      throw new Error(`EventGroup #${GROUP_ID} is in state '${group.state}', cannot match`);
    }

    const breakdown = scoreRun({
      keystoneLevel: run.keystoneLevel,
      upgrades: run.upgrades as 0 | 1 | 2 | 3,
      onTime: run.onTime,
      deaths: run.deaths,
      isPersonalDungeonRecord: false,
      isPersonalOverallRecord: false,
      isEventParticipation: true,
    });
    const eventJuice = breakdown.total;

    console.log(`Plan: link run #${RUN_ID} → event ${EVENT_ID} / group ${GROUP_ID}, eventJuice=${eventJuice}`);

    await prisma.$transaction(async (tx) => {
      // Race guard mirrors markGroupsMatched(): only transition if still forming.
      const claim = await tx.eventGroup.updateMany({
        where: { id: GROUP_ID, state: "forming" },
        data: { state: "matched", resolvedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new Error(`Failed to claim group #${GROUP_ID} — state changed under us`);
      }

      await tx.runEvent.create({
        data: { runId: RUN_ID, eventId: EVENT_ID, groupId: GROUP_ID, eventJuice },
      });

      await tx.run.update({
        where: { id: RUN_ID },
        data: { eventId: EVENT_ID, groupId: GROUP_ID, eventJuice },
      });
    });

    console.log("DB writes complete.");

    const payload = {
      type: "event_group_matched",
      groupId: GROUP_ID,
      eventId: EVENT_ID,
      runId: RUN_ID,
      dungeonName: run.dungeon.name,
      keystoneLevel: run.keystoneLevel,
      onTime: run.onTime,
      upgrades: run.upgrades,
      completionMs: run.completionMs,
      parMs: run.dungeon.parTimeSec * 1000,
      juice: eventJuice,
    };
    await redis.publish("mplus:bot-notifications", JSON.stringify(payload));
    console.log("Published event_group_matched notification.");
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
