/**
 * WoW class/spec/role data table.
 *
 * Used to:
 *   - Validate event signup role picks ("a Shaman may signup as dps or healer")
 *   - Present valid role choices in UI based on a character's class
 *   - Normalize role assignments in run_members when addon data is partial
 *   - Look up class colors for embeds and the web frontend
 *
 * Authoritative source. If a new spec/class is added in a WoW patch,
 * update this file and ship through the normal sprint flow.
 */

export type WowRole = "tank" | "healer" | "dps";

export interface SpecDefinition {
  /** Canonical spec name as it appears in-game, e.g. "Elemental", "Blood" */
  name: string;
  role: WowRole;
}

export interface ClassDefinition {
  /** Lowercase-hyphenated slug, e.g. "death-knight" */
  slug: string;
  /** Display name as returned by WoW + RaiderIO, e.g. "Death Knight" */
  name: string;
  /** Class color as 0xRRGGBB — sourced from WoW's class color convention */
  color: number;
  specs: SpecDefinition[];
}

export const CLASSES: Record<string, ClassDefinition> = {
  "death-knight": {
    slug: "death-knight",
    name: "Death Knight",
    color: 0xc41e3a,
    specs: [
      { name: "Blood", role: "tank" },
      { name: "Frost", role: "dps" },
      { name: "Unholy", role: "dps" },
    ],
  },
  "demon-hunter": {
    slug: "demon-hunter",
    name: "Demon Hunter",
    color: 0xa330c9,
    specs: [
      { name: "Havoc", role: "dps" },
      { name: "Vengeance", role: "tank" },
    ],
  },
  druid: {
    slug: "druid",
    name: "Druid",
    color: 0xff7c0a,
    specs: [
      { name: "Balance", role: "dps" },
      { name: "Feral", role: "dps" },
      { name: "Guardian", role: "tank" },
      { name: "Restoration", role: "healer" },
    ],
  },
  evoker: {
    slug: "evoker",
    name: "Evoker",
    color: 0x33937f,
    specs: [
      { name: "Devastation", role: "dps" },
      { name: "Preservation", role: "healer" },
      { name: "Augmentation", role: "dps" },
    ],
  },
  hunter: {
    slug: "hunter",
    name: "Hunter",
    color: 0xaad372,
    specs: [
      { name: "Beast Mastery", role: "dps" },
      { name: "Marksmanship", role: "dps" },
      { name: "Survival", role: "dps" },
    ],
  },
  mage: {
    slug: "mage",
    name: "Mage",
    color: 0x3fc7eb,
    specs: [
      { name: "Arcane", role: "dps" },
      { name: "Fire", role: "dps" },
      { name: "Frost", role: "dps" },
    ],
  },
  monk: {
    slug: "monk",
    name: "Monk",
    color: 0x00ff98,
    specs: [
      { name: "Brewmaster", role: "tank" },
      { name: "Mistweaver", role: "healer" },
      { name: "Windwalker", role: "dps" },
    ],
  },
  paladin: {
    slug: "paladin",
    name: "Paladin",
    color: 0xf48cba,
    specs: [
      { name: "Holy", role: "healer" },
      { name: "Protection", role: "tank" },
      { name: "Retribution", role: "dps" },
    ],
  },
  priest: {
    slug: "priest",
    name: "Priest",
    color: 0xffffff,
    specs: [
      { name: "Discipline", role: "healer" },
      { name: "Holy", role: "healer" },
      { name: "Shadow", role: "dps" },
    ],
  },
  rogue: {
    slug: "rogue",
    name: "Rogue",
    color: 0xfff468,
    specs: [
      { name: "Assassination", role: "dps" },
      { name: "Outlaw", role: "dps" },
      { name: "Subtlety", role: "dps" },
    ],
  },
  shaman: {
    slug: "shaman",
    name: "Shaman",
    color: 0x0070dd,
    specs: [
      { name: "Elemental", role: "dps" },
      { name: "Enhancement", role: "dps" },
      { name: "Restoration", role: "healer" },
    ],
  },
  warlock: {
    slug: "warlock",
    name: "Warlock",
    color: 0x8788ee,
    specs: [
      { name: "Affliction", role: "dps" },
      { name: "Demonology", role: "dps" },
      { name: "Destruction", role: "dps" },
    ],
  },
  warrior: {
    slug: "warrior",
    name: "Warrior",
    color: 0xc69b6d,
    specs: [
      { name: "Arms", role: "dps" },
      { name: "Fury", role: "dps" },
      { name: "Protection", role: "tank" },
    ],
  },
};

/** All class slugs in display order. */
export const CLASS_SLUGS: string[] = Object.keys(CLASSES);

/**
 * Returns the unique set of roles a class can fill.
 * E.g. getValidRoles("shaman") → ["dps", "healer"]
 */
export function getValidRoles(classSlug: string): WowRole[] {
  const cls = CLASSES[classSlug];
  if (!cls) return [];
  const roles = new Set<WowRole>();
  for (const spec of cls.specs) roles.add(spec.role);
  return Array.from(roles);
}

/**
 * Returns the specs a class can use to fill a given role.
 * E.g. getSpecsForRole("shaman", "healer") → [{ name: "Restoration", role: "healer" }]
 */
export function getSpecsForRole(classSlug: string, role: WowRole): SpecDefinition[] {
  const cls = CLASSES[classSlug];
  if (!cls) return [];
  return cls.specs.filter((s) => s.role === role);
}

/**
 * Look up a spec by class + spec name. Case-insensitive.
 */
export function getSpecByName(
  classSlug: string,
  specName: string,
): SpecDefinition | undefined {
  const cls = CLASSES[classSlug];
  if (!cls) return undefined;
  const lower = specName.toLowerCase();
  return cls.specs.find((s) => s.name.toLowerCase() === lower);
}

/**
 * Given a class and the spec the player is using, derive the role.
 * Returns undefined if the spec is not valid for the class.
 */
export function roleFromSpec(
  classSlug: string,
  specName: string,
): WowRole | undefined {
  return getSpecByName(classSlug, specName)?.role;
}

/**
 * True if this class can fill multiple roles (e.g. Druid, Shaman, Paladin).
 * Used in /register UX to hint that the user has flexibility in events.
 */
export function isMultiRoleClass(classSlug: string): boolean {
  return getValidRoles(classSlug).length > 1;
}
