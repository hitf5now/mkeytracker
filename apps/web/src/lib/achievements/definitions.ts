import type { PartyRule, Rule } from "./types";

const sumBuckets = (buckets: number[] | null | undefined): number => {
  if (!buckets || buckets.length === 0) return 0;
  let total = 0;
  for (const v of buckets) total += v;
  return total;
};

const avgBucket = (buckets: number[] | null | undefined): number => {
  if (!buckets || buckets.length === 0) return 0;
  return sumBuckets(buckets) / buckets.length;
};

// ─── Per-player rules ──────────────────────────────────────────────────────

export const playerRules: Rule[] = [
  // ── Universal ────────────────────────────────────────────────────────────
  {
    def: {
      id: "expired_juice",
      name: "Expired Juice",
      flavor: "Died five or more times. The juice has definitely turned.",
      severity: "negative",
      scope: "any",
    },
    eligible: () => true,
    matches: (ctx) => ctx.player.deaths >= 5,
  },
  {
    def: {
      id: "gravitys_favorite",
      name: "Gravity's Favorite",
      flavor: "Most deaths in the party. The floor missed you.",
      severity: "negative",
      scope: "any",
    },
    eligible: (ctx) => ctx.party.maxDeaths >= 2,
    matches: (ctx) =>
      ctx.player.deaths > 0 &&
      ctx.player.deaths === ctx.party.maxDeaths &&
      ctx.player.deaths > 1,
  },
  {
    def: {
      id: "designated_juice_drop",
      name: "Designated Juice Drop",
      flavor: "You personally delivered more than half of the party's deaths.",
      severity: "negative",
      scope: "any",
    },
    eligible: (ctx) => ctx.party.partyDeaths >= 4,
    matches: (ctx) =>
      ctx.player.deaths >= 3 &&
      ctx.player.deaths / ctx.party.partyDeaths > 0.5,
  },
  {
    def: {
      id: "silent_partner",
      name: "Silent Partner",
      flavor: "Zero interrupts while the rest of the party did all the kicking.",
      severity: "negative",
      scope: "any",
    },
    eligible: (ctx) =>
      (ctx.role === "tank" || ctx.role === "dps") &&
      ctx.party.totalInterrupts > 0,
    matches: (ctx) => ctx.player.interrupts === 0,
  },

  // ── DPS negatives ────────────────────────────────────────────────────────
  {
    def: {
      id: "watered_down",
      name: "Watered Down",
      flavor: "Lowest damage of the party DPS. Could use another pump.",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) => ctx.role === "dps" && ctx.party.dps.length >= 2,
    matches: (ctx) => {
      const sorted = [...ctx.party.dps].sort((a, b) => a.damage - b.damage);
      return sorted[0]?.playerId === ctx.player.id && ctx.damageDone > 0;
    },
  },
  {
    def: {
      id: "two_percent_pulp",
      name: "2% Pulp",
      flavor: "Second from the bottom. The forgettable middle of the DPS meter.",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) => ctx.role === "dps" && ctx.party.dps.length >= 3,
    matches: (ctx) => {
      const sorted = [...ctx.party.dps].sort((a, b) => a.damage - b.damage);
      return sorted[1]?.playerId === ctx.player.id;
    },
  },
  {
    def: {
      id: "outjuiced_by_the_driver",
      name: "Out-Juiced by the Driver",
      flavor: "A DPS out-damaged by the tank. The tank drove AND pressed the gas.",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) =>
      ctx.role === "dps" && ctx.party.tank !== null && ctx.party.tank.damage > 0,
    matches: (ctx) =>
      ctx.party.tank !== null && ctx.damageDone < ctx.party.tank.damage,
  },
  {
    def: {
      id: "juice_thief",
      name: "Juice Thief",
      flavor: "A DPS out-damaged by the healer. Somebody check your rotation.",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) =>
      ctx.role === "dps" &&
      ctx.party.healer !== null &&
      ctx.party.healer.damage > 0,
    matches: (ctx) =>
      ctx.party.healer !== null && ctx.damageDone < ctx.party.healer.damage,
  },
  {
    def: {
      id: "tourist",
      name: "Tourist",
      flavor: "Dealt less than 10% of the party's damage. Just here for the sights.",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) =>
      ctx.role === "dps" && ctx.party.totalDamage > 0 && ctx.damageDone > 0,
    matches: (ctx) => ctx.damageDone / ctx.party.totalDamage < 0.1,
  },
  {
    def: {
      id: "flat_soda",
      name: "Flat Soda",
      flavor: "No burst, no fizz. Your peak barely cleared your average.",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) => {
      if (ctx.role !== "dps") return false;
      const peak = ctx.player.peakDamage ? Number(ctx.player.peakDamage) : 0;
      const avg = avgBucket(ctx.player.damageBuckets);
      return peak > 0 && avg > 0;
    },
    matches: (ctx) => {
      const peak = Number(ctx.player.peakDamage);
      const avg = avgBucket(ctx.player.damageBuckets);
      return peak / avg < 1.5;
    },
  },
  {
    def: {
      id: "one_trick_spigot",
      name: "One Trick Spigot",
      flavor: "One big pop and then crickets. A single window holds a quarter of your damage.",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) => {
      if (ctx.role !== "dps") return false;
      const peak = ctx.player.peakDamage ? Number(ctx.player.peakDamage) : 0;
      return peak > 0 && ctx.damageDone > 0;
    },
    matches: (ctx) => {
      const peak = Number(ctx.player.peakDamage);
      return peak / ctx.damageDone > 0.25;
    },
  },

  // ── DPS praise ───────────────────────────────────────────────────────────
  {
    def: {
      id: "fresh_pressed",
      name: "Fresh-Pressed",
      flavor: "Top damage in the party. Certified squeezy.",
      severity: "positive",
      scope: "dps",
    },
    eligible: (ctx) => ctx.role === "dps" && ctx.party.totalDamage > 0,
    matches: (ctx) => ctx.party.topDamagePlayerId === ctx.player.id,
  },
  {
    def: {
      id: "juice_overflow",
      name: "Juice Overflow",
      flavor: "Over 40% of the party's damage came from you. A one-person carry.",
      severity: "positive",
      scope: "dps",
    },
    eligible: (ctx) => ctx.role === "dps" && ctx.party.totalDamage > 0,
    matches: (ctx) => ctx.damageDone / ctx.party.totalDamage > 0.4,
  },
  {
    def: {
      id: "concentrate",
      name: "Concentrate",
      flavor: "Your burst window was more than 3x your average. Flash-pressed.",
      severity: "positive",
      scope: "dps",
    },
    eligible: (ctx) => {
      if (ctx.role !== "dps") return false;
      const peak = ctx.player.peakDamage ? Number(ctx.player.peakDamage) : 0;
      const avg = avgBucket(ctx.player.damageBuckets);
      return peak > 0 && avg > 0;
    },
    matches: (ctx) => {
      const peak = Number(ctx.player.peakDamage);
      const avg = avgBucket(ctx.player.damageBuckets);
      return peak / avg > 3.0;
    },
  },

  // ── Healer ───────────────────────────────────────────────────────────────
  {
    def: {
      id: "juice_leak",
      name: "Juice Leak",
      flavor: "Four or more party deaths happened on your watch.",
      severity: "negative",
      scope: "healer",
    },
    eligible: (ctx) => ctx.role === "healer",
    matches: (ctx) => ctx.party.partyDeaths >= 4,
  },
  {
    def: {
      id: "dispel_denial",
      name: "Dispel Denial",
      flavor: "Zero dispels while the rest of the group cleansed. Juice hoarder.",
      severity: "negative",
      scope: "healer",
    },
    eligible: (ctx) => ctx.role === "healer" && ctx.party.totalDispels > 0,
    matches: (ctx) => ctx.player.dispels === 0,
  },
  {
    def: {
      id: "lukewarm_compress",
      name: "Lukewarm Compress",
      flavor: "Healing output below the floor for this key level. Barely tepid.",
      severity: "negative",
      scope: "healer",
    },
    eligible: (ctx) =>
      ctx.role === "healer" &&
      ctx.healingDone > 0 &&
      ctx.party.runDurationSec > 60,
    matches: (ctx) => {
      const hps = ctx.healingDone / ctx.party.runDurationSec;
      const floor = ctx.run.keystoneLevel * 30_000;
      return hps < floor;
    },
  },
  {
    def: {
      id: "the_juicer",
      name: "The Juicer",
      flavor: "Kept the party topped up. All juice, no leaks.",
      severity: "positive",
      scope: "healer",
    },
    eligible: (ctx) => ctx.role === "healer",
    matches: (ctx) => ctx.healingDone > 0,
  },

  // ── Tank ─────────────────────────────────────────────────────────────────
  {
    def: {
      id: "free_juice_for_the_boss",
      name: "Free Juice for the Boss",
      flavor: "A tank with zero interrupts. Every cast got a free pour.",
      severity: "negative",
      scope: "tank",
    },
    eligible: (ctx) => ctx.role === "tank" && ctx.party.totalInterrupts > 0,
    matches: (ctx) => ctx.player.interrupts === 0,
  },
  {
    def: {
      id: "crash_test_dummy",
      name: "Crash Test Dummy",
      flavor: "The tank led the party in deaths. The crumple zone worked.",
      severity: "negative",
      scope: "tank",
    },
    eligible: (ctx) => ctx.role === "tank",
    matches: (ctx) =>
      ctx.player.deaths >= 2 &&
      ctx.player.deaths === ctx.party.maxDeaths &&
      ctx.party.maxDeaths > 0,
  },
  {
    def: {
      id: "steel_press",
      name: "Steel Press",
      flavor: "Tanked the whole run without dying. Cold-pressed.",
      severity: "positive",
      scope: "tank",
    },
    eligible: (ctx) => ctx.role === "tank",
    matches: (ctx) => ctx.player.deaths === 0,
  },

  // ── Utility ──────────────────────────────────────────────────────────────
  {
    def: {
      id: "kick_commissioner",
      name: "Kick Commissioner",
      flavor: "Most interrupts in the party. The boot.",
      severity: "positive",
      scope: "any",
    },
    eligible: (ctx) => ctx.party.maxInterrupts >= 3,
    matches: (ctx) =>
      ctx.player.interrupts === ctx.party.maxInterrupts &&
      ctx.player.interrupts > 0,
  },
];

