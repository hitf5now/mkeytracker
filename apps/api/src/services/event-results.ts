/**
 * Event results service — DB-backed.
 *
 * Fetches run data for a completed event and delegates to the pure
 * scoring logic in event-results-logic.ts.
 */

import { prisma } from "../lib/prisma.js";
import {
  computeStandings,
  type EventResults,
  type RunData,
  type GroupInfo,
} from "./event-results-logic.js";

export type { EventResults, GroupStanding } from "./event-results-logic.js";

export async function computeEventResults(eventId: number): Promise<EventResults> {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: {
      id: true,
      type: true,
      minKeyLevel: true,
      typeConfig: true,
    },
  });

  // Load all groups for this event with their members
  const groups = await prisma.eventGroup.findMany({
    where: { eventId },
    include: {
      members: {
        where: { signupStatus: "confirmed" },
        include: { character: { select: { name: true, realm: true, class: true } } },
      },
    },
  });

  const groupInfos: GroupInfo[] = groups.map((g) => ({
    groupId: g.id,
    groupName: g.name,
    members: g.members.map((m) => ({
      characterName: m.character.name,
      realm: m.character.realm,
      classSlug: m.character.class,
    })),
  }));

  // Load all runs linked to this event via RunEvent
  const runEvents = await prisma.runEvent.findMany({
    where: { eventId },
    include: {
      run: {
        select: {
          id: true,
          keystoneLevel: true,
          onTime: true,
          upgrades: true,
          completionMs: true,
          deaths: true,
          dungeonId: true,
        },
      },
    },
  });

  const runs: RunData[] = runEvents.map((re) => ({
    runId: re.run.id,
    groupId: re.groupId ?? 0,
    keystoneLevel: re.run.keystoneLevel,
    onTime: re.run.onTime,
    upgrades: re.run.upgrades,
    completionMs: re.run.completionMs,
    deaths: re.run.deaths,
    dungeonId: re.run.dungeonId,
    eventJuice: re.eventJuice,
    matchedAt: re.matchedAt,
  }));

  // Extract type-specific config
  const typeConfig = (event.typeConfig as Record<string, unknown>) ?? {};
  const runsToCount = typeof typeConfig.runsToCount === "number" ? typeConfig.runsToCount : 3;

  const standings = computeStandings(event.type, runs, groupInfos, {
    minKeyLevel: event.minKeyLevel,
    runsToCount,
  });

  const totalParticipants = groupInfos.reduce((n, g) => n + g.members.length, 0);

  return {
    eventId,
    eventType: event.type,
    standings,
    totalRuns: runs.length,
    totalParticipants,
  };
}
