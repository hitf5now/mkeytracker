/**
 * Pure event-matching logic — no DB imports.
 *
 * Separated from event-matcher.ts so unit tests can import this
 * without triggering Prisma/env initialization.
 */

export interface CandidateEvent {
  id: number;
  startsAt: Date;
  endsAt: Date;
  dungeonId: number | null;
  minKeyLevel: number;
  maxKeyLevel: number;
  seasonId: number;
  status: string;
}

export interface EventSignupRow {
  eventId: number;
  characterId: number;
  groupId: number | null;
}

export interface GroupMemberCount {
  eventId: number;
  groupId: number;
  totalMembers: number;
}

export interface EventMatch {
  eventId: number;
  groupId: number | null;
  matchedMemberCount: number;
}

/** Filter candidate events by run criteria (time, dungeon, key level, status). */
export function filterCandidateEvents(
  events: CandidateEvent[],
  input: { seasonId: number; dungeonId: number; keystoneLevel: number; serverTime: bigint },
): CandidateEvent[] {
  const runTime = new Date(Number(input.serverTime) * 1000);
  return events.filter((e) =>
    e.status === "in_progress" &&
    e.seasonId === input.seasonId &&
    e.startsAt <= runTime &&
    e.endsAt >= runTime &&
    (e.dungeonId === null || e.dungeonId === input.dungeonId) &&
    e.minKeyLevel <= input.keystoneLevel &&
    e.maxKeyLevel >= input.keystoneLevel,
  );
}

/** Given matched signups and group sizes, determine which groups qualify. */
export function resolveGroupMatches(
  eventId: number,
  signups: EventSignupRow[],
  groupMemberCounts: GroupMemberCount[],
  runMemberCharacterIds: number[],
): EventMatch[] {
  const matches: EventMatch[] = [];

  // Group matched signups by their EventGroup
  const byGroup = new Map<number | null, number[]>();
  for (const signup of signups) {
    if (signup.eventId !== eventId) continue;
    if (!runMemberCharacterIds.includes(signup.characterId)) continue;
    const chars = byGroup.get(signup.groupId) ?? [];
    chars.push(signup.characterId);
    byGroup.set(signup.groupId, chars);
  }

  for (const [groupId, matchedCharIds] of byGroup) {
    if (groupId === null) continue; // Not yet assigned to a group

    const countRow = groupMemberCounts.find(
      (g) => g.eventId === eventId && g.groupId === groupId,
    );
    const totalGroupMembers = countRow?.totalMembers ?? 0;
    if (totalGroupMembers === 0) continue;

    // All signed-up members of this group must be in the run
    if (matchedCharIds.length === totalGroupMembers) {
      matches.push({ eventId, groupId, matchedMemberCount: matchedCharIds.length });
    }
  }

  return matches;
}
