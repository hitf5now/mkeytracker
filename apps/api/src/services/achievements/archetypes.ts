/**
 * Archetype registry — every trigger condition that exists today.
 *
 * Each archetype is a code-backed predicate. A trigger's `match()` returns
 * either `false` (didn't fire) or `{ reason }` (fired, with the sentence to
 * show under the badge). When an archetype fires, the seed loader's
 * `AchievementFlavor` rows under that archetype provide the user-facing
 * names + copy; the selector picks one weighted by rarity with anti-repeat.
 *
 * Adding a new trigger archetype:
 *   1. Add a new entry in `playerArchetypes` or `partyArchetypes` below.
 *   2. Author one or more flavor cards under that archetype's `key` in the
 *      seed JSON (apps/api/prisma/seeds/achievements/).
 *   3. Run the admin reload endpoint or `npm run seed:achievements`.
 */

import { activeAvgBucket, formatNumber, pctOf, secToMMSS } from "./helpers.js";
import type {
  ArchetypeRegistry,
  PartyArchetype,
  PartyCompositeArchetype,
  PlayerArchetype,
  PlayerCompositeArchetype,
  TriggeredArchetype,
} from "./types.js";

// ─── Per-player archetypes ────────────────────────────────────────────────

const playerArchetypes: PlayerArchetype[] = [
  // ── Universal ────────────────────────────────────────────────────────
  {
    key: "many_deaths_self",
    category: "comedic",
    roleGate: null,
    description: "Player died 5+ times.",
    match: (ctx) =>
      ctx.player.deaths >= 5
        ? { reason: `You died ${ctx.player.deaths} times in this run.` }
        : false,
  },
  {
    key: "most_deaths_in_party",
    category: "comedic",
    roleGate: null,
    description:
      "Player died the most in the party (>1 death, > everyone else).",
    match: (ctx) => {
      if (ctx.party.maxDeaths < 2) return false;
      if (ctx.player.deaths <= 1) return false;
      if (ctx.player.deaths !== ctx.party.maxDeaths) return false;
      return {
        reason: `You had ${ctx.player.deaths} deaths — more than anyone else in the party.`,
      };
    },
  },
  {
    key: "majority_of_party_deaths",
    category: "comedic",
    roleGate: null,
    description:
      "Player accounted for >50% of party deaths (party deaths >= 4, self deaths >= 3).",
    match: (ctx) => {
      if (ctx.party.partyDeaths < 4) return false;
      if (ctx.player.deaths < 3) return false;
      if (ctx.player.deaths / ctx.party.partyDeaths <= 0.5) return false;
      return {
        reason: `You accounted for ${ctx.player.deaths} of ${ctx.party.partyDeaths} party deaths (${pctOf(ctx.player.deaths, ctx.party.partyDeaths)}).`,
      };
    },
  },
  {
    key: "zero_interrupts_offensive",
    category: "comedic",
    roleGate: null, // applies to dps OR tank — we'll split via two role-gated archetypes if needed
    description:
      "Tank or DPS landed zero interrupts while the rest of the party did kick.",
    match: (ctx) => {
      if (ctx.role !== "tank" && ctx.role !== "dps") return false;
      if (ctx.party.totalInterrupts <= 0) return false;
      if (ctx.player.interrupts !== 0) return false;
      return {
        reason: `You interrupted 0 casts. The rest of the party landed ${ctx.party.totalInterrupts}.`,
      };
    },
  },
  {
    key: "top_interrupts_in_party",
    category: "performance",
    roleGate: null,
    description: "Player landed the most interrupts (>=3 party max, >0).",
    match: (ctx) => {
      if (ctx.party.maxInterrupts < 3) return false;
      if (ctx.player.interrupts <= 0) return false;
      if (ctx.player.interrupts !== ctx.party.maxInterrupts) return false;
      return { reason: `${ctx.player.interrupts} interrupts — the most in the party.` };
    },
  },

  // ── DPS roasts ───────────────────────────────────────────────────────
  {
    key: "second_lowest_dps",
    category: "comedic",
    roleGate: "dps",
    description: "DPS finished second-from-bottom on the meter (>=3 DPS in party).",
    match: (ctx) => {
      if (ctx.party.dps.length < 3) return false;
      const sorted = [...ctx.party.dps].sort((a, b) => a.damage - b.damage);
      if (sorted[1]?.playerId !== ctx.player.id) return false;
      return {
        reason: `Second-lowest DPS in the party at ${formatNumber(ctx.damageDone)} total damage.`,
      };
    },
  },
  {
    key: "outdamaged_by_tank",
    category: "comedic",
    roleGate: "dps",
    description: "DPS did less damage than the tank.",
    match: (ctx) => {
      const tank = ctx.party.tank;
      if (!tank || tank.damage <= 0) return false;
      if (ctx.damageDone >= tank.damage) return false;
      return {
        reason: `Tank did ${formatNumber(tank.damage)}. You did ${formatNumber(ctx.damageDone)}.`,
      };
    },
  },
  {
    key: "outdamaged_by_healer",
    category: "comedic",
    roleGate: "dps",
    description: "DPS did less damage than the healer.",
    match: (ctx) => {
      const healer = ctx.party.healer;
      if (!healer || healer.damage <= 0) return false;
      if (ctx.damageDone >= healer.damage) return false;
      return {
        reason: `Healer did ${formatNumber(healer.damage)} damage. You did ${formatNumber(ctx.damageDone)}.`,
      };
    },
  },
  {
    key: "low_damage_share_dps",
    category: "comedic",
    roleGate: "dps",
    description: "DPS contributed <10% of party damage.",
    match: (ctx) => {
      if (ctx.party.totalDamage <= 0 || ctx.damageDone <= 0) return false;
      if (ctx.damageDone / ctx.party.totalDamage >= 0.1) return false;
      return {
        reason: `${formatNumber(ctx.damageDone)} damage — only ${pctOf(ctx.damageDone, ctx.party.totalDamage)} of the party total.`,
      };
    },
  },
  {
    key: "flat_burst_profile",
    category: "shape",
    roleGate: "dps",
    description:
      "DPS's peak 5s window is <1.3× their active-combat average (no real burst).",
    match: (ctx) => {
      const peak = ctx.player.peakDamage ?? 0;
      const aavg = activeAvgBucket(ctx.player.damageBuckets);
      if (peak <= 0 || aavg <= 0) return false;
      if (peak / aavg >= 1.3) return false;
      const ratio = (peak / aavg).toFixed(2);
      return {
        reason: `Peak 5s window was only ${ratio}× your active-combat average. Real burst specs hit 2×+.`,
      };
    },
  },
  {
    key: "single_burst_majority",
    category: "shape",
    roleGate: "dps",
    description:
      "DPS's peak 5s window held >25% of their entire run damage.",
    match: (ctx) => {
      const peak = ctx.player.peakDamage ?? 0;
      if (peak <= 0 || ctx.damageDone <= 0) return false;
      if (peak / ctx.damageDone <= 0.25) return false;
      return {
        reason: `A single 5-second window held ${pctOf(peak, ctx.damageDone)} of your entire run's damage.`,
      };
    },
  },
  {
    key: "narrowly_outdpsed",
    category: "comedic",
    roleGate: "dps",
    description:
      "DPS finished within 500 DPS below another DPS (lower of the pair).",
    match: (ctx) => {
      if (ctx.party.dps.length < 2) return false;
      const myDps = ctx.averageDps;
      if (myDps <= 0) return false;
      let closest: { dps: number; gap: number } | null = null;
      for (const other of ctx.party.dps) {
        if (other.playerId === ctx.player.id) continue;
        const otherDps = other.damage / ctx.party.runDurationSec;
        const gap = otherDps - myDps;
        if (gap > 0 && gap < 500 && (closest === null || gap < closest.gap)) {
          closest = { dps: otherDps, gap };
        }
      }
      if (!closest) return false;
      return {
        reason: `You averaged ${formatNumber(Math.round(myDps))} DPS — just ${Math.round(closest.gap)} under the DPS above you (${formatNumber(Math.round(closest.dps))}).`,
      };
    },
  },

  // ── DPS praise ───────────────────────────────────────────────────────
  {
    key: "top_damage_in_party",
    category: "performance",
    roleGate: "dps",
    description: "DPS topped the party damage meter.",
    match: (ctx) => {
      if (ctx.party.totalDamage <= 0) return false;
      if (ctx.party.topDamagePlayerId !== ctx.player.id) return false;
      return {
        reason: `${formatNumber(ctx.damageDone)} total damage — the top in the party.`,
      };
    },
  },
  {
    key: "carry_damage_share",
    category: "performance",
    roleGate: "dps",
    description: "DPS contributed >40% of total party damage.",
    match: (ctx) => {
      if (ctx.party.totalDamage <= 0) return false;
      if (ctx.damageDone / ctx.party.totalDamage <= 0.4) return false;
      return {
        reason: `You did ${formatNumber(ctx.damageDone)} — ${pctOf(ctx.damageDone, ctx.party.totalDamage)} of all party damage.`,
      };
    },
  },
  {
    key: "biggest_burst_in_party",
    category: "performance",
    roleGate: "dps",
    description:
      "DPS had the highest peak/active-avg ratio among party DPS, >4×.",
    match: (ctx) => {
      if (ctx.party.dps.length < 2) return false;
      const peak = ctx.player.peakDamage ?? 0;
      const aavg = activeAvgBucket(ctx.player.damageBuckets);
      if (peak <= 0 || aavg <= 0) return false;
      const myRatio = peak / aavg;
      if (myRatio <= 4.0) return false;
      const dpsIds = new Set(ctx.party.dps.map((d) => d.playerId));
      for (const other of ctx.allPlayers) {
        if (other.id === ctx.player.id) continue;
        if (!dpsIds.has(other.id)) continue;
        const op = other.peakDamage ?? 0;
        const oa = activeAvgBucket(other.damageBuckets);
        if (oa <= 0) continue;
        if (op / oa > myRatio) return false;
      }
      return {
        reason: `Peak 5s burst was ${myRatio.toFixed(1)}× your active-combat average — the largest spike among the party's DPS.`,
      };
    },
  },

  // ── Healer ───────────────────────────────────────────────────────────
  {
    key: "many_party_deaths_as_healer",
    category: "comedic",
    roleGate: "healer",
    description: "4+ party deaths happened on the healer's watch.",
    match: (ctx) => {
      if (ctx.party.partyDeaths < 4) return false;
      return {
        reason: `${ctx.party.partyDeaths} party members died while you were on healing duty.`,
      };
    },
  },
  {
    key: "high_overheal_ratio",
    category: "comedic",
    roleGate: "healer",
    description: "Healer's overheal share of total raw heals exceeded 50%.",
    match: (ctx) => {
      const overheal = ctx.player.overhealing;
      const effective = ctx.healingDone;
      if (overheal <= 0 || effective + overheal <= 0) return false;
      const ratio = overheal / (overheal + effective);
      if (ratio <= 0.5) return false;
      const pct = Math.round(ratio * 100);
      return {
        reason: `${pct}% of your raw healing was overheal (${overheal.toLocaleString()} wasted on topped-off targets).`,
      };
    },
  },
  {
    key: "zero_dispels_as_healer",
    category: "comedic",
    roleGate: "healer",
    description: "Healer landed zero dispels while the rest of the party did.",
    match: (ctx) => {
      if (ctx.party.totalDispels <= 0) return false;
      if (ctx.player.dispels !== 0) return false;
      return {
        reason: `You dispelled 0 effects. The rest of the party landed ${ctx.party.totalDispels}.`,
      };
    },
  },
  {
    key: "healer_outdamages_dps",
    category: "performance",
    roleGate: "healer",
    description: "Healer dealt more damage than at least one party DPS.",
    match: (ctx) => {
      if (ctx.damageDone <= 0 || ctx.party.dps.length === 0) return false;
      const beaten = ctx.party.dps
        .filter((d) => d.damage < ctx.damageDone)
        .sort((a, b) => a.damage - b.damage)[0];
      if (!beaten) return false;
      return {
        reason: `You did ${formatNumber(ctx.damageDone)} damage — above a party DPS who did ${formatNumber(beaten.damage)}.`,
      };
    },
  },
  {
    key: "healer_zero_deaths",
    category: "performance",
    roleGate: "healer",
    description: "Healer survived the entire run without dying.",
    match: (ctx) =>
      ctx.player.deaths === 0
        ? {
            reason:
              "You finished the run without a single death. A healer who stays up keeps the party up.",
          }
        : false,
  },
  {
    key: "top_dispels_in_party",
    category: "performance",
    roleGate: "healer",
    description: "Healer landed the most dispels (>=3 party max, >0).",
    match: (ctx) => {
      if (ctx.party.maxDispels < 3) return false;
      if (ctx.player.dispels <= 0) return false;
      if (ctx.player.dispels !== ctx.party.maxDispels) return false;
      return {
        reason: `${ctx.player.dispels} dispels — the most in the party (party total: ${ctx.party.totalDispels}).`,
      };
    },
  },
  {
    key: "zero_party_deaths_as_healer",
    category: "performance",
    roleGate: "healer",
    description: "Zero party deaths on the healer's watch.",
    match: (ctx) =>
      ctx.party.partyDeaths === 0
        ? {
            reason:
              "Zero party deaths across the entire run. You carried the cups and didn't spill one.",
          }
        : false,
  },

  // ── Tank ─────────────────────────────────────────────────────────────
  {
    key: "tank_overheals_self",
    category: "comedic",
    roleGate: "tank",
    description: "Tank's self-overheal share exceeded 60%.",
    match: (ctx) => {
      const overheal = ctx.player.overhealing;
      const effective = ctx.healingDone;
      if (effective <= 0 || overheal <= 0) return false;
      const ratio = overheal / (overheal + effective);
      if (ratio <= 0.6) return false;
      const pct = Math.round(ratio * 100);
      return {
        reason: `${pct}% of your self-healing was overheal (${overheal.toLocaleString()} wasted pressing defensives at near-full HP).`,
      };
    },
  },
  {
    key: "tank_zero_interrupts",
    category: "comedic",
    roleGate: "tank",
    description: "Tank landed zero interrupts while the rest of the party did.",
    match: (ctx) => {
      if (ctx.party.totalInterrupts <= 0) return false;
      if (ctx.player.interrupts !== 0) return false;
      return {
        reason: `You interrupted 0 casts. The rest of the party landed ${ctx.party.totalInterrupts}.`,
      };
    },
  },
  {
    key: "tank_most_deaths",
    category: "comedic",
    roleGate: "tank",
    description:
      "Tank led the party in deaths (>=2 deaths, ties or beats every other player).",
    match: (ctx) => {
      if (ctx.player.deaths < 2) return false;
      if (ctx.player.deaths !== ctx.party.maxDeaths) return false;
      if (ctx.party.maxDeaths <= 0) return false;
      return {
        reason: `You died ${ctx.player.deaths} times — the most in the party.`,
      };
    },
  },
  {
    key: "tank_zero_deaths",
    category: "performance",
    roleGate: "tank",
    description: "Tank survived the entire run without dying.",
    match: (ctx) =>
      ctx.player.deaths === 0
        ? { reason: "You tanked the entire run without a single death." }
        : false,
  },

  // ── Sprint 16 batch 1.4 — new archetypes ────────────────────────────
  {
    key: "tank_any_death",
    category: "comedic",
    roleGate: "tank",
    description:
      "Tank died at least once (any count). Lower-bar than tank_most_deaths " +
      "so single-death tanks get a card too.",
    match: (ctx) => {
      if (ctx.player.deaths < 1) return false;
      const word = ctx.player.deaths === 1 ? "time" : "times";
      return {
        reason: `You died ${ctx.player.deaths} ${word} as the tank.`,
      };
    },
  },
  {
    key: "solo_interrupter",
    category: "performance",
    roleGate: null,
    description:
      "Single player landed 75%+ of party interrupts (party total >= 8).",
    match: (ctx) => {
      if (ctx.party.totalInterrupts < 8) return false;
      const share = ctx.player.interrupts / ctx.party.totalInterrupts;
      if (share < 0.75) return false;
      const pct = Math.round(share * 100);
      return {
        reason: `${ctx.player.interrupts} interrupts — ${pct}% of the party total.`,
      };
    },
  },
  {
    key: "survived_chaos",
    category: "performance",
    roleGate: null,
    description:
      "Player took zero deaths while the party racked up 4 or more.",
    match: (ctx) => {
      if (ctx.player.deaths !== 0) return false;
      if (ctx.party.partyDeaths < 4) return false;
      return {
        reason: `Zero deaths while the party racked up ${ctx.party.partyDeaths}.`,
      };
    },
  },
];

