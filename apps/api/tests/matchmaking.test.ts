/**
 * Unit tests for the matchmaking service.
 *
 * Pure function tests — no DB, no network. Tests role-balanced group
 * assignment, bench handling, and companion-app redistribution.
 */

import { describe, it, expect } from "vitest";
import { assignGroups, type SignupForMatching } from "../src/services/matchmaking.js";

function makeSignup(
  overrides: Partial<SignupForMatching> & { rolePreference: "tank" | "healer" | "dps" },
  id?: number,
): SignupForMatching {
  const signupId = id ?? Math.floor(Math.random() * 100000);
  return {
    signupId,
    userId: signupId,
    characterId: signupId,
    characterName: `Player${signupId}`,
    realm: "Illidan",
    hasCompanionApp: false,
    ...overrides,
  };
}

/** Helper: create a balanced pool of N groups worth of signups (1T + 1H + 3D each) */
function makeBalancedPool(groupCount: number, opts?: { companionIds?: number[] }): SignupForMatching[] {
  const signups: SignupForMatching[] = [];
  let id = 1;
  for (let g = 0; g < groupCount; g++) {
    signups.push(makeSignup({ rolePreference: "tank", hasCompanionApp: opts?.companionIds?.includes(id) ?? false }, id++));
    signups.push(makeSignup({ rolePreference: "healer", hasCompanionApp: opts?.companionIds?.includes(id) ?? false }, id++));
    signups.push(makeSignup({ rolePreference: "dps", hasCompanionApp: opts?.companionIds?.includes(id) ?? false }, id++));
    signups.push(makeSignup({ rolePreference: "dps", hasCompanionApp: opts?.companionIds?.includes(id) ?? false }, id++));
    signups.push(makeSignup({ rolePreference: "dps", hasCompanionApp: opts?.companionIds?.includes(id) ?? false }, id++));
  }
  return signups;
}

