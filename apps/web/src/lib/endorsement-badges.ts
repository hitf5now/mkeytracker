/**
 * Milestone badge computation for endorsements.
 *
 * Pure function — derives badges from EndorsementSummary data the
 * profile/dashboard already has. No extra API trip.
 *
 * Two families:
 *
 *   Overall tiers — lifetime endorsements received (any category):
 *     10  → Recognized   (bronze)
 *     50  → Celebrated   (silver)
 *    100  → Legendary    (gold)
 *
 *   Category tiers — 10× in a single category earns a named flex badge:
 *     "10× Interrupt Master → Kick God", etc.
 *     Higher category thresholds (25 / 50) get stronger tiers but the
 *     same display name — it's the count that escalates.
 */

import type {
  EndorsementCategory,
  EndorsementSummary,
} from "@/types/api";
import { categoryLabel } from "./endorsement-categories";

export type BadgeTier = "bronze" | "silver" | "gold" | "platinum";

export interface Badge {
  /** Stable id for react keys and future lookups. */
  id: string;
  kind: "overall" | "category";
  tier: BadgeTier;
  title: string;
  subtitle: string;
  count: number;
  threshold: number;
  category?: EndorsementCategory;
}

const OVERALL_TIERS: Array<{ threshold: number; tier: BadgeTier; title: string }> = [
  { threshold: 10, tier: "bronze", title: "Recognized" },
  { threshold: 50, tier: "silver", title: "Celebrated" },
  { threshold: 100, tier: "gold", title: "Legendary" },
];

const CATEGORY_TIERS: Array<{ threshold: number; tier: BadgeTier }> = [
  { threshold: 10, tier: "bronze" },
  { threshold: 25, tier: "silver" },
  { threshold: 50, tier: "gold" },
];

/**
 * Named flex titles for category milestones. Not every category gets a
 * flourish name; undefined ones fall back to "X Master".
 */
const CATEGORY_FLEX_NAMES: Partial<Record<EndorsementCategory, string>> = {
  interrupt_master: "Kick God",
  dispel_wizard: "Dispel Demigod",
  cc_master: "Crowd Control Czar",
  cooldown_hero: "Guardian Angel",
  affix_slayer: "Affix Alchemist",
  route_master: "Path Finder",
  patient_teacher: "Mentor Emeritus",
  calm_under_pressure: "Ice in the Veins",
  positive_vibes: "Team Morale Officer",
  shot_caller: "The Voice",
  clutch_saviour: "Clutchmaster",
  comeback_kid: "Phoenix",
  great_tank: "Wall of Steel",
  great_healer: "Lifebinder",
  great_dps: "DPS Virtuoso",
};

export function computeBadges(summary: EndorsementSummary): Badge[] {
  const badges: Badge[] = [];

  // Overall tiers: only include the highest tier achieved.
  let earnedOverall: (typeof OVERALL_TIERS)[number] | null = null;
  for (const tier of OVERALL_TIERS) {
    if (summary.totalReceived >= tier.threshold) earnedOverall = tier;
  }
  if (earnedOverall) {
    badges.push({
      id: `overall-${earnedOverall.tier}`,
      kind: "overall",
      tier: earnedOverall.tier,
      title: earnedOverall.title,
      subtitle: `${summary.totalReceived} endorsements received`,
      count: summary.totalReceived,
      threshold: earnedOverall.threshold,
    });
  }

  // Category tiers: top tier earned per category that has at least one.
  for (const cat of summary.categoryBreakdown) {
    let earned: (typeof CATEGORY_TIERS)[number] | null = null;
    for (const tier of CATEGORY_TIERS) {
      if (cat.count >= tier.threshold) earned = tier;
    }
    if (!earned) continue;
    const displayName =
      CATEGORY_FLEX_NAMES[cat.category] ?? `${categoryLabel(cat.category)} Master`;
    badges.push({
      id: `cat-${cat.category}-${earned.tier}`,
      kind: "category",
      tier: earned.tier,
      title: displayName,
      subtitle: `${cat.count}× ${categoryLabel(cat.category)}`,
      count: cat.count,
      threshold: earned.threshold,
      category: cat.category,
    });
  }

  return badges;
}

/** Tailwind classes for each tier's chip styling. */
export const TIER_CHIP_CLASSES: Record<BadgeTier, string> = {
  bronze: "border-amber-700/60 bg-amber-700/10 text-amber-500",
  silver: "border-slate-300/50 bg-slate-300/10 text-slate-200",
  gold: "border-gold/60 bg-gold/15 text-gold",
  platinum: "border-cyan-300/60 bg-cyan-300/10 text-cyan-200",
};
