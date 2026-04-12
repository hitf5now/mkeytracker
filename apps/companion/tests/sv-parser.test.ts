/**
 * Unit tests for the SavedVariables Lua parser.
 *
 * Uses a synthesized MKeyTracker.lua body so we don't depend on a real
 * in-game capture to verify the parser logic.
 */

import { describe, it, expect } from "vitest";
import { parseSavedVariablesSource } from "../src/core/sv-parser.js";

const MINIMAL_VALID = `
MKeyTrackerDB = {
    ["pendingRuns"] = {
        {
            ["challengeModeId"] = 239,
            ["keystoneLevel"] = 15,
            ["completionMs"] = 1710000,
            ["onTime"] = true,
            ["upgrades"] = 2,
            ["deaths"] = 0,
            ["timeLostSec"] = 0,
            ["serverTime"] = 1744500000,
            ["affixes"] = { 9, 10, 11 },
            ["region"] = "us",
            ["source"] = "addon",
            ["members"] = {
                { ["name"] = "Tanavast", ["realm"] = "trollbane", ["class"] = "shaman", ["spec"] = "Elemental", ["role"] = "dps" },
                { ["name"] = "Thrall", ["realm"] = "area-52", ["class"] = "shaman", ["spec"] = "Enhancement", ["role"] = "dps" },
                { ["name"] = "Sylvanas", ["realm"] = "tichondrius", ["class"] = "hunter", ["spec"] = "Marksmanship", ["role"] = "dps" },
                { ["name"] = "Anduin", ["realm"] = "stormrage", ["class"] = "priest", ["spec"] = "Holy", ["role"] = "healer" },
                { ["name"] = "Varian", ["realm"] = "stormrage", ["class"] = "warrior", ["spec"] = "Protection", ["role"] = "tank" },
            },
        },
    },
    ["lastCapturedHash"] = "abc123def456",
    ["inbound"] = {},
    ["settings"] = { ["debugMode"] = false },
    ["lastUpdatedAt"] = 1744500000,
}
`;

describe("parseSavedVariablesSource", () => {
  it("parses a minimal valid MKeyTrackerDB", () => {
    const result = parseSavedVariablesSource(MINIMAL_VALID);
    expect(result.rejected).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.runs).toHaveLength(1);
    expect(result.lastCapturedHash).toBe("abc123def456");

    const run = result.runs[0]!;
    expect(run.challengeModeId).toBe(239);
    expect(run.keystoneLevel).toBe(15);
    expect(run.onTime).toBe(true);
    expect(run.upgrades).toBe(2);
    expect(run.deaths).toBe(0);
    expect(run.affixes).toEqual([9, 10, 11]);
    expect(run.region).toBe("us");
    expect(run.members).toHaveLength(5);
    expect(run.members[0]).toEqual({
      name: "Tanavast",
      realm: "trollbane",
      class: "shaman",
      spec: "Elemental",
      role: "dps",
    });
  });

  it("returns empty result for an empty MKeyTrackerDB", () => {
    const source = `MKeyTrackerDB = { ["pendingRuns"] = {}, ["inbound"] = {} }`;
    const result = parseSavedVariablesSource(source);
    expect(result.runs).toEqual([]);
    expect(result.rejected).toBe(0);
  });

  it("returns empty result when MKeyTrackerDB is missing", () => {
    const source = `OtherAddonDB = { foo = 1 }`;
    const result = parseSavedVariablesSource(source);
    expect(result.runs).toEqual([]);
    expect(result.lastCapturedHash).toBeNull();
  });

  it("rejects runs with malformed members and keeps valid siblings", () => {
    const source = `
MKeyTrackerDB = {
    ["pendingRuns"] = {
        {
            ["challengeModeId"] = 239,
            ["keystoneLevel"] = 15,
            ["completionMs"] = 1710000,
            ["onTime"] = true,
            ["upgrades"] = 2,
            ["deaths"] = 0,
            ["serverTime"] = 1744500000,
            ["region"] = "us",
            ["members"] = { { ["name"] = "OnlyOne", ["realm"] = "x", ["class"] = "mage", ["spec"] = "Frost", ["role"] = "dps" } },
        },
        {
            ["challengeModeId"] = 402,
            ["keystoneLevel"] = 18,
            ["completionMs"] = 2000000,
            ["onTime"] = true,
            ["upgrades"] = 1,
            ["deaths"] = 1,
            ["serverTime"] = 1744500100,
            ["region"] = "us",
            ["members"] = {
                { ["name"] = "Tanavast", ["realm"] = "trollbane", ["class"] = "shaman", ["spec"] = "Elemental", ["role"] = "dps" },
                { ["name"] = "Thrall", ["realm"] = "area52", ["class"] = "shaman", ["spec"] = "Enhancement", ["role"] = "dps" },
                { ["name"] = "Sylvanas", ["realm"] = "tichondrius", ["class"] = "hunter", ["spec"] = "Marksmanship", ["role"] = "dps" },
                { ["name"] = "Anduin", ["realm"] = "stormrage", ["class"] = "priest", ["spec"] = "Holy", ["role"] = "healer" },
                { ["name"] = "Varian", ["realm"] = "stormrage", ["class"] = "warrior", ["spec"] = "Protection", ["role"] = "tank" },
            },
        },
    },
}
`;
    const result = parseSavedVariablesSource(source);
    expect(result.runs).toHaveLength(1);
    expect(result.rejected).toBe(1);
    expect(result.errors[0]?.index).toBe(0);
    expect(result.errors[0]?.message).toContain("members");
  });

  it("handles negative numeric literals", () => {
    // Client-side dedup stores lastCapturedHash as string so it stays fine,
    // but placeholder challengeModeIds can be negative in dev seed data.
    const source = `
MKeyTrackerDB = {
    ["pendingRuns"] = {},
    ["testNegative"] = -42,
}
`;
    const result = parseSavedVariablesSource(source);
    expect(result.runs).toEqual([]);
  });

  it("throws on Lua syntax errors", () => {
    expect(() => parseSavedVariablesSource(`MKeyTrackerDB = { foo = `)).toThrow(
      /Lua parse error/,
    );
  });
});