// ─── Party-wide archetypes ───────────────────────────────────────────────

const partyArchetypes: PartyArchetype[] = [
  {
    key: "party_zero_deaths",
    category: "performance",
    description: "No party deaths the entire run.",
    match: (ctx) => {
      if (ctx.players.length === 0) return false;
      if (ctx.run.deaths !== 0) return false;
      return { reason: "The entire run finished without a single party death." };
    },
  },
  {
    key: "plus_three",
    category: "milestone",
    description: "Run finished as a +3 keystone upgrade.",
    match: (ctx) => {
      if (ctx.run.upgrades !== 3) return false;
      return {
        reason: `Finished +3 in ${secToMMSS(Math.round(ctx.run.completionMs / 1000))} (par ${secToMMSS(Math.round(ctx.run.parMs / 1000))}).`,
      };
    },
  },
  {
    key: "personal_record",
    category: "milestone",
    description: "Run set a personal best for this dungeon and/or affix combo.",
    match: (ctx) => {
      if (!ctx.run.isMapRecord && !ctx.run.isAffixRecord) return false;
      if (ctx.run.isMapRecord && ctx.run.isAffixRecord) {
        return {
          reason:
            "New personal best for both this dungeon AND this affix combo.",
        };
      }
      if (ctx.run.isMapRecord) {
        return { reason: "New personal best for this dungeon." };
      }
      return { reason: "New personal best for this affix combo." };
    },
  },
  {
    key: "depleted",
    category: "comedic",
    description: "Run failed to beat the timer.",
    match: (ctx) => {
      if (ctx.run.onTime) return false;
      const overSec = Math.max(
        0,
        Math.round((ctx.run.completionMs - ctx.run.parMs) / 1000),
      );
      return { reason: `Finished ${secToMMSS(overSec)} over the timer.` };
    },
  },
  {
    key: "deeply_depleted",
    category: "comedic",
    description: "Run depleted by >25% over par.",
    match: (ctx) => {
      if (ctx.run.onTime) return false;
      if (ctx.run.completionMs <= ctx.run.parMs * 1.25) return false;
      const ratio = Math.round((ctx.run.completionMs / ctx.run.parMs) * 100);
      return { reason: `Clear time was ${ratio}% of par — deeply depleted.` };
    },
  },
  {
    key: "high_time_lost",
    category: "comedic",
    description: "Deaths added more than 60s to the run clock.",
    match: (ctx) => {
      if (ctx.run.timeLostSec <= 60) return false;
      return {
        reason: `Deaths added ${ctx.run.timeLostSec}s (${secToMMSS(ctx.run.timeLostSec)}) to the clock.`,
      };
    },
  },
  {
    key: "everyone_died",
    category: "comedic",
    description: "Every player in the party died at least once.",
    match: (ctx) => {
      if (ctx.players.length < 4) return false;
      if (!ctx.players.every((p) => p.deaths >= 1)) return false;
      return {
        reason: `All ${ctx.players.length} party members died at least once.`,
      };
    },
  },

  // ── Sprint 16 batch 1.4 — new archetypes ────────────────────────────
  {
    key: "clutch_finish",
    category: "performance",
    description:
      "Run timed with 30 seconds or less remaining on the timer.",
    match: (ctx) => {
      if (!ctx.run.onTime) return false;
      const remainingMs = ctx.run.parMs - ctx.run.completionMs;
      if (remainingMs > 30_000) return false;
      if (remainingMs < 0) return false;
      const remainingSec = Math.max(0, Math.round(remainingMs / 1000));
      return {
        reason: `Timed with ${remainingSec}s remaining.`,
      };
    },
  },
];

