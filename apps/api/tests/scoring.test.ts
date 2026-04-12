/**
 * Unit tests for the scoring service.
 *
 * Pure function tests — no DB, no network. Covers every combination of
 * time modifier × upgrades × bonuses × event participation.
 */

import { describe, it, expect } from "vitest";
import { scoreRun } from "../src/services/scoring.js";

describe("scoreRun", () => {
  describe("base points", () => {
    it("base = keystone level × 100", () => {
      const r = scoreRun({
        keystoneLevel: 10,
        upgrades: 0,
        onTime: true,
        deaths: 0,
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: false,
        isEventParticipation: false,
      });
      expect(r.base).toBe(1000);
    });

    it("base scales linearly with keystone level", () => {
      for (const level of [2, 5, 10, 15, 20, 25]) {
        const r = scoreRun({
          keystoneLevel: level,
          upgrades: 0,
          onTime: true,
          deaths: 10,
          isPersonalDungeonRecord: false,
          isPersonalOverallRecord: false,
          isEventParticipation: false,
        });
        expect(r.base).toBe(level * 100);
      }
    });
  });

  describe("time modifier", () => {
    const base = (level: number, onTime: boolean, upgrades: 0 | 1 | 2 | 3) =>
      scoreRun({
        keystoneLevel: level,
        upgrades,
        onTime,
        deaths: 1, // non-zero so no-death bonus doesn't interfere
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: false,
        isEventParticipation: false,
      });

    it("depleted → 0.5x", () => {
      const r = base(15, false, 0);
      expect(r.timeModifier).toBe(0.5);
      expect(r.afterModifier).toBe(750); // 1500 × 0.5
    });

    it("timed no upgrade → 1.0x", () => {
      const r = base(15, true, 0);
      expect(r.timeModifier).toBe(1.0);
      expect(r.afterModifier).toBe(1500);
    });

    it("timed +1 → 1.2x", () => {
      const r = base(15, true, 1);
      expect(r.timeModifier).toBe(1.2);
      expect(r.afterModifier).toBe(1800);
    });

    it("timed +2 → 1.35x", () => {
      const r = base(15, true, 2);
      expect(r.timeModifier).toBe(1.35);
      expect(r.afterModifier).toBe(2025);
    });

    it("timed +3 → 1.5x", () => {
      const r = base(15, true, 3);
      expect(r.timeModifier).toBe(1.5);
      expect(r.afterModifier).toBe(2250);
    });
  });

  describe("no-death bonus", () => {
    it("0 deaths → +150", () => {
      const r = scoreRun({
        keystoneLevel: 10,
        upgrades: 1,
        onTime: true,
        deaths: 0,
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: false,
        isEventParticipation: false,
      });
      expect(r.bonuses.noDeaths).toBe(150);
      // base=1000, mod=1.2, after=1200, +150 = 1350
      expect(r.total).toBe(1350);
    });

    it("1+ deaths → 0 bonus", () => {
      for (const deaths of [1, 2, 3, 10]) {
        const r = scoreRun({
          keystoneLevel: 10,
          upgrades: 1,
          onTime: true,
          deaths,
          isPersonalDungeonRecord: false,
          isPersonalOverallRecord: false,
          isEventParticipation: false,
        });
        expect(r.bonuses.noDeaths).toBe(0);
        expect(r.total).toBe(1200);
      }
    });

    it("no-death bonus applies even on depleted runs", () => {
      const r = scoreRun({
        keystoneLevel: 10,
        upgrades: 0,
        onTime: false,
        deaths: 0,
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: false,
        isEventParticipation: false,
      });
      // base=1000, mod=0.5, after=500, +150 = 650
      expect(r.total).toBe(650);
    });
  });

  describe("personal record bonuses", () => {
    it("personal dungeon record → +200", () => {
      const r = scoreRun({
        keystoneLevel: 10,
        upgrades: 1,
        onTime: true,
        deaths: 1,
        isPersonalDungeonRecord: true,
        isPersonalOverallRecord: false,
        isEventParticipation: false,
      });
      expect(r.bonuses.personalDungeonRecord).toBe(200);
      expect(r.total).toBe(1400); // 1200 + 200
    });

    it("personal overall record → +500", () => {
      const r = scoreRun({
        keystoneLevel: 10,
        upgrades: 1,
        onTime: true,
        deaths: 1,
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: true,
        isEventParticipation: false,
      });
      expect(r.bonuses.personalOverallRecord).toBe(500);
      expect(r.total).toBe(1700); // 1200 + 500
    });

    it("both records stack", () => {
      const r = scoreRun({
        keystoneLevel: 10,
        upgrades: 1,
        onTime: true,
        deaths: 1,
        isPersonalDungeonRecord: true,
        isPersonalOverallRecord: true,
        isEventParticipation: false,
      });
      expect(r.total).toBe(1900); // 1200 + 200 + 500
    });
  });

  describe("event participation", () => {
    it("event flag → +100", () => {
      const r = scoreRun({
        keystoneLevel: 10,
        upgrades: 1,
        onTime: true,
        deaths: 1,
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: false,
        isEventParticipation: true,
      });
      expect(r.bonuses.eventParticipation).toBe(100);
      expect(r.total).toBe(1300); // 1200 + 100
    });
  });

  describe("reference run from MPLUS_PLATFORM.md", () => {
    // From the spec:
    //   Stonevault +15, timed +2, 0 deaths, personal dungeon record
    //   = (15 × 100) × 1.35 + 150 + 200 = 2,375 pts
    it("matches the spec's reference calculation", () => {
      const r = scoreRun({
        keystoneLevel: 15,
        upgrades: 2,
        onTime: true,
        deaths: 0,
        isPersonalDungeonRecord: true,
        isPersonalOverallRecord: false,
        isEventParticipation: false,
      });
      expect(r.base).toBe(1500);
      expect(r.timeModifier).toBe(1.35);
      expect(r.afterModifier).toBe(2025);
      expect(r.bonuses.noDeaths).toBe(150);
      expect(r.bonuses.personalDungeonRecord).toBe(200);
      expect(r.total).toBe(2375);
    });
  });

  describe("reference run from live production", () => {
    // From the first real run we ever captured:
    //   Algeth'ar Academy +2, timed +2, 3 deaths
    //   base=200 × 1.35 = 270, no bonuses
    //   → stored points = 270
    it("matches the first-ever live captured run", () => {
      const r = scoreRun({
        keystoneLevel: 2,
        upgrades: 2,
        onTime: true,
        deaths: 3,
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: false,
        isEventParticipation: false,
      });
      expect(r.total).toBe(270);
    });
  });

  describe("rounding", () => {
    it("rounds afterModifier to an integer", () => {
      // 7 × 100 = 700, 700 × 1.35 = 945 (exact)
      const r1 = scoreRun({
        keystoneLevel: 7,
        upgrades: 2,
        onTime: true,
        deaths: 1,
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: false,
        isEventParticipation: false,
      });
      expect(r1.afterModifier).toBe(945);
      expect(Number.isInteger(r1.total)).toBe(true);

      // 9 × 100 = 900, 900 × 1.35 = 1215 (exact)
      const r2 = scoreRun({
        keystoneLevel: 9,
        upgrades: 2,
        onTime: true,
        deaths: 1,
        isPersonalDungeonRecord: false,
        isPersonalOverallRecord: false,
        isEventParticipation: false,
      });
      expect(r2.afterModifier).toBe(1215);
    });
  });
});