describe("assignGroups", () => {
  describe("balanced groups", () => {
    it("forms 1 group from exactly 5 balanced signups", () => {
      const pool = makeBalancedPool(1);
      const result = assignGroups(pool);

      expect(result.groups).toHaveLength(1);
      expect(result.benched).toHaveLength(0);
      expect(result.stats.groupsFormed).toBe(1);
      expect(result.stats.totalSignups).toBe(5);
      expect(result.stats.benchedCount).toBe(0);
    });

    it("each group has exactly 1 tank, 1 healer, 3 DPS", () => {
      const pool = makeBalancedPool(3);
      const result = assignGroups(pool);

      expect(result.groups).toHaveLength(3);
      for (const group of result.groups) {
        expect(group.members).toHaveLength(5);
        const tanks = group.members.filter((m) => m.rolePreference === "tank");
        const healers = group.members.filter((m) => m.rolePreference === "healer");
        const dps = group.members.filter((m) => m.rolePreference === "dps");
        expect(tanks).toHaveLength(1);
        expect(healers).toHaveLength(1);
        expect(dps).toHaveLength(3);
      }
    });

    it("forms multiple groups and names them sequentially", () => {
      const pool = makeBalancedPool(4);
      const result = assignGroups(pool);

      expect(result.groups).toHaveLength(4);
      expect(result.groups.map((g) => g.name)).toEqual([
        "Group 1", "Group 2", "Group 3", "Group 4",
      ]);
    });
  });

  describe("limiting role and bench", () => {
    it("benches surplus DPS when tanks are the bottleneck", () => {
      const signups = [
        makeSignup({ rolePreference: "tank" }, 1),
        makeSignup({ rolePreference: "healer" }, 2),
        makeSignup({ rolePreference: "healer" }, 3),
        makeSignup({ rolePreference: "dps" }, 4),
        makeSignup({ rolePreference: "dps" }, 5),
        makeSignup({ rolePreference: "dps" }, 6),
        makeSignup({ rolePreference: "dps" }, 7),
        makeSignup({ rolePreference: "dps" }, 8),
        makeSignup({ rolePreference: "dps" }, 9),
      ];
      const result = assignGroups(signups);

      expect(result.groups).toHaveLength(1);
      expect(result.stats.limitingRole).toBe("tank");
      // Benched: 1 healer + 3 DPS = 4
      expect(result.stats.benchedCount).toBe(4);
      expect(result.benched).toHaveLength(4);
    });

    it("benches surplus when healers are the bottleneck", () => {
      const signups = [
        makeSignup({ rolePreference: "tank" }, 1),
        makeSignup({ rolePreference: "tank" }, 2),
        makeSignup({ rolePreference: "tank" }, 3),
        makeSignup({ rolePreference: "healer" }, 4),
        ...Array.from({ length: 9 }, (_, i) =>
          makeSignup({ rolePreference: "dps" }, 10 + i),
        ),
      ];
      const result = assignGroups(signups);

      expect(result.groups).toHaveLength(1);
      expect(result.stats.limitingRole).toBe("healer");
      // Benched: 2 tanks + 6 DPS = 8
      expect(result.stats.benchedCount).toBe(8);
    });

    it("benches surplus when DPS is the bottleneck", () => {
      const signups = [
        makeSignup({ rolePreference: "tank" }, 1),
        makeSignup({ rolePreference: "tank" }, 2),
        makeSignup({ rolePreference: "tank" }, 3),
        makeSignup({ rolePreference: "healer" }, 4),
        makeSignup({ rolePreference: "healer" }, 5),
        makeSignup({ rolePreference: "healer" }, 6),
        makeSignup({ rolePreference: "dps" }, 7),
        makeSignup({ rolePreference: "dps" }, 8),
      ];
      const result = assignGroups(signups);

      // Only 2 DPS → floor(2/3) = 0 groups
      expect(result.groups).toHaveLength(0);
      expect(result.stats.limitingRole).toBe("dps");
      expect(result.stats.benchedCount).toBe(8);
    });
  });

  describe("edge cases", () => {
    it("returns 0 groups for empty input", () => {
      const result = assignGroups([]);

      expect(result.groups).toHaveLength(0);
      expect(result.benched).toHaveLength(0);
      expect(result.stats.groupsFormed).toBe(0);
      expect(result.stats.benchedCount).toBe(0);
    });

    it("returns 0 groups when all signups are the same role", () => {
      const signups = Array.from({ length: 10 }, (_, i) =>
        makeSignup({ rolePreference: "dps" }, i + 1),
      );
      const result = assignGroups(signups);

      expect(result.groups).toHaveLength(0);
      expect(result.stats.benchedCount).toBe(10);
    });

    it("returns 0 groups when only 2 roles are present", () => {
      const signups = [
        makeSignup({ rolePreference: "tank" }, 1),
        makeSignup({ rolePreference: "dps" }, 2),
        makeSignup({ rolePreference: "dps" }, 3),
        makeSignup({ rolePreference: "dps" }, 4),
      ];
      const result = assignGroups(signups);

      expect(result.groups).toHaveLength(0);
      expect(result.stats.benchedCount).toBe(4);
    });

    it("no duplicate signups across groups and bench", () => {
      const pool = [
        ...makeBalancedPool(2),
        makeSignup({ rolePreference: "dps" }, 999),
        makeSignup({ rolePreference: "tank" }, 998),
      ];
      const result = assignGroups(pool);

      const allIds = [
        ...result.groups.flatMap((g) => g.members.map((m) => m.signupId)),
        ...result.benched.map((b) => b.signupId),
      ];
      expect(new Set(allIds).size).toBe(allIds.length);
      expect(allIds.length).toBe(pool.length);
    });
  });

  describe("companion app redistribution", () => {
    it("swaps companion users between groups when possible", () => {
      // Group 1 gets all companion DPS, Group 2 gets none
      // After redistribution, both groups should have at least 1
      const signups = [
        makeSignup({ rolePreference: "tank", hasCompanionApp: false }, 1),
        makeSignup({ rolePreference: "tank", hasCompanionApp: false }, 2),
        makeSignup({ rolePreference: "healer", hasCompanionApp: false }, 3),
        makeSignup({ rolePreference: "healer", hasCompanionApp: false }, 4),
        makeSignup({ rolePreference: "dps", hasCompanionApp: true }, 5),
        makeSignup({ rolePreference: "dps", hasCompanionApp: true }, 6),
        makeSignup({ rolePreference: "dps", hasCompanionApp: true }, 7),
        makeSignup({ rolePreference: "dps", hasCompanionApp: false }, 8),
        makeSignup({ rolePreference: "dps", hasCompanionApp: false }, 9),
        makeSignup({ rolePreference: "dps", hasCompanionApp: false }, 10),
      ];

      // Run multiple times since shuffle is random
      let redistributedAtLeastOnce = false;
      for (let i = 0; i < 20; i++) {
        const result = assignGroups(signups);
        expect(result.groups).toHaveLength(2);

        const groupsWithCompanion = result.groups.filter((g) =>
          g.members.some((m) => m.hasCompanionApp),
        );
        if (groupsWithCompanion.length === 2) {
          redistributedAtLeastOnce = true;
          break;
        }
      }
      // With redistribution, both groups should eventually get companion users
      expect(redistributedAtLeastOnce).toBe(true);
    });

    it("reports groups without companion users in stats", () => {
      // All 5 signups, nobody has companion
      const pool = makeBalancedPool(1);
      const result = assignGroups(pool);

      expect(result.stats.groupsWithoutCompanion).toBe(1);
    });

    it("reports 0 groups without companion when all have it", () => {
      const signups = [
        makeSignup({ rolePreference: "tank", hasCompanionApp: true }, 1),
        makeSignup({ rolePreference: "healer", hasCompanionApp: true }, 2),
        makeSignup({ rolePreference: "dps", hasCompanionApp: true }, 3),
        makeSignup({ rolePreference: "dps", hasCompanionApp: true }, 4),
        makeSignup({ rolePreference: "dps", hasCompanionApp: true }, 5),
      ];
      const result = assignGroups(signups);

      expect(result.stats.groupsWithoutCompanion).toBe(0);
    });
  });
});
