/**
 * Endorsement category display metadata.
 *
 * 15 categories, grouped by theme. Display order matches the dropdown
 * selector on the give-endorsement modal so players can scan by theme.
 */

import type { EndorsementCategory } from "@/types/api";

export interface CategoryMeta {
  value: EndorsementCategory;
  label: string;
  group: "role" | "mechanical" | "soft" | "memorable";
}

export const ENDORSEMENT_CATEGORIES: CategoryMeta[] = [
  // Role excellence
  { value: "great_tank", label: "Great Tank", group: "role" },
  { value: "great_healer", label: "Great Healer", group: "role" },
  { value: "great_dps", label: "Great DPS", group: "role" },
  // Mechanical mastery
  { value: "interrupt_master", label: "Interrupt Master", group: "mechanical" },
  { value: "dispel_wizard", label: "Dispel Wizard", group: "mechanical" },
  { value: "cc_master", label: "CC Master", group: "mechanical" },
  { value: "cooldown_hero", label: "Cooldown Hero", group: "mechanical" },
  { value: "affix_slayer", label: "Affix Slayer", group: "mechanical" },
  { value: "route_master", label: "Route Master", group: "mechanical" },
  // Soft skills / leadership
  { value: "patient_teacher", label: "Patient Teacher", group: "soft" },
  { value: "calm_under_pressure", label: "Calm Under Pressure", group: "soft" },
  { value: "positive_vibes", label: "Positive Vibes", group: "soft" },
  { value: "shot_caller", label: "Shot Caller", group: "soft" },
  // Memorable plays
  { value: "clutch_saviour", label: "Clutch Saviour", group: "memorable" },
  { value: "comeback_kid", label: "Comeback Kid", group: "memorable" },
];

export const GROUP_LABELS: Record<CategoryMeta["group"], string> = {
  role: "Role Excellence",
  mechanical: "Mechanical Mastery",
  soft: "Leadership & Attitude",
  memorable: "Memorable Plays",
};

export function categoryLabel(category: EndorsementCategory): string {
  return (
    ENDORSEMENT_CATEGORIES.find((c) => c.value === category)?.label ?? category
  );
}
