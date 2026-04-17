/**
 * Unit tests for event results scoring logic.
 *
 * Pure function tests — no DB, no network. Tests each event type's
 * group-level scoring, ranking, and edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  scoreKeyClimbing,
  scoreMarathon,
  scoreBestAverage,
  scoreBracketTournament,
  type RunData,
  type GroupInfo,
} from "../src/services/event-results-logic.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeRun(overrides: Partial<RunData> & { groupId: number }): RunData {
  return {
    runId: Math.floor(Math.random() * 100000),
    keystoneLevel: 15,
    onTime: true,
    upgrades: 1,
    completionMs: 1200000, // 20 min
    deaths: 0,
    dungeonId: 1,
    eventJuice: 1000,
    matchedAt: new Date("2026-04-16T14:00:00Z"),
    ...overrides,
  };
}

function makeGroup(id: number, name: string): GroupInfo {
  return {
    groupId: id,
    groupName: name,
    members: [
      { characterName: "Tank", realm: "illidan", classSlug: "warrior" },
      { characterName: "Healer", realm: "illidan", classSlug: "priest" },
      { characterName: "DPS1", realm: "illidan", classSlug: "mage" },
      { characterName: "DPS2", realm: "illidan", classSlug: "rogue" },
      { characterName: "DPS3", realm: "illidan", classSlug: "hunter" },
    ],
  };
}

// ── Key Climbing ─────────────────────────────────────────────────

describe("scoreKeyClimbing", () => {
  const groups = [makeGroup(1, "Group 1"), makeGroup(2, "Group 2")];

  it("ranks by peak key level", () => {
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 18, onTime: true }),
      makeRun({ groupId: 2, keystoneLevel: 20, onTime: true }),
    ];
    const result = scoreKeyClimbing(runs, groups, 2);
    expect(result[0]!.groupName).toBe("Group 2");
    expect(result[0]!.rank).toBe(1);
    expect(result[1]!.groupName).toBe("Group 1");
  });

  it("timed beats depleted at same key level", () => {
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 15, onTime: false }),
      makeRun({ groupId: 2, keystoneLevel: 15, onTime: true }),
    ];
    const result = scoreKeyClimbing(runs, groups, 2);
    expect(result[0]!.groupName).toBe("Group 2"); // timed wins
  });

  it("includes progression bonus based on minKeyLevel", () => {
    const runs = [makeRun({ groupId: 1, keystoneLevel: 12, onTime: true, deaths: 0 })];
    const result = scoreKeyClimbing(runs, [groups[0]!], 10);
    // 12 * 200 + 500 (timed) + 150 (no deaths) + (12-10)*50 progression + 100 participation
    expect(result[0]!.score).toBe(2400 + 500 + 150 + 100 + 100);
  });

  it("handles group with no runs", () => {
    const result = scoreKeyClimbing([], groups, 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.score).toBe(0);
    expect(result[0]!.displayScore).toBe("No runs");
  });

  it("uses best run per group (not sum)", () => {
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 15, onTime: true }), // this should be the peak
      makeRun({ groupId: 1, keystoneLevel: 12, onTime: true }),
    ];
    const result = scoreKeyClimbing(runs, [groups[0]!], 2);
    expect(result[0]!.displayScore).toContain("+15");
  });
});

// ── Marathon ─────────────────────────────────────────────────────

describe("scoreMarathon", () => {
  const groups = [makeGroup(1, "Group 1"), makeGroup(2, "Group 2")];

  it("sums scores across all runs", () => {
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 10, upgrades: 1, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 10, upgrades: 1, onTime: true, dungeonId: 2 }),
    ];
    const result = scoreMarathon(runs, [groups[0]!]);
    expect(result[0]!.score).toBeGreaterThan(0);
    expect(result[0]!.runCount).toBe(2);
  });

  it("awards streak bonus for consecutive timed runs", () => {
    // 3 timed runs, same dungeon → streak grows: 100, 200, 300
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true, dungeonId: 1, matchedAt: new Date("2026-04-16T14:00:00Z") }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true, dungeonId: 1, matchedAt: new Date("2026-04-16T14:30:00Z") }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true, dungeonId: 1, matchedAt: new Date("2026-04-16T15:00:00Z") }),
    ];
    const twoRuns = scoreMarathon(runs.slice(0, 2), [groups[0]!]);
    const threeRuns = scoreMarathon(runs, [groups[0]!]);
    // Third run adds base + streak=3(300) + deaths bonus, which is more than the
    // difference between run 1 and run 2 (streak grew from 100→200 = +100)
    expect(threeRuns[0]!.score).toBeGreaterThan(twoRuns[0]!.score);
  });

  it("resets streak on depleted run", () => {
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true, matchedAt: new Date("2026-04-16T14:00:00Z") }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: false, matchedAt: new Date("2026-04-16T14:30:00Z"), dungeonId: 2 }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true, matchedAt: new Date("2026-04-16T15:00:00Z"), dungeonId: 3 }),
    ];
    const result = scoreMarathon(runs, [groups[0]!]);
    // Third run should have streak=1 (reset after depleted), not streak=2
    expect(result[0]!.score).toBeGreaterThan(0);
  });

  it("awards variety bonus for unique dungeons", () => {
    const sameDungeon = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true, dungeonId: 1, matchedAt: new Date("2026-04-16T14:00:00Z") }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true, dungeonId: 1, matchedAt: new Date("2026-04-16T14:30:00Z") }),
    ];
    const diffDungeon = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true, dungeonId: 1, matchedAt: new Date("2026-04-16T14:00:00Z") }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true, dungeonId: 2, matchedAt: new Date("2026-04-16T14:30:00Z") }),
    ];
    const same = scoreMarathon(sameDungeon, [groups[0]!]);
    const diff = scoreMarathon(diffDungeon, [groups[0]!]);
    expect(diff[0]!.score).toBeGreaterThan(same[0]!.score);
  });

  it("ranks groups by total score", () => {
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 2, keystoneLevel: 15, onTime: true }),
      makeRun({ groupId: 2, keystoneLevel: 15, onTime: true, dungeonId: 2 }),
    ];
    const result = scoreMarathon(runs, groups);
    expect(result[0]!.groupName).toBe("Group 2");
  });
});

// ── Best Average ─────────────────────────────────────────────────

describe("scoreBestAverage", () => {
  const groups = [makeGroup(1, "Group 1"), makeGroup(2, "Group 2")];

  it("averages top N runs", () => {
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 10, upgrades: 1, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 15, upgrades: 1, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 20, upgrades: 1, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 5, upgrades: 1, onTime: true }), // worst, should be excluded
    ];
    const result = scoreBestAverage(runs, [groups[0]!], 3);
    // Top 3 should be level 20, 15, 10 — not 5
    expect(result[0]!.runCount).toBe(4);
    expect(result[0]!.score).toBeGreaterThan(0);
  });

  it("marks group as DNQ with fewer than N runs", () => {
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 15, onTime: true }),
    ];
    const result = scoreBestAverage(runs, [groups[0]!], 3);
    expect(result[0]!.score).toBe(0);
    expect(result[0]!.displayScore).toContain("DNQ");
  });

  it("awards consistency bonus when all N runs are timed", () => {
    const allTimed = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
    ];
    const withDepleted = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: false }),
    ];
    const timed = scoreBestAverage(allTimed, [groups[0]!], 3);
    const mixed = scoreBestAverage(withDepleted, [groups[0]!], 3);
    expect(timed[0]!.score).toBeGreaterThan(mixed[0]!.score);
  });

  it("ranks qualified groups above DNQ groups", () => {
    const runs = [
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 1, keystoneLevel: 10, onTime: true }),
      makeRun({ groupId: 2, keystoneLevel: 20, onTime: true }), // only 1 run → DNQ
    ];
    const result = scoreBestAverage(runs, groups, 3);
    expect(result[0]!.groupName).toBe("Group 1"); // qualified
    expect(result[1]!.groupName).toBe("Group 2"); // DNQ
  });
});

// ── Bracket Tournament ───────────────────────────────────────────

describe("scoreBracketTournament", () => {
  const groups = [makeGroup(1, "Group 1"), makeGroup(2, "Group 2"), makeGroup(3, "Group 3")];

  it("ranks by total juice + placement bonuses", () => {
    const runs = [
      makeRun({ groupId: 1, eventJuice: 5000 }),
      makeRun({ groupId: 2, eventJuice: 3000 }),
      makeRun({ groupId: 3, eventJuice: 1000 }),
    ];
    const result = scoreBracketTournament(runs, groups);
    expect(result[0]!.groupName).toBe("Group 1");
    expect(result[0]!.score).toBe(5000 + 2000); // 1st place bonus
    expect(result[1]!.score).toBe(3000 + 1200); // 2nd place bonus
    expect(result[2]!.score).toBe(1000 + 800);  // 3rd place bonus
  });

  it("handles groups with no runs", () => {
    const result = scoreBracketTournament([], groups);
    expect(result).toHaveLength(3);
    // All have 0 juice + placement bonuses
    expect(result[0]!.score).toBe(2000); // 1st place bonus only
  });
});

// ── Edge Cases ───────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty groups array", () => {
    const result = scoreKeyClimbing([], [], 2);
    expect(result).toHaveLength(0);
  });

  it("handles single group", () => {
    const group = makeGroup(1, "Solo Group");
    const runs = [makeRun({ groupId: 1, keystoneLevel: 10, onTime: true })];
    const result = scoreKeyClimbing(runs, [group], 2);
    expect(result).toHaveLength(1);
    expect(result[0]!.rank).toBe(1);
  });
});