// ─── Composite archetypes (pass-2) ───────────────────────────────────────
//
// Composite archetypes don't read raw run data — they read the *list of
// base archetypes that fired in pass 1*. They light up when meaningful
// patterns emerge across multiple base triggers (e.g., "all praise no
// roast", "the whole party got roasted"). Always epic or legendary —
// they're rare by construction.

const positiveCount = (t: TriggeredArchetype[]): number =>
  t.filter((x) => x.severity === "positive").length;
const negativeCount = (t: TriggeredArchetype[]): number =>
  t.filter((x) => x.severity === "negative").length;
const hasKey = (t: TriggeredArchetype[], key: string): boolean =>
  t.some((x) => x.archetypeKey === key);

const playerCompositeArchetypes: PlayerCompositeArchetype[] = [
  {
    key: "flawless_player",
    category: "performance",
    roleGate: null,
    description:
      "Player triggered ≥2 positive base archetypes, 0 negatives, 0 deaths.",
    match: (ctx) => {
      if (ctx.player.deaths !== 0) return false;
      const t = ctx.triggeredForPlayer;
      if (positiveCount(t) < 2) return false;
      if (negativeCount(t) !== 0) return false;
      return {
        reason: `${positiveCount(t)} positive achievements, no roasts, no deaths.`,
      };
    },
  },
  {
    key: "disaster_player",
    category: "comedic",
    roleGate: null,
    description:
      "Player triggered ≥3 negative base archetypes and 0 positives.",
    match: (ctx) => {
      const t = ctx.triggeredForPlayer;
      if (negativeCount(t) < 3) return false;
      if (positiveCount(t) !== 0) return false;
      return {
        reason: `${negativeCount(t)} roasts, zero praise. A complete-set run.`,
      };
    },
  },
  {
    key: "mixed_bag",
    category: "comedic",
    roleGate: null,
    description: "Player triggered both ≥1 positive AND ≥1 negative.",
    match: (ctx) => {
      const t = ctx.triggeredForPlayer;
      if (positiveCount(t) < 1) return false;
      if (negativeCount(t) < 1) return false;
      return {
        reason: `${positiveCount(t)} praise, ${negativeCount(t)} roast — both sides at once.`,
      };
    },
  },
  {
    key: "damage_clean_sweep",
    category: "performance",
    roleGate: "dps",
    description:
      "DPS triggered top_damage_in_party AND carry_damage_share AND biggest_burst_in_party.",
    match: (ctx) => {
      const t = ctx.triggeredForPlayer;
      if (!hasKey(t, "top_damage_in_party")) return false;
      if (!hasKey(t, "carry_damage_share")) return false;
      if (!hasKey(t, "biggest_burst_in_party")) return false;
      return {
        reason: "Top damage, 40%+ share, AND biggest burst — full sweep.",
      };
    },
  },
  {
    key: "dragged_down",
    category: "comedic",
    roleGate: null,
    description:
      "Player triggered ≥3 negative base archetypes AND the run depleted.",
    match: (ctx) => {
      if (ctx.run.onTime) return false;
      const t = ctx.triggeredForPlayer;
      if (negativeCount(t) < 3) return false;
      return {
        reason: `${negativeCount(t)} roasts on a depleted run. The recap has receipts.`,
      };
    },
  },
  {
    key: "wing_man",
    category: "performance",
    roleGate: null,
    description:
      "Player triggered ≥2 positive base archetypes on a depleted run.",
    match: (ctx) => {
      if (ctx.run.onTime) return false;
      const t = ctx.triggeredForPlayer;
      if (positiveCount(t) < 2) return false;
      return {
        reason: `${positiveCount(t)} praises on a depleted run. You held up your end.`,
      };
    },
  },
];

