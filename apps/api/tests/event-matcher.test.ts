/**
 * Unit tests for the event-matcher pure logic.
 *
 * Covers §9 of docs/EVENT_READY_CHECK_SYSTEM.md:
 *   - Only `forming` groups match; terminal states skip.
 *   - Temporal filter: runs that completed before a group was assigned can't credit it.
 *   - Real-member matching: open slots are ignored; the group matches when
 *     all its real (slot-assigned) members are in the run.
 *   - Cross-event: one run may credit multiple events simultaneously.
 */

import { describe, it, expect } from "vitest";
import {
  filterCandidateEvents,
  resolveGroupMatches,
  type CandidateEvent,
  type EventSignupRow,
  type GroupInfo,
} from "../src/services/event-matcher-logic.js";

function makeEvent(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
  return {
    id: 1,
    status: "in_progress",
    seasonId: 1,
    dungeonId: null,
    minKeyLevel: 2,
    maxKeyLevel: 40,
    startsAt: new Date("2026-04-16T00:00:00Z"),
    endsAt: new Date("2026-04-16T23:59:59Z"),
    ...overrides,
  };
}

function unixSec(iso: string): bigint {
  return BigInt(Math.floor(new Date(iso).getTime() / 1000));
}

const RUN_ISO = "2026-04-16T14:00:00Z";
const RUN_TIME = new Date(RUN_ISO);
const RUN_SERVER_TIME = unixSec(RUN_ISO);
const BEFORE_RUN = new Date("2026-04-16T13:00:00Z"); // group assigned before run
const AFTER_RUN = new Date("2026-04-16T15:00:00Z"); // group assigned after run
const PARTY = [101, 102, 103, 104, 105];

// ── filterCandidateEvents (unchanged) ────────────────────────────

describe("filterCandidateEvents", () => {
  const baseInput = { seasonId: 1, dungeonId: 10, keystoneLevel: 15, serverTime: RUN_SERVER_TIME };

  it("matches an in_progress event within time/key/season", () => {
    expect(filterCandidateEvents([makeEvent()], baseInput)).toHaveLength(1);
  });

  it("rejects event not in in_progress status", () => {
    expect(filterCandidateEvents([makeEvent({ status: "open" })], baseInput)).toHaveLength(0);
  });

  it("rejects different season / dungeon / time / key range", () => {
    expect(filterCandidateEvents([makeEvent({ seasonId: 99 })], baseInput)).toHaveLength(0);
    expect(filterCandidateEvents([makeEvent({ dungeonId: 99 })], baseInput)).toHaveLength(0);
    expect(filterCandidateEvents([makeEvent({ startsAt: new Date("2026-04-17T00:00:00Z") })], baseInput)).toHaveLength(0);
    expect(filterCandidateEvents([makeEvent({ maxKeyLevel: 10 })], baseInput)).toHaveLength(0);
  });
});

// ── resolveGroupMatches (Ready Check rules) ──────────────────────

