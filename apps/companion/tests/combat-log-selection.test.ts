import { describe, expect, it } from "vitest";
import { parseCombatLogStart } from "../src/core/combat-log.js";

/**
 * Log selection used to always take the newest file. That is right for a run
 * that just finished, but the addon queues runs in SavedVariables and the
 * companion may not flush for days — a backlog then matched against the
 * wrong log and was rejected as `segment_mismatch`. Eleven Season 2 runs
 * lost their combat data that way, which is what these pin.
 */
describe("parseCombatLogStart", () => {
  it("reads WoW's MMDDYY_HHMMSS filename as local time", () => {
    const t = parseCombatLogStart("WoWCombatLog-082626_190539.txt");
    expect(t).not.toBeNull();
    const d = new Date(t!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // August, zero-indexed
    expect(d.getDate()).toBe(26);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(5);
    expect(d.getSeconds()).toBe(39);
  });

  it("handles midnight and end-of-year without rolling over", () => {
    const d = new Date(parseCombatLogStart("WoWCombatLog-123125_000000.txt")!);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
    expect(d.getHours()).toBe(0);
  });

  it("returns null for the un-rolled log, which carries no timestamp", () => {
    // This file must fall through to the newest-file path rather than be
    // treated as covering some arbitrary window.
    expect(parseCombatLogStart("WoWCombatLog.txt")).toBeNull();
  });

  it("returns null for names that only look like logs", () => {
    expect(parseCombatLogStart("WoWCombatLog-backup.txt")).toBeNull();
    expect(parseCombatLogStart("WoWCombatLog-0826_1905.txt")).toBeNull();
    expect(parseCombatLogStart("NotACombatLog-082626_190539.txt")).toBeNull();
  });
});