const partyCompositeArchetypes: PartyCompositeArchetype[] = [
  {
    key: "flawless_party",
    category: "performance",
    description:
      "Every player triggered ≥1 positive AND zero of them triggered any negative.",
    match: (ctx) => {
      if (ctx.players.length < 4) return false;
      let totalPositives = 0;
      for (const p of ctx.players) {
        const t = ctx.triggeredByPlayer.get(p.id) ?? [];
        const pos = positiveCount(t);
        const neg = negativeCount(t);
        if (pos < 1) return false;
        if (neg > 0) return false;
        totalPositives += pos;
      }
      return {
        reason: `Every party member earned praise (${totalPositives} total) — zero roasts across the run.`,
      };
    },
  },
  {
    key: "roast_party",
    category: "comedic",
    description:
      "Every player triggered ≥1 negative base archetype.",
    match: (ctx) => {
      if (ctx.players.length < 4) return false;
      let totalRoasts = 0;
      for (const p of ctx.players) {
        const t = ctx.triggeredByPlayer.get(p.id) ?? [];
        const neg = negativeCount(t);
        if (neg < 1) return false;
        totalRoasts += neg;
      }
      return {
        reason: `Every party member earned a roast (${totalRoasts} total). The whole cup spilled.`,
      };
    },
  },
  {
    key: "silent_run",
    category: "comedic",
    description:
      "Total triggered base archetypes across all players ≤2 (the boringly-average run).",
    match: (ctx) => {
      if (ctx.players.length < 4) return false;
      let total = 0;
      for (const p of ctx.players) {
        total += (ctx.triggeredByPlayer.get(p.id) ?? []).length;
      }
      total += ctx.triggeredForParty.length;
      if (total > 2) return false;
      return {
        reason: `Only ${total} achievement${total === 1 ? "" : "s"} fired across the entire run. Pure mid.`,
      };
    },
  },
  {
    key: "praise_storm",
    category: "performance",
    description:
      "≥10 positive base archetypes triggered party-wide (across players + party).",
    match: (ctx) => {
      let total = positiveCount(ctx.triggeredForParty);
      for (const t of ctx.triggeredByPlayer.values()) total += positiveCount(t);
      if (total < 10) return false;
      return {
        reason: `${total} positive achievements fired party-wide. The juice was flowing.`,
      };
    },
  },
];

export const archetypeRegistry: ArchetypeRegistry = {
  player: playerArchetypes,
  party: partyArchetypes,
  playerComposite: playerCompositeArchetypes,
  partyComposite: partyCompositeArchetypes,
};

/** Lookup by key — used by the seed loader to validate orphan flavors. */
export const archetypeKeys: Set<string> = new Set([
  ...playerArchetypes.map((a) => a.key),
  ...partyArchetypes.map((a) => a.key),
  ...playerCompositeArchetypes.map((a) => a.key),
  ...partyCompositeArchetypes.map((a) => a.key),
]);