// ─── Party-level rules (awarded to every member) ──────────────────────────

export const partyRules: PartyRule[] = [
  {
    def: {
      id: "pasteurized",
      name: "Pasteurized",
      flavor: "Zero deaths for the entire run. Clean batch.",
      severity: "positive",
      scope: "party",
    },
    matches: (ctx) => ctx.run.deaths === 0 && ctx.players.length > 0,
  },
  {
    def: {
      id: "triple_concentrate",
      name: "Triple Concentrate",
      flavor: "A +3 upgrade. Maximum juice compression.",
      severity: "positive",
      scope: "party",
    },
    matches: (ctx) => ctx.run.upgrades === 3,
  },
  {
    def: {
      id: "vintage",
      name: "Vintage",
      flavor: "A new record for this dungeon or affix combo. One for the cellar.",
      severity: "positive",
      scope: "party",
    },
    matches: (ctx) => ctx.run.isMapRecord || ctx.run.isAffixRecord,
  },
  {
    def: {
      id: "spilled_juice",
      name: "Spilled Juice",
      flavor: "Depleted. Whatever juice was in there is on the floor now.",
      severity: "negative",
      scope: "party",
    },
    matches: (ctx) => !ctx.run.onTime,
  },
  {
    def: {
      id: "juice_rinds",
      name: "Juice Rinds",
      flavor: "Depleted by a wide margin. Nothing left but the peel.",
      severity: "negative",
      scope: "party",
    },
    matches: (ctx) =>
      !ctx.run.onTime && ctx.run.completionMs > ctx.run.parMs * 1.25,
  },
  {
    def: {
      id: "over_squeezed",
      name: "Over-Squeezed",
      flavor: "Deaths cost the party more than a minute of timer. Pulp everywhere.",
      severity: "negative",
      scope: "party",
    },
    matches: (ctx) => ctx.run.timeLostSec > 60,
  },
  {
    def: {
      id: "group_juice_cleanse",
      name: "Group Juice Cleanse",
      flavor: "Every single member of the party died at least once. A shared experience.",
      severity: "negative",
      scope: "party",
    },
    matches: (ctx) =>
      ctx.players.length >= 4 && ctx.players.every((p) => p.deaths >= 1),
  },
];
