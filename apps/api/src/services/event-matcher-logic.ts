/**
 * Pure event-matching logic — no DB imports.
 *
 * Under the Ready Check system (docs/EVENT_READY_CHECK_SYSTEM.md §9):
 *   - Only groups in `forming` state are eligible for matching.
 *   - `matched` / `disbanded` / `timed_out` groups are terminal and skipped.
 *   - Temporal filter: a run can only credit a group that existed before
 *     the run completed (assignedAt <= runTime).
 *   - 1:1 rule per event: each group matches at most one run.
 *   - Cross-event: a single run may credit multiple events simultaneously,
 *     one group per event.
 *   - Real-member matching: open slots are PUG seats with no event credit;
 *     the group matches when all its `slot_position IS NOT NULL` signups
 *     are present in the run's character list.
 *
 * Separated from event-matcher.ts so unit tests can import this without
 * triggering Prisma/env initialization.
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

export type GroupState = "forming" | "matched" | "disbanded" | "timed_out";

/** One row per (group, real-member) — signups with slot_position set. */
export interface EventSignupRow {
  eventId: number;
  characterId: number;
  groupId: number | null;
}

export interface GroupInfo {
  eventId: number;
  groupId: number;
  /** Signups with slotPosition != null (real members, not open slots). */
  realMemberCount: number;
  state: GroupState;
  assignedAt: Date;
}

export interface EventMatch {
  eventId: number;
  groupId: number;
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

/**
 * Given matched signups, group info, and run time, determine which groups
 * qualify for this run. A group matches iff:
 *   - state == 'forming'
 *   - assignedAt <= runTime
 *   - all `realMemberCount` signups are in the run's character list
 */
export function resolveGroupMatches(
  eventId: number,
  signups: EventSignupRow[],
  groupInfos: GroupInfo[],
  runMemberCharacterIds: number[],
  runTime: Date,
): EventMatch[] {
  const matches: EventMatch[] = [];

  // Bucket signups by group for this event
  const byGroup = new Map<number, number[]>();
  for (const signup of signups) {
    if (signup.eventId !== eventId) continue;
    if (signup.groupId === null) continue; // unassigned — never matches
    if (!runMemberCharacterIds.includes(signup.characterId)) continue;
    const chars = byGroup.get(signup.groupId) ?? [];
    chars.push(signup.characterId);
    byGroup.set(signup.groupId, chars);
  }

  for (const [groupId, matchedCharIds] of byGroup) {
    const info = groupInfos.find(
      (g) => g.eventId === eventId && g.groupId === groupId,
    );
    if (!info) continue;

    // Terminal states are never eligible.
    if (info.state !== "forming") continue;
    // Temporal filter: a run can't inherit a group that formed after it.
    if (info.assignedAt > runTime) continue;
    // Every real member must be in the run.
    if (info.realMemberCount === 0) continue;
    if (matchedCharIds.length !== info.realMemberCount) continue;

    matches.push({ eventId, groupId, matchedMemberCount: matchedCharIds.length });
  }

  return matches;
}
