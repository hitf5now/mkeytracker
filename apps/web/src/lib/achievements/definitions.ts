import { formatNumber } from "@/lib/format";
import type {
  AchievementDef,
  PartyRule,
  PartyRuleContext,
  Rule,
  RuleContext,
} from "./types";

// ─── Helpers ───────────────────────────────────────────────────────────────

const sumBuckets = (buckets: number[] | null | undefined): number => {
  if (!buckets || buckets.length === 0) return 0;
  let total = 0;
  for (const v of buckets) total += v;
  return total;
};

/** Avg across all buckets (including empty/zero buckets). */
const avgBucket = (buckets: number[] | null | undefined): number => {
  if (!buckets || buckets.length === 0) return 0;
  return sumBuckets(buckets) / buckets.length;
};

/** Avg across only the combat (non-zero) buckets — a better baseline when a
 *  player has long idle windows (trash gaps, travel, rp). */
const activeAvgBucket = (buckets: number[] | null | undefined): number => {
  if (!buckets || buckets.length === 0) return 0;
  let total = 0;
  let count = 0;
  for (const v of buckets) {
    if (v > 0) {
      total += v;
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
};

const pctOf = (part: number, whole: number): string => {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
};

const secToMMSS = (s: number): string => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
};

// ─── Per-player rules ──────────────────────────────────────────────────────

export const playerRules: Rule[] = [
  // ── Universal ────────────────────────────────────────────────────────────
  {
    def: {
      id: "expired_juice",
      name: "Expired Juice",
      flavor: "Died five or more times. The juice has definitely turned.",
      description:
        "Somewhere between your fourth and fifth death, the Spirit Healer learned your name. You're a regular now. The tank is tired, the healer is tired, and whatever juice was in you has long since separated into sediment and cloudy water. Consider a flask. Consider a new talent build. Consider a cinnamon roll break.",
      icon: "🧟",
      severity: "negative",
      scope: "any",
    },
    eligible: () => true,
    matches: (ctx) => ctx.player.deaths >= 5,
    describe: (ctx) => `You died ${ctx.player.deaths} times in this run.`,
  },
  {
    def: {
      id: "gravitys_favorite",
      name: "Gravity's Favorite",
      flavor: "Most deaths in the party. The floor missed you.",
      description:
        "The rest of the party had a run. You had a series of unplanned naps. Whether it was swirlies, ground pools, or just vibes, the floor kept pulling you in like you owed it money. Every GCD you pressed was a preamble to a death animation.",
      icon: "🕳️",
      severity: "negative",
      scope: "any",
    },
    eligible: (ctx) => ctx.party.maxDeaths >= 2,
    matches: (ctx) =>
      ctx.player.deaths > 0 &&
      ctx.player.deaths === ctx.party.maxDeaths &&
      ctx.player.deaths > 1,
    describe: (ctx) =>
      `You had ${ctx.player.deaths} deaths — more than anyone else in the party.`,
  },
  {
    def: {
      id: "designated_juice_drop",
      name: "Designated Juice Drop",
      flavor: "You personally delivered more than half of the party's deaths.",
      description:
        "If the party's deaths were a pie chart, you'd be most of the pie. Every time the group wiped there was a better-than-even chance your name was on the death recap. The other four made it look easy. You made it look expensive.",
      icon: "💧",
      severity: "negative",
      scope: "any",
    },
    eligible: (ctx) => ctx.party.partyDeaths >= 4,
    matches: (ctx) =>
      ctx.player.deaths >= 3 &&
      ctx.player.deaths / ctx.party.partyDeaths > 0.5,
    describe: (ctx) =>
      `You accounted for ${ctx.player.deaths} of ${ctx.party.partyDeaths} party deaths (${pctOf(ctx.player.deaths, ctx.party.partyDeaths)}).`,
  },
  {
    def: {
      id: "silent_partner",
      name: "Silent Partner",
      flavor: "Zero interrupts while the rest of the party did all the kicking.",
      description:
        "Every other keybind on your bar was pressed. Every other keybind. Meanwhile the rest of the party played whack-a-mole with every cast bar that popped up. Your kick button is officially filing for neglect. Possibly considering a restraining order.",
      icon: "🤐",
      severity: "negative",
      scope: "any",
    },
    eligible: (ctx) =>
      (ctx.role === "tank" || ctx.role === "dps") &&
      ctx.party.totalInterrupts > 0,
    matches: (ctx) => ctx.player.interrupts === 0,
    describe: (ctx) =>
      `You interrupted 0 casts. The rest of the party landed ${ctx.party.totalInterrupts}.`,
  },

  // ── DPS roasts ───────────────────────────────────────────────────────────
  {
    def: {
      id: "two_percent_pulp",
      name: "2% Pulp",
      flavor: "Second from the bottom. The forgettable middle of the meter.",
      description:
        "Not bad enough to shame. Not good enough to praise. You are the beige cardigan of the party — the slot everyone mentally skips past when reading Details. Somewhere in Azeroth a bard is NOT writing a song about you.",
      icon: "🥤",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) => ctx.role === "dps" && ctx.party.dps.length >= 3,
    matches: (ctx) => {
      const sorted = [...ctx.party.dps].sort((a, b) => a.damage - b.damage);
      return sorted[1]?.playerId === ctx.player.id;
    },
    describe: (ctx) =>
      `Second-lowest DPS in the party at ${formatNumber(ctx.damageDone)} total damage.`,
  },
  {
    def: {
      id: "outjuiced_by_the_driver",
      name: "Out-Juiced by the Driver",
      flavor: "A DPS out-damaged by the tank. The tank drove AND pressed the gas.",
      description:
        "The tank's job is to hold aggro and not die. They did those things. They also outdamaged you. You had one responsibility in this run and it wasn't staying alive. Maybe try a different keybind. Or a different class.",
      icon: "🚗",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) =>
      ctx.role === "dps" && ctx.party.tank !== null && ctx.party.tank.damage > 0,
    matches: (ctx) =>
      ctx.party.tank !== null && ctx.damageDone < ctx.party.tank.damage,
    describe: (ctx) => {
      const tank = ctx.party.tank;
      return `Tank did ${formatNumber(tank?.damage ?? 0)}. You did ${formatNumber(ctx.damageDone)}.`;
    },
  },
  {
    def: {
      id: "juice_thief",
      name: "Juice Thief",
      flavor: "A DPS out-damaged by the healer. Somebody check the rotation.",
      description:
        "The healer kept the party alive AND put out more damage than you. They were doing two jobs. You were doing about half of one. Consider: what is a DPS, really? Who is the DPS in this group? Introspect. Growth awaits.",
      icon: "🥷",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) =>
      ctx.role === "dps" &&
      ctx.party.healer !== null &&
      ctx.party.healer.damage > 0,
    matches: (ctx) =>
      ctx.party.healer !== null && ctx.damageDone < ctx.party.healer.damage,
    describe: (ctx) => {
      const healer = ctx.party.healer;
      return `Healer did ${formatNumber(healer?.damage ?? 0)} damage. You did ${formatNumber(ctx.damageDone)}.`;
    },
  },
  {
    def: {
      id: "tourist",
      name: "Tourist",
      flavor: "Dealt less than 10% of the party's damage. Just here for the sights.",
      description:
        "You queued up for the dungeon tour, took a few photos at the landmarks, and let the rest of the group handle logistics. A beautiful experience for you. A character-building experience for everyone else.",
      icon: "📸",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) =>
      ctx.role === "dps" && ctx.party.totalDamage > 0 && ctx.damageDone > 0,
    matches: (ctx) => ctx.damageDone / ctx.party.totalDamage < 0.1,
    describe: (ctx) =>
      `${formatNumber(ctx.damageDone)} damage — only ${pctOf(ctx.damageDone, ctx.party.totalDamage)} of the party total.`,
  },
  {
    def: {
      id: "flat_soda",
      name: "Flat Soda",
      flavor: "No burst, no fizz. Your peak barely cleared your active average.",
      description:
        "Other DPS have cooldowns, burst windows, and Bloodlust moments. You have a line. A flat, consistent, beverage-left-open-overnight line. Whatever 'pop CDs' means to you, it apparently means 'keep doing the same thing.' A steady effort, but the boss never feels threatened.",
      icon: "💨",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) => {
      if (ctx.role !== "dps") return false;
      const peak = ctx.player.peakDamage ? Number(ctx.player.peakDamage) : 0;
      const aavg = activeAvgBucket(ctx.player.damageBuckets);
      return peak > 0 && aavg > 0;
    },
    matches: (ctx) => {
      const peak = Number(ctx.player.peakDamage);
      const aavg = activeAvgBucket(ctx.player.damageBuckets);
      return peak / aavg < 1.3;
    },
    describe: (ctx) => {
      const peak = Number(ctx.player.peakDamage);
      const aavg = activeAvgBucket(ctx.player.damageBuckets);
      const ratio = aavg > 0 ? (peak / aavg).toFixed(2) : "—";
      return `Peak 5s window was only ${ratio}× your active-combat average. Real burst specs hit 2×+.`;
    },
  },
  {
    def: {
      id: "one_trick_spigot",
      name: "One Trick Spigot",
      flavor: "One big pop and then crickets.",
      description:
        "Bloodlust hit, every cooldown lit up, Details sang, and then… you were done. The rest of the run you were essentially a very expensive autoattack. A quarter of your entire contribution happened in five seconds. Impressive in isolation; concerning in context.",
      icon: "🎯",
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
    describe: (ctx) => {
      const peak = Number(ctx.player.peakDamage);
      return `A single 5-second window held ${pctOf(peak, ctx.damageDone)} of your entire run's damage.`;
    },
  },
  {
    def: {
      id: "almost_taste_it",
      name: "Almost Taste It",
      flavor: "Another DPS was just barely ahead. You could taste it.",
      description:
        "You and another DPS traded blows for the entire run. Your Details bars were practically kissing. Five hundred DPS separated an average run from a bragging-rights screenshot. Maybe next time skip the trinket swap. Maybe this time, enjoy how close it was.",
      icon: "👅",
      severity: "negative",
      scope: "dps",
    },
    eligible: (ctx) => ctx.role === "dps" && ctx.party.dps.length >= 2,
    matches: (ctx) => {
      const myDps = ctx.averageDps;
      if (myDps <= 0) return false;
      // Only the LOWER of a pair gets this — find a DPS player above me by <500.
      return ctx.party.dps.some((other) => {
        if (other.playerId === ctx.player.id) return false;
        const otherDps = other.damage / ctx.party.runDurationSec;
        const gap = otherDps - myDps;
        return gap > 0 && gap < 500;
      });
    },
    describe: (ctx) => {
      const myDps = ctx.averageDps;
      let closest: { playerId: number; dps: number; gap: number } | null = null;
      for (const other of ctx.party.dps) {
        if (other.playerId === ctx.player.id) continue;
        const otherDps = other.damage / ctx.party.runDurationSec;
        const gap = otherDps - myDps;
        if (gap > 0 && gap < 500 && (closest === null || gap < closest.gap)) {
          closest = { playerId: other.playerId, dps: otherDps, gap };
        }
      }
      if (!closest) return "You were within 500 DPS of another party DPS.";
      return `You averaged ${formatNumber(Math.round(myDps))} DPS — just ${Math.round(closest.gap)} under the DPS above you (${formatNumber(Math.round(closest.dps))}).`;
    },
  },

  // ── DPS praise ───────────────────────────────────────────────────────────
  {
    def: {
      id: "fresh_pressed",
      name: "Fresh-Pressed",
      flavor: "Top damage in the party. Certified squeezy.",
      description:
        "Nobody pressed their abilities like you pressed yours. You were the top of the meter, the reason the boss fell when it did, and the reason the tank felt safe pulling bigger. Someone in Discord is going to link your logs unprompted. Don't be modest.",
      icon: "🍊",
      severity: "positive",
      scope: "dps",
    },
    eligible: (ctx) => ctx.role === "dps" && ctx.party.totalDamage > 0,
    matches: (ctx) => ctx.party.topDamagePlayerId === ctx.player.id,
    describe: (ctx) =>
      `${formatNumber(ctx.damageDone)} total damage — the top in the party.`,
  },
  {
    def: {
      id: "juice_overflow",
      name: "Juice Overflow",
      flavor: "Over 40% of the party's damage came from you. A one-person carry.",
      description:
        "The other four players wanted a calm dungeon. You wanted a highlight reel. You accounted for nearly half of everything damaged in the key, which is either a carry or an accusation of the other DPS. Both interpretations are correct.",
      icon: "🌊",
      severity: "positive",
      scope: "dps",
    },
    eligible: (ctx) => ctx.role === "dps" && ctx.party.totalDamage > 0,
    matches: (ctx) => ctx.damageDone / ctx.party.totalDamage > 0.4,
    describe: (ctx) =>
      `You did ${formatNumber(ctx.damageDone)} — ${pctOf(ctx.damageDone, ctx.party.totalDamage)} of all party damage.`,
  },
  {
    def: {
      id: "concentrate",
      name: "Concentrate",
      flavor: "Your burst window was massively above your active average.",
      description:
        "There is a reason people dread standing near you in Bloodlust. A full cooldown cycle from you looks like a PvP crit screenshot. Details scrolled. The log chimed. The boss's healthbar remembered a different era. Flash-pressed.",
      icon: "⚡",
      severity: "positive",
      scope: "dps",
    },
    eligible: (ctx) => {
      if (ctx.role !== "dps") return false;
      const peak = ctx.player.peakDamage ? Number(ctx.player.peakDamage) : 0;
      const aavg = activeAvgBucket(ctx.player.damageBuckets);
      return peak > 0 && aavg > 0;
    },
    matches: (ctx) => {
      const peak = Number(ctx.player.peakDamage);
      const aavg = activeAvgBucket(ctx.player.damageBuckets);
      return peak / aavg > 2.5;
    },
    describe: (ctx) => {
      const peak = Number(ctx.player.peakDamage);
      const aavg = activeAvgBucket(ctx.player.damageBuckets);
      const ratio = aavg > 0 ? (peak / aavg).toFixed(1) : "—";
      return `Peak 5s burst was ${ratio}× your active-combat average.`;
    },
  },

  // ── Healer ───────────────────────────────────────────────────────────────
  {
    def: {
      id: "juice_leak",
      name: "Juice Leak",
      flavor: "Four or more party deaths happened on your watch.",
      description:
        "Either the DPS keep standing in the bad or you let them. Either way, the death recap had four chances to have someone else's name on it and the Spirit Healer learned the whole roster. That's not a leak — that's a burst pipe.",
      icon: "🪣",
      severity: "negative",
      scope: "healer",
    },
    eligible: (ctx) => ctx.role === "healer",
    matches: (ctx) => ctx.party.partyDeaths >= 4,
    describe: (ctx) =>
      `${ctx.party.partyDeaths} party members died while you were on healing duty.`,
  },
  {
    def: {
      id: "dispel_denial",
      name: "Dispel Denial",
      flavor: "Zero dispels while the rest of the group cleansed. Juice hoarder.",
      description:
        "Somewhere out there a DPS had a debuff with your name on it. A curse, maybe. Magic, perhaps. A disease, who knows. You definitely didn't. Your cleanse button went the entire dungeon without seeing daylight.",
      icon: "🚫",
      severity: "negative",
      scope: "healer",
    },
    eligible: (ctx) => ctx.role === "healer" && ctx.party.totalDispels > 0,
    matches: (ctx) => ctx.player.dispels === 0,
    describe: (ctx) =>
      `You dispelled 0 effects. The rest of the party landed ${ctx.party.totalDispels}.`,
  },
  {
    def: {
      id: "the_juicer",
      name: "The Juicer",
      flavor: "A healer who out-damaged a DPS. Multitasker of the month.",
      description:
        "Healing is hard. Damage is hard. Doing both while the tank pretends to understand threat is very hard. Yet here you are, on the DPS meter, above an actual DPS. Someone's M+ review this week is going to be a painful conversation.",
      icon: "🍹",
      severity: "positive",
      scope: "healer",
    },
    eligible: (ctx) =>
      ctx.role === "healer" && ctx.damageDone > 0 && ctx.party.dps.length > 0,
    matches: (ctx) => ctx.party.dps.some((d) => d.damage < ctx.damageDone),
    describe: (ctx) => {
      const beaten = ctx.party.dps
        .filter((d) => d.damage < ctx.damageDone)
        .sort((a, b) => a.damage - b.damage)[0];
      const beatenDmg = beaten ? formatNumber(beaten.damage) : "—";
      return `You did ${formatNumber(ctx.damageDone)} damage — above a party DPS who did ${beatenDmg}.`;
    },
  },

  // ── Tank ─────────────────────────────────────────────────────────────────
  {
    def: {
      id: "free_juice_for_the_boss",
      name: "Free Juice for the Boss",
      flavor: "A tank with zero interrupts. Every cast got a free pour.",
      description:
        "You hold aggro. You take hits. You pull big. Respected. You also have a kick, a stun, and probably a silence macro somewhere. Every single one of them sat on the bar while the raid leader typed 'KICK' in party chat for the seventh time.",
      icon: "🎁",
      severity: "negative",
      scope: "tank",
    },
    eligible: (ctx) => ctx.role === "tank" && ctx.party.totalInterrupts > 0,
    matches: (ctx) => ctx.player.interrupts === 0,
    describe: (ctx) =>
      `You interrupted 0 casts. The rest of the party landed ${ctx.party.totalInterrupts}.`,
  },
  {
    def: {
      id: "crash_test_dummy",
      name: "Crash Test Dummy",
      flavor: "The tank led the party in deaths. The crumple zone worked.",
      description:
        "The healer was trying. The healer was trying really hard. Your defensive rotation looked less like a rotation and more like a vibe. You led the party not in DPS, not in kicks, but in a stat no tank wants to lead — the death count.",
      icon: "💥",
      severity: "negative",
      scope: "tank",
    },
    eligible: (ctx) => ctx.role === "tank",
    matches: (ctx) =>
      ctx.player.deaths >= 2 &&
      ctx.player.deaths === ctx.party.maxDeaths &&
      ctx.party.maxDeaths > 0,
    describe: (ctx) =>
      `You died ${ctx.player.deaths} times — the most in the party.`,
  },
  {
    def: {
      id: "steel_press",
      name: "Steel Press",
      flavor: "Tanked the whole run without dying. Cold-pressed.",
      description:
        "Every big pull, every dangerous swirly, every tank buster — you ate them and asked for seconds. The healer barely had to use their panic cooldown. A tank who doesn't die is a tank who lets the rest of the group be comfortable. Thank you for your service.",
      icon: "🛡️",
      severity: "positive",
      scope: "tank",
    },
    eligible: (ctx) => ctx.role === "tank",
    matches: (ctx) => ctx.player.deaths === 0,
    describe: () => "You tanked the entire run without a single death.",
  },

  // ── Utility ──────────────────────────────────────────────────────────────
  {
    def: {
      id: "kick_commissioner",
      name: "Kick Commissioner",
      flavor: "Most interrupts in the party. The boot.",
      description:
        "Every caster. Every chain-heal. Every ability with a cast bar. Your kick button is worn smooth. Somewhere a Deadly Boss Mods warning is feeling redundant.",
      icon: "👢",
      severity: "positive",
      scope: "any",
    },
    eligible: (ctx) => ctx.party.maxInterrupts >= 3,
    matches: (ctx) =>
      ctx.player.interrupts === ctx.party.maxInterrupts &&
      ctx.player.interrupts > 0,
    describe: (ctx) =>
      `${ctx.player.interrupts} interrupts — the most in the party.`,
  },
];

// ─── Party-level rules (awarded to every member) ──────────────────────────

export const partyRules: PartyRule[] = [
  {
    def: {
      id: "pasteurized",
      name: "Pasteurized",
      flavor: "Zero deaths for the entire run. Clean batch.",
      description:
        "No Spirit Healer visits. No corpse runs. No 'sorry sorry sorry' in party chat. Every mechanic got respected, every avoidable was avoided. Rare. Beautiful. The juice came out clear.",
      icon: "✨",
      severity: "positive",
      scope: "party",
    },
    matches: (ctx) => ctx.run.deaths === 0 && ctx.players.length > 0,
    describe: () => "The entire run finished without a single party death.",
  },
  {
    def: {
      id: "triple_concentrate",
      name: "Triple Concentrate",
      flavor: "A +3 upgrade. Maximum juice compression.",
      description:
        "Beating the timer is one thing. Beating it by 40% is a statement. Every pull felt planned, every route felt right, every DPS pressed every button. Somewhere in the back end of the database, this run's row is glowing.",
      icon: "🏆",
      severity: "positive",
      scope: "party",
    },
    matches: (ctx) => ctx.run.upgrades === 3,
    describe: (ctx) =>
      `Finished +3 in ${secToMMSS(Math.round(ctx.run.completionMs / 1000))} (par ${secToMMSS(Math.round(ctx.run.parMs / 1000))}).`,
  },
  {
    def: {
      id: "vintage",
      name: "Vintage",
      flavor: "A new personal record for this dungeon or affix combo.",
      description:
        "Personal best, stamped, bottled, labeled, and placed on the top shelf. Every future run on this key is going to have to beat this one. Good luck, future you.",
      icon: "🍷",
      severity: "positive",
      scope: "party",
    },
    matches: (ctx) => ctx.run.isMapRecord || ctx.run.isAffixRecord,
    describe: (ctx) => {
      if (ctx.run.isMapRecord && ctx.run.isAffixRecord)
        return "New personal best for both this dungeon AND this affix combo.";
      if (ctx.run.isMapRecord) return "New personal best for this dungeon.";
      return "New personal best for this affix combo.";
    },
  },
  {
    def: {
      id: "spilled_juice",
      name: "Spilled Juice",
      flavor: "Depleted. Whatever juice was in there is on the floor now.",
      description:
        "You ran out of time. You ran out of cooldowns. You ran out of healer mana. The timer turned red and what remained was a cup of regret. On the bright side, the key is one level lower and full of character-building opportunities.",
      icon: "🫗",
      severity: "negative",
      scope: "party",
    },
    matches: (ctx) => !ctx.run.onTime,
    describe: (ctx) => {
      const overSec = Math.max(
        0,
        Math.round((ctx.run.completionMs - ctx.run.parMs) / 1000),
      );
      return `Finished ${secToMMSS(overSec)} over the timer.`;
    },
  },
  {
    def: {
      id: "juice_rinds",
      name: "Juice Rinds",
      flavor: "Depleted by a wide margin. Nothing left but the peel.",
      description:
        "This wasn't a close call or a tragic loss. This was a full dungeon's worth of everything going wrong. The timer was gone well before the last boss. Brush yourself off — there's always next reset.",
      icon: "🗑️",
      severity: "negative",
      scope: "party",
    },
    matches: (ctx) =>
      !ctx.run.onTime && ctx.run.completionMs > ctx.run.parMs * 1.25,
    describe: (ctx) => {
      const ratio = Math.round((ctx.run.completionMs / ctx.run.parMs) * 100);
      return `Clear time was ${ratio}% of par — deeply depleted.`;
    },
  },
  {
    def: {
      id: "over_squeezed",
      name: "Over-Squeezed",
      flavor: "Deaths cost the party more than a minute of timer.",
      description:
        "Every death adds five seconds to the clock. You found the ceiling of that formula. More than sixty seconds of your timer just went to the Spirit Healer's coffee fund. The run wasn't impossible; it was simply survived.",
      icon: "⏰",
      severity: "negative",
      scope: "party",
    },
    matches: (ctx) => ctx.run.timeLostSec > 60,
    describe: (ctx) =>
      `Deaths added ${ctx.run.timeLostSec}s (${secToMMSS(ctx.run.timeLostSec)}) to the clock.`,
  },
  {
    def: {
      id: "group_juice_cleanse",
      name: "Group Juice Cleanse",
      flavor: "Every single member of the party died at least once.",
      description:
        "Not a single player escaped. Tank down. Healer down. DPS down, sometimes twice. At some point in this run everyone saw the Spirit Healer's welcome screen. A bonding experience. A humbling one.",
      icon: "💀",
      severity: "negative",
      scope: "party",
    },
    matches: (ctx) =>
      ctx.players.length >= 4 && ctx.players.every((p) => p.deaths >= 1),
    describe: (ctx) =>
      `All ${ctx.players.length} party members died at least once.`,
  },
];

// Re-export helper just in case a test ever wants it
export { activeAvgBucket, avgBucket };

// Type re-exports used by consumers through `./index`
export type { AchievementDef };
