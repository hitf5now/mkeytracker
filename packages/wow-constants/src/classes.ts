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
  /** Blizzard specializationID (e.g. 73 = Protection Warrior) from WoW's
   *  C_SpecializationInfo API. Used to resolve auto-detected specs from the
   *  combat log's COMBATANT_INFO events. */
  id: number;
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
      { id: 250, name: "Blood", role: "tank" },
      { id: 251, name: "Frost", role: "dps" },
      { id: 252, name: "Unholy", role: "dps" },
    ],
  },
  "demon-hunter": {
    slug: "demon-hunter",
    name: "Demon Hunter",
    color: 0xa330c9,
    specs: [
      { id: 577, name: "Havoc", role: "dps" },
      { id: 581, name: "Vengeance", role: "tank" },
      { id: 1480, name: "Devourer", role: "dps" },
    ],
  },
  druid: {
    slug: "druid",
    name: "Druid",
    color: 0xff7c0a,
    specs: [
      { id: 102, name: "Balance", role: "dps" },
      { id: 103, name: "Feral", role: "dps" },
      { id: 104, name: "Guardian", role: "tank" },
      { id: 105, name: "Restoration", role: "healer" },
    ],
  },
  evoker: {
    slug: "evoker",
    name: "Evoker",
    color: 0x33937f,
    specs: [
      { id: 1467, name: "Devastation", role: "dps" },
      { id: 1468, name: "Preservation", role: "healer" },
      { id: 1473, name: "Augmentation", role: "dps" },
    ],
  },
  hunter: {
    slug: "hunter",
    name: "Hunter",
    color: 0xaad372,
    specs: [
      { id: 253, name: "Beast Mastery", role: "dps" },
      { id: 254, name: "Marksmanship", role: "dps" },
      { id: 255, name: "Survival", role: "dps" },
    ],
  },
  mage: {
    slug: "mage",
    name: "Mage",
    color: 0x3fc7eb,
    specs: [
      { id: 62, name: "Arcane", role: "dps" },
      { id: 63, name: "Fire", role: "dps" },
      { id: 64, name: "Frost", role: "dps" },
    ],
  },
  monk: {
    slug: "monk",
    name: "Monk",
    color: 0x00ff98,
    specs: [
      { id: 268, name: "Brewmaster", role: "tank" },
      { id: 270, name: "Mistweaver", role: "healer" },
      { id: 269, name: "Windwalker", role: "dps" },
    ],
  },
  paladin: {
    slug: "paladin",
    name: "Paladin",
    color: 0xf48cba,
    specs: [
      { id: 65, name: "Holy", role: "healer" },
      { id: 66, name: "Protection", role: "tank" },
      { id: 70, name: "Retribution", role: "dps" },
    ],
  },
  priest: {
    slug: "priest",
    name: "Priest",
    color: 0xffffff,
    specs: [
      { id: 256, name: "Discipline", role: "healer" },
      { id: 257, name: "Holy", role: "healer" },
      { id: 258, name: "Shadow", role: "dps" },
    ],
  },
  rogue: {
    slug: "rogue",
    name: "Rogue",
    color: 0xfff468,
    specs: [
      { id: 259, name: "Assassination", role: "dps" },
      { id: 260, name: "Outlaw", role: "dps" },
      { id: 261, name: "Subtlety", role: "dps" },
    ],
  },
  shaman: {
    slug: "shaman",
    name: "Shaman",
    color: 0x0070dd,
    specs: [
      { id: 262, name: "Elemental", role: "dps" },
      { id: 263, name: "Enhancement", role: "dps" },
      { id: 264, name: "Restoration", role: "healer" },
    ],
  },
  warlock: {
    slug: "warlock",
    name: "Warlock",
    color: 0x8788ee,
    specs: [
      { id: 265, name: "Affliction", role: "dps" },
      { id: 266, name: "Demonology", role: "dps" },
      { id: 267, name: "Destruction", role: "dps" },
    ],
  },
  warrior: {
    slug: "warrior",
    name: "Warrior",
    color: 0xc69b6d,
    specs: [
      { id: 71, name: "Arms", role: "dps" },
      { id: 72, name: "Fury", role: "dps" },
      { id: 73, name: "Protection", role: "tank" },
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

export interface SpecLookup {
  id: number;
  name: string;
  role: WowRole;
  classSlug: string;
  className: string;
  classColor: number;
}

/**
 * Flat map of Blizzard specializationID → class + spec info. Built at module
 * load from CLASSES. Used by anything that knows a spec ID (combat-log
 * enrichment, RaiderIO imports) and needs to display class/spec/role.
 */
export const SPECS_BY_ID: Record<number, SpecLookup> = (() => {
  const map: Record<number, SpecLookup> = {};
  for (const cls of Object.values(CLASSES)) {
    for (const spec of cls.specs) {
      map[spec.id] = {
        id: spec.id,
        name: spec.name,
        role: spec.role,
        classSlug: cls.slug,
        className: cls.name,
        classColor: cls.color,
      };
    }
  }
  return map;
})();

/**
 * Resolve a Blizzard specID to a SpecLookup. Returns undefined for unknown
 * IDs (new specs in future patches, or data corruption).
 */
export function getSpecById(specId: number): SpecLookup | undefined {
  return SPECS_BY_ID[specId];
}
