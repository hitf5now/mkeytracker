/**
 * Event matcher — auto-links submitted runs to active events.
 *
 * DB-backed entry point that uses pure matching logic from
 * event-matcher-logic.ts.
 */

import { prisma } from "../lib/prisma.js";
import {
  resolveGroupMatches,
  type EventMatch,
  type GroupMemberCount,
} from "./event-matcher-logic.js";

export type { EventMatch } from "./event-matcher-logic.js";

export interface EventMatchInput {
  seasonId: number;
  dungeonId: number;
  keystoneLevel: number;
  /** Unix seconds at run completion (WoW server time) */
  serverTime: bigint;
  /** Character IDs of all party members in the run */
  memberCharacterIds: number[];
}

export async function matchRunToEvents(
  input: EventMatchInput,
): Promise<EventMatch[]> {
  const runTime = new Date(Number(input.serverTime) * 1000);

  // 1. Find all candidate events
  const candidates = await prisma.event.findMany({
    where: {
      status: "in_progress",
      seasonId: input.seasonId,
      startsAt: { lte: runTime },
      endsAt: { gte: runTime },
      minKeyLevel: { lte: input.keystoneLevel },
      maxKeyLevel: { gte: input.keystoneLevel },
      OR: [
        { dungeonId: null },
        { dungeonId: input.dungeonId },
      ],
    },
    select: { id: true },
  });

  if (candidates.length === 0) return [];

  const matches: EventMatch[] = [];
  const candidateIds = candidates.map((c) => c.id);

  // 2. Load all signups for candidate events that match run members
  const allSignups = await prisma.eventSignup.findMany({
    where: {
      eventId: { in: candidateIds },
      characterId: { in: input.memberCharacterIds },
      signupStatus: "confirmed",
    },
    select: { eventId: true, characterId: true, groupId: true },
  });

  if (allSignups.length === 0) return [];

  // 3. Get group member counts for all relevant groups
  const groupIds = [...new Set(
    allSignups.map((s) => s.groupId).filter((g): g is number => g !== null),
  )];

  const groupCounts: GroupMemberCount[] = groupIds.length > 0
    ? (await prisma.eventSignup.groupBy({
        by: ["eventId", "groupId"],
        where: {
          eventId: { in: candidateIds },
          groupId: { in: groupIds },
          signupStatus: "confirmed",
        },
        _count: { id: true },
      }))
        .filter((row): row is typeof row & { groupId: number } => row.groupId !== null)
        .map((row) => ({
          eventId: row.eventId,
          groupId: row.groupId,
          totalMembers: row._count.id,
        }))
    : [];

  // 4. Resolve matches per event using pure logic
  for (const candidateId of candidateIds) {
    const eventMatches = resolveGroupMatches(
      candidateId,
      allSignups,
      groupCounts,
      input.memberCharacterIds,
    );
    matches.push(...eventMatches);
  }

  return matches;
}
