/**
 * WoW class and spec icon URLs via Wowhead CDN.
 *
 * These are publicly accessible, no auth required, no rate limits.
 * Icon names are stable across patches — they only change if Blizzard
 * redesigns the icon art (extremely rare).
 *
 * URL pattern: https://wow.zamimg.com/images/wow/icons/{size}/{icon_name}.jpg
 * Sizes: "small" (18x18), "medium" (36x36), "large" (56x56)
 */

const WOWHEAD_ICON_BASE = "https://wow.zamimg.com/images/wow/icons";

export type IconSize = "small" | "medium" | "large";

export function iconUrl(iconName: string, size: IconSize = "large"): string {
  return `${WOWHEAD_ICON_BASE}/${size}/${iconName}.jpg`;
}

// ─── Class icons ─────────────────────────────────────────────────────

export const CLASS_ICONS: Record<string, string> = {
  "death-knight": "classicon_deathknight",
  "demon-hunter": "classicon_demonhunter",
  druid: "classicon_druid",
  evoker: "classicon_evoker",
  hunter: "classicon_hunter",
  mage: "classicon_mage",
  monk: "classicon_monk",
  paladin: "classicon_paladin",
  priest: "classicon_priest",
  rogue: "classicon_rogue",
  shaman: "classicon_shaman",
  warlock: "classicon_warlock",
  warrior: "classicon_warrior",
};

/**
 * Get the Wowhead CDN URL for a class icon.
 */
export function getClassIconUrl(classSlug: string, size: IconSize = "large"): string {
  const icon = CLASS_ICONS[classSlug];
  if (!icon) return iconUrl("inv_misc_questionmark", size);
  return iconUrl(icon, size);
}

// ─── Spec icons ──────────────────────────────────────────────────────
// Keyed by "classSlug:specName" for unique lookup.

export const SPEC_ICONS: Record<string, string> = {
  // Death Knight
  "death-knight:Blood": "spell_deathknight_bloodpresence",
  "death-knight:Frost": "spell_deathknight_frostpresence",
  "death-knight:Unholy": "spell_deathknight_unholypresence",
  // Demon Hunter
  "demon-hunter:Havoc": "ability_demonhunter_specdps",
  "demon-hunter:Vengeance": "ability_demonhunter_spectank",
  // Druid
  "druid:Balance": "spell_nature_starfall",
  "druid:Feral": "ability_druid_catform",
  "druid:Guardian": "ability_racial_bearform",
  "druid:Restoration": "spell_nature_healingtouch",
  // Evoker
  "evoker:Devastation": "classicon_evoker_devastation",
  "evoker:Preservation": "classicon_evoker_preservation",
  "evoker:Augmentation": "classicon_evoker_augmentation",
  // Hunter
  "hunter:Beast Mastery": "ability_hunter_bestialdiscipline",
  "hunter:Marksmanship": "ability_hunter_focusedaim",
  "hunter:Survival": "ability_hunter_camouflage",
  // Mage
  "mage:Arcane": "spell_holy_magicalsentry",
  "mage:Fire": "spell_fire_firebolt02",
  "mage:Frost": "spell_frost_frostbolt02",
  // Monk
  "monk:Brewmaster": "spell_monk_brewmaster_spec",
  "monk:Mistweaver": "spell_monk_mistweaver_spec",
  "monk:Windwalker": "spell_monk_windwalker_spec",
  // Paladin
  "paladin:Holy": "spell_holy_holybolt",
  "paladin:Protection": "ability_paladin_shieldofthetemplar",
  "paladin:Retribution": "spell_holy_auraoflight",
  // Priest
  "priest:Discipline": "spell_holy_powerwordshield",
  "priest:Holy": "spell_holy_guardianspirit",
  "priest:Shadow": "spell_shadow_shadowwordpain",
  // Rogue
  "rogue:Assassination": "ability_rogue_deadlybrew",
  "rogue:Outlaw": "ability_rogue_waylay",
  "rogue:Subtlety": "ability_stealth",
  // Shaman
  "shaman:Elemental": "spell_nature_lightning",
  "shaman:Enhancement": "spell_shaman_improvedstormstrike",
  "shaman:Restoration": "spell_nature_magicimmunity",
  // Warlock
  "warlock:Affliction": "spell_shadow_deathcoil",
  "warlock:Demonology": "spell_shadow_metamorphosis",
  "warlock:Destruction": "spell_shadow_rainoffire",
  // Warrior
  "warrior:Arms": "ability_warrior_savageblow",
  "warrior:Fury": "ability_warrior_innerrage",
  "warrior:Protection": "ability_warrior_defensivestance",
};

/**
 * Get the Wowhead CDN URL for a spec icon.
 */
export function getSpecIconUrl(classSlug: string, specName: string, size: IconSize = "large"): string {
  const key = `${classSlug}:${specName}`;
  const icon = SPEC_ICONS[key];
  if (!icon) return getClassIconUrl(classSlug, size); // fallback to class icon
  return iconUrl(icon, size);
}

// ─── Role icons ──────────────────────────────────────────────────────

const ROLE_ICONS: Record<string, string> = {
  tank: "spell_nature_guardianward",
  healer: "spell_nature_healingtouch",
  dps: "ability_warrior_offensivestance",
};

export function getRoleIconUrl(role: string, size: IconSize = "large"): string {
  const icon = ROLE_ICONS[role] ?? ROLE_ICONS.dps!;
  return iconUrl(icon, size);
}
