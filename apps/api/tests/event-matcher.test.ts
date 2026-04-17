/**
 * Unit tests for the event matcher service.
 *
 * Tests the pure matching logic (filterCandidateEvents, resolveGroupMatches)
 * without DB access.
 */

import { describe, it, expect } from "vitest";
import {
  filterCandidateEvents,
  resolveGroupMatches,
  type CandidateEvent,
  type EventSignupRow,
  type GroupMemberCount,
} from "../src/services/event-matcher-logic.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
  return {
    id: 1,
    status: "in_progress",
    seasonId: 1,
    dungeonId: null, // any dungeon
    minKeyLevel: 2,
    maxKeyLevel: 40,
    startsAt: new Date("2026-04-16T00:00:00Z"),
    endsAt: new Date("2026-04-16T23:59:59Z"),
    ...overrides,
  };
}

/** Unix seconds for a given ISO string */
function unixSec(iso: string): bigint {
  return BigInt(Math.floor(new Date(iso).getTime() / 1000));
}

const RUN_TIME = unixSec("2026-04-16T14:00:00Z"); // mid-event

// Character IDs for a 5-player party
const PARTY = [101, 102, 103, 104, 105];

// ── filterCandidateEvents ────────────────────────────────────────

describe("filterCandidateEvents", () => {
  const baseInput = { seasonId: 1, dungeonId: 10, keystoneLevel: 15, serverTime: RUN_TIME };

  it("matches an in_progress event within time/key/season", () => {
    const events = [makeEvent()];
    const result = filterCandidateEvents(events, baseInput);
    expect(result).toHaveLength(1);
  });

  it("rejects event not in in_progress status", () => {
    const events = [makeEvent({ status: "open" })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(0);
  });

  it("rejects event with wrong season", () => {
    const events = [makeEvent({ seasonId: 99 })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(0);
  });

  it("rejects run outside event time window (before start)", () => {
    const events = [makeEvent({ startsAt: new Date("2026-04-17T00:00:00Z") })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(0);
  });

  it("rejects run outside event time window (after end)", () => {
    const events = [makeEvent({ endsAt: new Date("2026-04-16T13:00:00Z") })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(0);
  });

  it("matches event with dungeonId = null (any dungeon)", () => {
    const events = [makeEvent({ dungeonId: null })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(1);
  });

  it("matches event with matching dungeonId", () => {
    const events = [makeEvent({ dungeonId: 10 })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(1);
  });

  it("rejects event with different dungeonId", () => {
    const events = [makeEvent({ dungeonId: 99 })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(0);
  });

  it("rejects run below event minKeyLevel", () => {
    const events = [makeEvent({ minKeyLevel: 20 })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(0);
  });

  it("rejects run above event maxKeyLevel", () => {
    const events = [makeEvent({ maxKeyLevel: 10 })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(0);
  });

  it("matches multiple events", () => {
    const events = [makeEvent({ id: 1 }), makeEvent({ id: 2 })];
    expect(filterCandidateEvents(events, baseInput)).toHaveLength(2);
  });
});

// ── resolveGroupMatches ──────────────────────────────────────────

describe("resolveGroupMatches", () => {
  describe("full group (5 members)", () => {
    const signups: EventSignupRow[] = PARTY.map((charId) => ({
      eventId: 1,
      characterId: charId,
      groupId: 10,
    }));
    const groupCounts: GroupMemberCount[] = [
      { eventId: 1, groupId: 10, totalMembers: 5 },
    ];

    it("matches when all 5 group members are in the run", () => {
      const result = resolveGroupMatches(1, signups, groupCounts, PARTY);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ eventId: 1, groupId: 10, matchedMemberCount: 5 });
    });

    it("does NOT match when 1 group member is missing from run", () => {
      const partialParty = [101, 102, 103, 104]; // missing 105
      const result = resolveGroupMatches(1, signups, groupCounts, partialParty);
      expect(result).toHaveLength(0);
    });

    it("does NOT match when run has extra non-event members but missing a group member", () => {
      const wrongParty = [101, 102, 103, 104, 999]; // 999 not in event
      const result = resolveGroupMatches(1, signups, groupCounts, wrongParty);
      expect(result).toHaveLength(0);
    });
  });

  describe("PUG group (< 5 members)", () => {
    // PUG group with 3 signed-up members
    const signups: EventSignupRow[] = [
      { eventId: 1, characterId: 101, groupId: 20 },
      { eventId: 1, characterId: 102, groupId: 20 },
      { eventId: 1, characterId: 103, groupId: 20 },
    ];
    const groupCounts: GroupMemberCount[] = [
      { eventId: 1, groupId: 20, totalMembers: 3 },
    ];

    it("matches when all signed-up PUG members are in the run", () => {
      // Run has 5 players: 3 event members + 2 PUGs
      const result = resolveGroupMatches(1, signups, groupCounts, [101, 102, 103, 201, 202]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ eventId: 1, groupId: 20, matchedMemberCount: 3 });
    });

    it("does NOT match when a signed-up PUG member is missing", () => {
      const result = resolveGroupMatches(1, signups, groupCounts, [101, 102, 201, 202, 203]);
      expect(result).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("returns empty when no signups match run members", () => {
      const signups: EventSignupRow[] = [
        { eventId: 1, characterId: 999, groupId: 10 },
      ];
      const groupCounts: GroupMemberCount[] = [
        { eventId: 1, groupId: 10, totalMembers: 5 },
      ];
      const result = resolveGroupMatches(1, signups, groupCounts, PARTY);
      expect(result).toHaveLength(0);
    });

    it("skips signups with null groupId (not yet assigned)", () => {
      const signups: EventSignupRow[] = PARTY.map((charId) => ({
        eventId: 1,
        characterId: charId,
        groupId: null,
      }));
      const result = resolveGroupMatches(1, signups, [], PARTY);
      expect(result).toHaveLength(0);
    });

    it("matches multiple groups in the same event independently", () => {
      const signups: EventSignupRow[] = [
        // Group A (full)
        ...PARTY.map((charId) => ({ eventId: 1, characterId: charId, groupId: 10 })),
        // Group B (PUG, 2 members) — different characters
        { eventId: 1, characterId: 201, groupId: 20 },
        { eventId: 1, characterId: 202, groupId: 20 },
      ];
      const groupCounts: GroupMemberCount[] = [
        { eventId: 1, groupId: 10, totalMembers: 5 },
        { eventId: 1, groupId: 20, totalMembers: 2 },
      ];

      // Run with group A's full roster
      const resultA = resolveGroupMatches(1, signups, groupCounts, PARTY);
      expect(resultA).toHaveLength(1);
      expect(resultA[0]!.groupId).toBe(10);

      // Run with group B's members + PUGs
      const resultB = resolveGroupMatches(1, signups, groupCounts, [201, 202, 301, 302, 303]);
      expect(resultB).toHaveLength(1);
      expect(resultB[0]!.groupId).toBe(20);
    });

    it("handles run matching events from different events", () => {
      // Same characters signed up for two events
      const signups: EventSignupRow[] = [
        ...PARTY.map((charId) => ({ eventId: 1, characterId: charId, groupId: 10 })),
        ...PARTY.map((charId) => ({ eventId: 2, characterId: charId, groupId: 30 })),
      ];
      const groupCounts: GroupMemberCount[] = [
        { eventId: 1, groupId: 10, totalMembers: 5 },
        { eventId: 2, groupId: 30, totalMembers: 5 },
      ];

      const result1 = resolveGroupMatches(1, signups, groupCounts, PARTY);
      expect(result1).toHaveLength(1);
      expect(result1[0]!.eventId).toBe(1);

      const result2 = resolveGroupMatches(2, signups, groupCounts, PARTY);
      expect(result2).toHaveLength(1);
      expect(result2[0]!.eventId).toBe(2);
    });
  });
});
