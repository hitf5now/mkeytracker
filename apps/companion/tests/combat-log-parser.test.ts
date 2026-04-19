/**
 * Regression tests for the combat log aggregator.
 *
 * These cover the Sprint 16 parser fixes:
 *  - Abandon sentinel (CHALLENGE_MODE_END with durationMs=0) triggers a
 *    segment reset, so events from a later START are not merged in.
 *  - SPELL_ABSORBED credits the shield caster with effective healing.
 *  - Heal events count effective healing (amount − overheal − absorbed) and
 *    track overhealing separately.
 *  - SWING_DAMAGE_LANDED is a no-op (SWING_DAMAGE is authoritative).
 */

import { describe, it, expect } from "vitest";
import { parseLine, RunAggregator } from "@mplus/combat-log-parser";

function run(lines: string[]) {
  const agg = new RunAggregator();
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev) agg.process(ev);
  }
  return agg.finalize();
}

// Minimal source/dest 4-token block for a player
const PLAYER_A = `Player-1-AAAAAA00,"Alpha-Realm-US",0x512,0x80000000`;
const PLAYER_B = `Player-1-BBBBBB00,"Bravo-Realm-US",0x512,0x80000000`;
const BOSS = `Creature-0-3023-2874-0-100000-0000000001,"Boss",0xa48,0x80000000`;

// Build a full event line with the real WoW timestamp format.
const T = (hhmmss: string, body: string) =>
  `4/19/2026 ${hhmmss}.000-4  ${body}`;

describe("abandon-sentinel handling", () => {
  it("resets state on CHALLENGE_MODE_END with durationMs=0", () => {
    const summary = run([
      // Key A starts (+6)
      T("11:00:00", "CHALLENGE_MODE_START,Maisara Caverns,2874,560,6,[162]"),
      // Some damage in key A
      T(
        "11:00:05",
        `SPELL_DAMAGE,${PLAYER_A},${BOSS},12345,"Fireball",0x4,100000,0,4,0,0,0,0,false,false,false`,
      ),
      // Abandon sentinel
      T("11:05:00", "CHALLENGE_MODE_END,2874,0,0,0,0.000000,0.000000"),
      // Key B starts (+7) 1 second later
      T("11:05:01", "CHALLENGE_MODE_START,Maisara Caverns,2874,560,7,[162,9]"),
      // Damage in key B
      T(
        "11:05:10",
        `SPELL_DAMAGE,${PLAYER_A},${BOSS},12345,"Fireball",0x4,50000,0,4,0,0,0,0,false,false,false`,
      ),
      // Key B completes successfully
      T("11:10:01", "CHALLENGE_MODE_END,2874,1,7,1383573,271.295959,300.0"),
    ]);

    expect(summary).not.toBeNull();
    // The segment should reflect key B only — the +7 start event.
    expect(summary!.keystoneLevel).toBe(7);
    // Damage should ONLY include the key-B hit (50000), not the key-A hit.
    const alpha = summary!.players.find((p) =>
      p.guid.startsWith("Player-1-AAAAAA00"),
    );
    expect(alpha).toBeDefined();
    expect(alpha!.damageDone).toBe(50000);
  });
});

describe("SPELL_ABSORBED credits shield caster under absorbProvided", () => {
  it("adds absorbed amount to caster's absorbProvided (NOT healingDone)", () => {
    const summary = run([
      T("11:00:00", "CHALLENGE_MODE_START,Maisara Caverns,2874,560,7,[162]"),
      T(
        "11:00:05",
        `SPELL_ABSORBED,${BOSS},${PLAYER_A},${PLAYER_B},17,"Power Word: Shield",0x2,5000,6000,nil`,
      ),
      T("11:05:01", "CHALLENGE_MODE_END,2874,1,7,1383573,100.0,300.0"),
    ]);

    expect(summary).not.toBeNull();
    const bravo = summary!.players.find((p) =>
      p.guid.startsWith("Player-1-BBBBBB00"),
    );
    expect(bravo).toBeDefined();
    expect(bravo!.absorbProvided).toBe(5000);
    // healingDone should NOT include the absorb — that's the option B split.
    expect(bravo!.healingDone).toBe(0);
    // The dest (Alpha) had 5000 of damage directed but 0 taken.
    const alpha = summary!.players.find((p) =>
      p.guid.startsWith("Player-1-AAAAAA00"),
    );
    expect(alpha!.damageTaken).toBe(0);
    expect(alpha!.damageIncoming).toBe(5000);
  });
});

describe("heal events: effective vs overheal", () => {
  it("subtracts overheal+absorbed from healingDone; tracks overheal separately", () => {
    const summary = run([
      T("11:00:00", "CHALLENGE_MODE_START,Maisara Caverns,2874,560,7,[162]"),
      // SPELL_HEAL suffix (heal-only): amount, overhealing, absorbed, critical, extra
      // Raw 10000 heal, 3000 overheal, 500 absorbed -> effective = 6500
      T(
        "11:00:05",
        `SPELL_HEAL,${PLAYER_A},${PLAYER_B},2060,"Flash Heal",0x2,10000,3000,500,false,nil`,
      ),
      T("11:05:01", "CHALLENGE_MODE_END,2874,1,7,1383573,100.0,300.0"),
    ]);

    expect(summary).not.toBeNull();
    const alpha = summary!.players.find((p) =>
      p.guid.startsWith("Player-1-AAAAAA00"),
    );
    expect(alpha).toBeDefined();
    expect(alpha!.healingDone).toBe(6500);
    expect(alpha!.overhealing).toBe(3000);
  });
});