describe("resolveGroupMatches", () => {
  describe("full skeleton (5 real members)", () => {
    const signups: EventSignupRow[] = PARTY.map((charId) => ({
      eventId: 1,
      characterId: charId,
      groupId: 10,
    }));
    const formingGroup: GroupInfo = {
      eventId: 1,
      groupId: 10,
      realMemberCount: 5,
      state: "forming",
      assignedAt: BEFORE_RUN,
    };

    it("matches when all 5 real members are in the run", () => {
      const r = resolveGroupMatches(1, signups, [formingGroup], PARTY, RUN_TIME);
      expect(r).toEqual([{ eventId: 1, groupId: 10, matchedMemberCount: 5 }]);
    });

    it("does NOT match when a real member is missing", () => {
      const r = resolveGroupMatches(1, signups, [formingGroup], [101, 102, 103, 104], RUN_TIME);
      expect(r).toHaveLength(0);
    });

    it("does NOT match `matched` group (terminal state)", () => {
      const matched: GroupInfo = { ...formingGroup, state: "matched" };
      const r = resolveGroupMatches(1, signups, [matched], PARTY, RUN_TIME);
      expect(r).toHaveLength(0);
    });

    it("does NOT match `disbanded` group", () => {
      const disbanded: GroupInfo = { ...formingGroup, state: "disbanded" };
      const r = resolveGroupMatches(1, signups, [disbanded], PARTY, RUN_TIME);
      expect(r).toHaveLength(0);
    });

    it("does NOT match `timed_out` group", () => {
      const timedOut: GroupInfo = { ...formingGroup, state: "timed_out" };
      const r = resolveGroupMatches(1, signups, [timedOut], PARTY, RUN_TIME);
      expect(r).toHaveLength(0);
    });

    it("does NOT match a group assigned AFTER the run (temporal filter)", () => {
      const future: GroupInfo = { ...formingGroup, assignedAt: AFTER_RUN };
      const r = resolveGroupMatches(1, signups, [future], PARTY, RUN_TIME);
      expect(r).toHaveLength(0);
    });
  });

  describe("skeleton with open slots (PUG seats)", () => {
    // 3 real members in positions tank, healer, dps1. Open slots: dps2, dps3.
    const signups: EventSignupRow[] = [
      { eventId: 1, characterId: 101, groupId: 20 },
      { eventId: 1, characterId: 102, groupId: 20 },
      { eventId: 1, characterId: 103, groupId: 20 },
    ];
    const formingGroup: GroupInfo = {
      eventId: 1,
      groupId: 20,
      realMemberCount: 3, // 2 open slots
      state: "forming",
      assignedAt: BEFORE_RUN,
    };

    it("matches when all 3 real members are in the run (pickups fill the opens)", () => {
      const run = [101, 102, 103, 301, 302]; // 301/302 = PUGs, not event signups
      const r = resolveGroupMatches(1, signups, [formingGroup], run, RUN_TIME);
      expect(r).toEqual([{ eventId: 1, groupId: 20, matchedMemberCount: 3 }]);
    });

    it("does NOT match when a real member is absent, even if PUGs fill every other slot", () => {
      const run = [101, 102, 301, 302, 303];
      const r = resolveGroupMatches(1, signups, [formingGroup], run, RUN_TIME);
      expect(r).toHaveLength(0);
    });
  });

  describe("multi-group and cross-event", () => {
    it("matches multiple independent groups within one event", () => {
      const signups: EventSignupRow[] = [
        ...PARTY.map((c) => ({ eventId: 1, characterId: c, groupId: 10 })),
        { eventId: 1, characterId: 201, groupId: 20 },
        { eventId: 1, characterId: 202, groupId: 20 },
      ];
      const groups: GroupInfo[] = [
        { eventId: 1, groupId: 10, realMemberCount: 5, state: "forming", assignedAt: BEFORE_RUN },
        { eventId: 1, groupId: 20, realMemberCount: 2, state: "forming", assignedAt: BEFORE_RUN },
      ];

      const runA = resolveGroupMatches(1, signups, groups, PARTY, RUN_TIME);
      expect(runA).toEqual([{ eventId: 1, groupId: 10, matchedMemberCount: 5 }]);

      const runB = resolveGroupMatches(1, signups, groups, [201, 202, 301, 302, 303], RUN_TIME);
      expect(runB).toEqual([{ eventId: 1, groupId: 20, matchedMemberCount: 2 }]);
    });

    it("one run can credit multiple events simultaneously", () => {
      const signups: EventSignupRow[] = [
        ...PARTY.map((c) => ({ eventId: 1, characterId: c, groupId: 10 })),
        ...PARTY.map((c) => ({ eventId: 2, characterId: c, groupId: 30 })),
      ];
      const groups: GroupInfo[] = [
        { eventId: 1, groupId: 10, realMemberCount: 5, state: "forming", assignedAt: BEFORE_RUN },
        { eventId: 2, groupId: 30, realMemberCount: 5, state: "forming", assignedAt: BEFORE_RUN },
      ];

      const result1 = resolveGroupMatches(1, signups, groups, PARTY, RUN_TIME);
      const result2 = resolveGroupMatches(2, signups, groups, PARTY, RUN_TIME);
      expect(result1).toEqual([{ eventId: 1, groupId: 10, matchedMemberCount: 5 }]);
      expect(result2).toEqual([{ eventId: 2, groupId: 30, matchedMemberCount: 5 }]);
    });
  });

  describe("edge cases", () => {
    it("returns empty when no signups match the run", () => {
      const signups: EventSignupRow[] = [{ eventId: 1, characterId: 999, groupId: 10 }];
      const groups: GroupInfo[] = [
        { eventId: 1, groupId: 10, realMemberCount: 1, state: "forming", assignedAt: BEFORE_RUN },
      ];
      const r = resolveGroupMatches(1, signups, groups, PARTY, RUN_TIME);
      expect(r).toHaveLength(0);
    });

    it("skips signups not assigned to a group", () => {
      const signups: EventSignupRow[] = PARTY.map((c) => ({
        eventId: 1,
        characterId: c,
        groupId: null,
      }));
      const r = resolveGroupMatches(1, signups, [], PARTY, RUN_TIME);
      expect(r).toHaveLength(0);
    });
  });
});
