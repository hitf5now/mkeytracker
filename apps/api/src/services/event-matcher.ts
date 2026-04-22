/**
 * Event matcher — auto-links submitted runs to active event groups.
 *
 * See docs/EVENT_READY_CHECK_SYSTEM.md §9.
 *
 * Two-phase:
 *   1. matchRunToEvents()  — read-only; returns candidate matches.
 *   2. markGroupsMatched() — atomic transition of groups from `forming`
 *      to `matched`. The write uses a conditional WHERE to prevent two
 *      concurrent uploads from both winning the same group.
 *
 * Call these in sequence from the run-ingestion code path.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  resolveGroupMatches,
  type EventMatch,
  type GroupInfo,
  type GroupState,
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

  // 1. Candidate events
  const candidates = await prisma.event.findMany({
    where: {
      status: "in_progress",
      seasonId: input.seasonId,
      startsAt: { lte: runTime },
      endsAt: { gte: runTime },
      minKeyLevel: { lte: input.keystoneLevel },
      maxKeyLevel: { gte: input.keystoneLevel },
      OR: [{ dungeonId: null }, { dungeonId: input.dungeonId }],
    },
    select: { id: true },
  });

  if (candidates.length === 0) return [];
  const candidateIds = candidates.map((c) => c.id);

  // 2. Confirmed signups for candidate events whose characters are in the run
  const allSignups = await prisma.eventSignup.findMany({
    where: {
      eventId: { in: candidateIds },
      characterId: { in: input.memberCharacterIds },
      signupStatus: "confirmed",
    },
    select: { eventId: true, characterId: true, groupId: true },
  });
  if (allSignups.length === 0) return [];

  // 3. Load group metadata for any groups referenced by the matched signups.
  const groupIds = [
    ...new Set(allSignups.map((s) => s.groupId).filter((g): g is number => g !== null)),
  ];
  if (groupIds.length === 0) return [];

  const groups = await prisma.eventGroup.findMany({
    where: { id: { in: groupIds } },
    select: { id: true, eventId: true, state: true, assignedAt: true },
  });

  // Count REAL members (signups with slotPosition != null) per group.
  const realCounts = await prisma.eventSignup.groupBy({
    by: ["groupId"],
    where: {
      groupId: { in: groupIds },
      slotPosition: { not: null },
      signupStatus: "confirmed",
    },
    _count: { id: true },
  });
  const realCountByGroup = new Map<number, number>();
  for (const row of realCounts) {
    if (row.groupId !== null) realCountByGroup.set(row.groupId, row._count.id);
  }

  const groupInfos: GroupInfo[] = groups.map((g) => ({
    eventId: g.eventId,
    groupId: g.id,
    realMemberCount: realCountByGroup.get(g.id) ?? 0,
    state: g.state as GroupState,
    assignedAt: g.assignedAt,
  }));

  // 4. Resolve per event
  const matches: EventMatch[] = [];
  for (const candidateId of candidateIds) {
    matches.push(
      ...resolveGroupMatches(
        candidateId,
        allSignups,
        groupInfos,
        input.memberCharacterIds,
        runTime,
      ),
    );
  }
  return matches;
}

/**
 * Atomically transition matched groups from `forming` to `matched`. The
 * conditional state filter is the race guard: two concurrent runs trying
 * to claim the same group will have only one `updateMany` report a count.
 *
 * Returns the group IDs that were successfully transitioned (i.e. still
 * eligible at write time). Callers should use THIS list when writing
 * runEvents rows — a group that lost the race should not be credited.
 */
export async function markGroupsMatched(
  groupIds: number[],
  tx: Prisma.TransactionClient = prisma,
): Promise<number[]> {
  if (groupIds.length === 0) return [];

  const now = new Date();
  const claimed: number[] = [];

  // Postgres doesn't let us RETURNING ids via updateMany in Prisma, so do
  // a SELECT-then-UPDATE per id. These are tiny rows and there are at
  // most ~5 matches per run; the O(n) round-trips are fine.
  for (const id of groupIds) {
    const result = await tx.eventGroup.updateMany({
      where: { id, state: "forming" },
      data: { state: "matched", resolvedAt: now },
    });
    if (result.count === 1) claimed.push(id);
  }

  return claimed;
}