describe("damage directed at tank: taken + incoming", () => {
  it("separates damage taken (post-mitigation) from damage incoming (pre-shield/block/resist)", () => {
    const summary = run([
      T("11:00:00", "CHALLENGE_MODE_START,Maisara Caverns,2874,560,7,[162]"),
      // Boss hits tank: amount=7000, resisted=1000, blocked=500, absorbed=1500.
      // Incoming = 7000 + 1000 + 500 + 1500 = 10000. Taken = 7000.
      T(
        "11:00:05",
        `SPELL_DAMAGE,${BOSS},${PLAYER_A},12345,"Boss Smash",0x1,7000,0,1,1000,500,1500,false,false,false,false`,
      ),
      T("11:05:01", "CHALLENGE_MODE_END,2874,1,7,1383573,100.0,300.0"),
    ]);

    expect(summary).not.toBeNull();
    const alpha = summary!.players.find((p) =>
      p.guid.startsWith("Player-1-AAAAAA00"),
    );
    expect(alpha).toBeDefined();
    expect(alpha!.damageTaken).toBe(7000);
    expect(alpha!.damageIncoming).toBe(10000);
  });
});

describe("self-heal bucket", () => {
  it("credits selfHealing when source = dest", () => {
    const summary = run([
      T("11:00:00", "CHALLENGE_MODE_START,Maisara Caverns,2874,560,7,[162]"),
      // Alpha heals Alpha: amount=10000, overheal=2000, absorbed=0 -> effective 8000
      T(
        "11:00:05",
        `SPELL_HEAL,${PLAYER_A},${PLAYER_A},49998,"Death Strike",0x1,10000,2000,0,false,nil`,
      ),
      T("11:05:01", "CHALLENGE_MODE_END,2874,1,7,1383573,100.0,300.0"),
    ]);

    const alpha = summary!.players.find((p) =>
      p.guid.startsWith("Player-1-AAAAAA00"),
    );
    expect(alpha!.selfHealing).toBe(8000);
    expect(alpha!.healingDone).toBe(8000);
    expect(alpha!.overhealing).toBe(2000);
  });
});

describe("avoidance counts + full-absorb amountMissed", () => {
  it("counts parries/dodges and adds full-absorb amount to damageIncoming", () => {
    const summary = run([
      T("11:00:00", "CHALLENGE_MODE_START,Maisara Caverns,2874,560,7,[162]"),
      // Boss parried by Alpha
      T(
        "11:00:05",
        `SWING_MISSED,${BOSS},${PLAYER_A},PARRY,nil`,
      ),
      // Boss dodged by Alpha
      T(
        "11:00:06",
        `SWING_MISSED,${BOSS},${PLAYER_A},DODGE,nil`,
      ),
      // Boss spell fully absorbed — 4200 mitigated
      T(
        "11:00:07",
        `SPELL_MISSED,${BOSS},${PLAYER_A},99999,"Shadow Bolt",0x20,ABSORB,nil,4200,5000,nil`,
      ),
      T("11:05:01", "CHALLENGE_MODE_END,2874,1,7,1383573,100.0,300.0"),
    ]);

    const alpha = summary!.players.find((p) =>
      p.guid.startsWith("Player-1-AAAAAA00"),
    );
    expect(alpha!.parries).toBe(1);
    expect(alpha!.dodges).toBe(1);
    expect(alpha!.damageIncoming).toBe(4200);
    expect(alpha!.damageTaken).toBe(0);
  });
});

describe("SPELL_CAST_SUCCESS captured in castEvents", () => {
  it("records spellId + offsetMs for player casts", () => {
    const summary = run([
      T("11:00:00", "CHALLENGE_MODE_START,Maisara Caverns,2874,560,7,[162]"),
      // 15 seconds into the run, Alpha casts Tranquility (740)
      T(
        "11:00:15",
        `SPELL_CAST_SUCCESS,${PLAYER_A},0000000000000000,nil,0x80000000,0x80000000,740,"Tranquility",0x8,${PLAYER_A},0000000000000000,100,100,0,0,0,0,0,0,0,0,0,0,0.0,0.0,0,0.0,0`,
      ),
      T("11:05:01", "CHALLENGE_MODE_END,2874,1,7,1383573,100.0,300.0"),
    ]);

    const alpha = summary!.players.find((p) =>
      p.guid.startsWith("Player-1-AAAAAA00"),
    );
    expect(alpha!.castEvents.length).toBe(1);
    expect(alpha!.castEvents[0]!.spellId).toBe(740);
    expect(alpha!.castEvents[0]!.offsetMs).toBe(15000);
  });
});

describe("SWING_DAMAGE_LANDED is not double-counted", () => {
  it("only SWING_DAMAGE contributes to damageDone", () => {
    const summary = run([
      T("11:00:00", "CHALLENGE_MODE_START,Maisara Caverns,2874,560,7,[162]"),
      // SWING_DAMAGE then SWING_DAMAGE_LANDED fire for the same hit.
      // Damage suffix (swing): amount, overkill, school, resisted, blocked, absorbed, critical, glancing, crushing, isOffhand
      T(
        "11:00:05",
        `SWING_DAMAGE,${PLAYER_A},${BOSS},10000,0,1,0,0,0,false,false,false,false`,
      ),
      T(
        "11:00:05",
        `SWING_DAMAGE_LANDED,${PLAYER_A},${BOSS},10000,0,1,0,0,0,false,false,false,false`,
      ),
      T("11:05:01", "CHALLENGE_MODE_END,2874,1,7,1383573,100.0,300.0"),
    ]);

    expect(summary).not.toBeNull();
    const alpha = summary!.players.find((p) =>
      p.guid.startsWith("Player-1-AAAAAA00"),
    );
    expect(alpha).toBeDefined();
    // Should be 10000, not 20000.
    expect(alpha!.damageDone).toBe(10000);
  });
});
