import { tokenize, unquote, toNumber, toBool } from './tokenizer.js';
import type {
  ParsedEvent,
  SourceDest,
  ChallengeModeStart,
  ChallengeModeEnd,
  EncounterStart,
  EncounterEnd,
  CombatantInfo,
  DamageEvent,
  HealEvent,
  InterruptEvent,
  DispelEvent,
  UnitDiedEvent,
  SummonEvent,
  SpellAbsorbedEvent,
  SpellCastSuccessEvent,
  SwingMissedEvent,
  SpellMissedEvent,
  MissType,
} from './types.js';

/**
 * Parses an entire raw log line (including the leading timestamp).
 * Returns null for lines we don't care about or that fail to parse.
 *
 * Line shape:   "M/D/YYYY HH:MM:SS.mmm-TZ  EVENT_TYPE,field,field,..."
 */
export function parseLine(line: string): ParsedEvent | null {
  const split = splitTimestampAndBody(line);
  if (!split) return null;
  const { timestamp, body } = split;

  const tokens = tokenize(body);
  if (tokens.length === 0) return null;
  const eventType = tokens[0];

  switch (eventType) {
    case 'CHALLENGE_MODE_START':
      return parseChallengeModeStart(timestamp, tokens);
    case 'CHALLENGE_MODE_END':
      return parseChallengeModeEnd(timestamp, tokens);
    case 'ENCOUNTER_START':
      return parseEncounterStart(timestamp, tokens);
    case 'ENCOUNTER_END':
      return parseEncounterEnd(timestamp, tokens);
    case 'COMBATANT_INFO':
      return parseCombatantInfo(timestamp, tokens);
    case 'SPELL_DAMAGE':
    case 'SPELL_PERIODIC_DAMAGE':
    case 'RANGE_DAMAGE':
    case 'SWING_DAMAGE':
    case 'SWING_DAMAGE_LANDED':
    case 'SPELL_DAMAGE_SUPPORT':
      return parseDamage(timestamp, eventType, tokens);
    case 'SPELL_HEAL':
    case 'SPELL_PERIODIC_HEAL':
    case 'SPELL_HEAL_SUPPORT':
      return parseHeal(timestamp, eventType, tokens);
    case 'SPELL_INTERRUPT':
      return parseInterrupt(timestamp, tokens);
    case 'SPELL_DISPEL':
      return parseDispel(timestamp, tokens);
    case 'UNIT_DIED':
      return parseUnitDied(timestamp, tokens);
    case 'SPELL_SUMMON':
      return parseSummon(timestamp, tokens);
    case 'SPELL_ABSORBED':
      return parseSpellAbsorbed(timestamp, tokens);
    case 'SPELL_CAST_SUCCESS':
      return parseSpellCastSuccess(timestamp, tokens);
    case 'SWING_MISSED':
      return parseSwingMissed(timestamp, tokens);
    case 'SPELL_MISSED':
      return parseSpellMissed(timestamp, tokens);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Timestamp splitting
// ---------------------------------------------------------------------------

/**
 * Real-world format: `4/18/2026 08:28:30.872-4  SPELL_DAMAGE,...`
 * - Date: M/D/YYYY
 * - Time: HH:MM:SS.mmm
 * - TZ: -4 (hours offset from UTC, sometimes with :MM)
 * - Separator between timestamp and body is TWO SPACES.
 */
function splitTimestampAndBody(
  line: string,
): { timestamp: Date; body: string } | null {
  const sepIndex = line.indexOf('  ');
  if (sepIndex < 0) return null;

  const tsRaw = line.slice(0, sepIndex);
  const body = line.slice(sepIndex + 2);

  const timestamp = parseTimestamp(tsRaw);
  if (!timestamp) return null;

  return { timestamp, body };
}

function parseTimestamp(raw: string): Date | null {
  // "4/18/2026 08:28:30.872-4" or "4/18/2026 08:28:30.872-4:00"
  const match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})\.(\d{1,3})(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/,
  );
  if (!match) return null;

  const [, mo, da, yr, hh, mm, ss, ms, sign, tzh, tzm] = match;
  const tzHours = sign ? (sign === '-' ? -1 : 1) * Number(tzh) : 0;
  const tzMinutes = tzm ? Number(tzm) : 0;
  const offsetMinutes = tzHours * 60 + (tzHours < 0 ? -tzMinutes : tzMinutes);

  // Construct UTC epoch by subtracting the offset.
  const utcMs = Date.UTC(
    Number(yr),
    Number(mo) - 1,
    Number(da),
    Number(hh),
    Number(mm),
    Number(ss),
    Number((ms ?? '0').padEnd(3, '0')),
  );
  return new Date(utcMs - offsetMinutes * 60_000);
}

// ---------------------------------------------------------------------------
// Event-specific parsers
// ---------------------------------------------------------------------------

function parseChallengeModeStart(
  timestamp: Date,
  tokens: string[],
): ChallengeModeStart | null {
  // CHALLENGE_MODE_START, zoneName, instanceId, challengeModeId, keystoneLevel, [affixIds...]
  if (tokens.length < 6) return null;
  const affixRaw = (tokens[5] ?? '').replace(/^\[|\]$/g, '');
  const affixIds = affixRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));

  return {
    timestamp,
    eventType: 'CHALLENGE_MODE_START',
    zoneName: unquote(tokens[1]),
    instanceId: toNumber(tokens[2]),
    challengeModeId: toNumber(tokens[3]),
    keystoneLevel: toNumber(tokens[4]),
    affixIds,
  };
}

function parseChallengeModeEnd(
  timestamp: Date,
  tokens: string[],
): ChallengeModeEnd | null {
  // CHALLENGE_MODE_END, instanceId, success, keystoneLevel, durationMs, ...trailing
  if (tokens.length < 5) return null;
  const trailing = tokens
    .slice(5)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
  return {
    timestamp,
    eventType: 'CHALLENGE_MODE_END',
    instanceId: toNumber(tokens[1]),
    success: tokens[2] === '1',
    keystoneLevel: toNumber(tokens[3]),
    durationMs: toNumber(tokens[4]),
    trailing,
  };
}

function parseEncounterStart(
  timestamp: Date,
  tokens: string[],
): EncounterStart | null {
  if (tokens.length < 6) return null;
  return {
    timestamp,
    eventType: 'ENCOUNTER_START',
    encounterId: toNumber(tokens[1]),
    encounterName: unquote(tokens[2]),
    difficultyId: toNumber(tokens[3]),
    groupSize: toNumber(tokens[4]),
    instanceId: toNumber(tokens[5]),
  };
}

function parseEncounterEnd(
  timestamp: Date,
  tokens: string[],
): EncounterEnd | null {
  if (tokens.length < 7) return null;
  return {
    timestamp,
    eventType: 'ENCOUNTER_END',
    encounterId: toNumber(tokens[1]),
    encounterName: unquote(tokens[2]),
    difficultyId: toNumber(tokens[3]),
    groupSize: toNumber(tokens[4]),
    success: tokens[5] === '1',
    fightTimeMs: toNumber(tokens[6]),
  };
}

function parseCombatantInfo(
  timestamp: Date,
  tokens: string[],
): CombatantInfo | null {
  // COMBATANT_INFO,playerGUID,faction,strength,agility,stamina,intelligence,...,specID,...
  // Format is large and version-dependent; for the prototype we extract:
  // - playerGuid (token[1])
  // - specId: look for a plausible specID by scanning early numeric tokens
  // - itemLevelAvg: derive from equipment array if found (best-effort)
  if (tokens.length < 27) return null;
  const playerGuid = tokens[1] ?? '';

  // WoW 12.0.1 COMBATANT_INFO field order (0-indexed in tokens, event at [0]):
  //   [1]GUID, [2]faction, [3]str, [4]agi, [5]sta, [6]int,
  //   [7]dodge, [8]parry, [9]block, [10]critMelee, [11]critRanged,
  //   [12]critSpell, [13]speed, [14]lifesteal, [15]hasteMelee,
  //   [16]hasteRanged, [17]hasteSpell, [18]avoidance/?, [19]?,
  //   [20]mastery, [21-23]versatility, [24]armor, [25]currentSpecID,
  //   [26]talents[], [27]pvpTalents[], [28]artifact[], [29]equipment[], [30]auras[]
  const candidateSpec = Number(tokens[25]);
  const specId =
    Number.isFinite(candidateSpec) && candidateSpec >= 62 && candidateSpec <= 2000
      ? candidateSpec
      : 0;

  // Best-effort item-level average from the equipment array (a bracketed
  // list whose elements look like "(itemID,ilvl,(...),(...),(...))").
  let itemLevelAvg = 0;
  const equipToken = tokens.find(
    (t) => t.startsWith('[(') && /,(\d{3,4}),/.test(t),
  );
  if (equipToken) {
    const ilvls = Array.from(equipToken.matchAll(/\(\d+,(\d{3,4}),/g))
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ilvls.length > 0) {
      itemLevelAvg = Math.round(
        ilvls.reduce((a, b) => a + b, 0) / ilvls.length,
      );
    }
  }

  return {
    timestamp,
    eventType: 'COMBATANT_INFO',
    playerGuid,
    specId,
    itemLevelAvg,
  };
}

// ---------------------------------------------------------------------------
// Source/dest prefix helpers (applies to most combat events)
// ---------------------------------------------------------------------------

function readPrefix(tokens: string[]): { source: SourceDest; dest: SourceDest; nextIndex: number } {
  // tokens[0] is the event type. Prefix is 8 tokens (source×4 + dest×4).
  const source: SourceDest = {
    guid: tokens[1] ?? '',
    name: unquote(tokens[2] ?? ''),
    flags: tokens[3] ?? '',
    raidFlags: tokens[4] ?? '',
  };
  const dest: SourceDest = {
    guid: tokens[5] ?? '',
    name: unquote(tokens[6] ?? ''),
    flags: tokens[7] ?? '',
    raidFlags: tokens[8] ?? '',
  };
  return { source, dest, nextIndex: 9 };
}

// Combat suffix offset helpers -----------------------------------------------

const COMBAT_TAGS = new Set(['ST', 'AOE', 'NONE', 'HOT', 'DOT']);
const isGuid = (t: string): boolean =>
  t.startsWith('Player-') || t.startsWith('Creature-') || t.startsWith('Pet-');

// ---------------------------------------------------------------------------
// Damage / healing parsers
// ---------------------------------------------------------------------------

function parseDamage(
  timestamp: Date,
  eventType: DamageEvent['eventType'],
  tokens: string[],
): DamageEvent | null {
  if (tokens.length < 10) return null;
  const { source, dest, nextIndex } = readPrefix(tokens);

  let spellId: number | undefined;
  let spellName: string | undefined;
  if (eventType !== 'SWING_DAMAGE' && eventType !== 'SWING_DAMAGE_LANDED') {
    spellId = toNumber(tokens[nextIndex]);
    spellName = unquote(tokens[nextIndex + 1] ?? '');
  }

  // Work from the end of the token array. The damage suffix is 10 fields
  // (amount, overkill, school, resisted, blocked, absorbed, critical,
  // glancing, crushing, isOffhand). Newer patches append a damage-type tag
  // (ST/AOE/NONE/HOT/DOT). _SUPPORT events append a supporter GUID as the
  // last token instead of the tag.
  const last = tokens[tokens.length - 1] ?? '';
  const isSupport = eventType === 'SPELL_DAMAGE_SUPPORT';
  const hasTrailer =
    isSupport || COMBAT_TAGS.has(last) || isGuid(last);
  const suffixLen = hasTrailer ? 11 : 10;

  if (tokens.length < suffixLen) return null;
  const base = tokens.length - suffixLen;

  return {
    timestamp,
    eventType,
    source,
    dest,
    spellId,
    spellName,
    amount: toNumber(tokens[base]),
    overkill: toNumber(tokens[base + 1]),
    resisted: toNumber(tokens[base + 3]),
    blocked: toNumber(tokens[base + 4]),
    absorbed: toNumber(tokens[base + 5]),
    critical: toBool(tokens[base + 6]),
    supporterGuid: isSupport ? last : undefined,
  };
}

function parseHeal(
  timestamp: Date,
  eventType: HealEvent['eventType'],
  tokens: string[],
): HealEvent | null {
  if (tokens.length < 10) return null;
  const { source, dest, nextIndex } = readPrefix(tokens);
  const spellId = toNumber(tokens[nextIndex]);
  const spellName = unquote(tokens[nextIndex + 1] ?? '');

  // Heal suffix (v12.0.1), in order:
  //   amount, baseAmount, overhealing, absorbed, critical
  // _SUPPORT variants append supporterGUID. We skip baseAmount — it's the
  // pre-modifier heal amount and we don't need it. Critical position we
  // read but effectively ignore, keeping the field for API shape.
  const last = tokens[tokens.length - 1] ?? '';
  const isSupport = eventType === 'SPELL_HEAL_SUPPORT';
  const trailingCount = isSupport ? 6 : 5;

  if (tokens.length < trailingCount) return null;
  const base = tokens.length - trailingCount;

  return {
    timestamp,
    eventType,
    source,
    dest,
    spellId,
    spellName,
    amount: toNumber(tokens[base]),
    // tokens[base + 1] is baseAmount — intentionally skipped.
    overhealing: toNumber(tokens[base + 2]),
    absorbed: toNumber(tokens[base + 3]),
    critical: toBool(tokens[base + 4]),
    supporterGuid: isSupport ? last : undefined,
  };
}

function parseInterrupt(
  timestamp: Date,
  tokens: string[],
): InterruptEvent | null {
  if (tokens.length < 15) return null;
  const { source, dest, nextIndex } = readPrefix(tokens);
  return {
    timestamp,
    eventType: 'SPELL_INTERRUPT',
    source,
    dest,
    spellId: toNumber(tokens[nextIndex]),
    spellName: unquote(tokens[nextIndex + 1] ?? ''),
    // tokens[nextIndex + 2] is spell school; skipped
    interruptedSpellId: toNumber(tokens[nextIndex + 3]),
    interruptedSpellName: unquote(tokens[nextIndex + 4] ?? ''),
  };
}

function parseDispel(timestamp: Date, tokens: string[]): DispelEvent | null {
  if (tokens.length < 16) return null;
  const { source, dest, nextIndex } = readPrefix(tokens);
  return {
    timestamp,
    eventType: 'SPELL_DISPEL',
    source,
    dest,
    spellId: toNumber(tokens[nextIndex]),
    spellName: unquote(tokens[nextIndex + 1] ?? ''),
    dispelledSpellId: toNumber(tokens[nextIndex + 3]),
    dispelledSpellName: unquote(tokens[nextIndex + 4] ?? ''),
    auraType: unquote(tokens[nextIndex + 6] ?? ''),
  };
}

function parseUnitDied(timestamp: Date, tokens: string[]): UnitDiedEvent | null {
  if (tokens.length < 9) return null;
  const { source, dest } = readPrefix(tokens);
  return {
    timestamp,
    eventType: 'UNIT_DIED',
    source,
    dest,
  };
}

function parseSummon(timestamp: Date, tokens: string[]): SummonEvent | null {
  // SPELL_SUMMON,<source 4>,<dest 4>,spellId,spellName,spellSchool
  // The dest is the summoned unit (pet/guardian/totem), the source is the caster.
  if (tokens.length < 11) return null;
  const { source, dest, nextIndex } = readPrefix(tokens);
  return {
    timestamp,
    eventType: 'SPELL_SUMMON',
    source,
    dest,
    spellId: toNumber(tokens[nextIndex]),
    spellName: unquote(tokens[nextIndex + 1] ?? ''),
  };
}

/**
 * SPELL_ABSORBED fires when an incoming damage hit is fully or partially
 * absorbed by a shield (Disc Priest Power Word: Shield, Warrior Ignore Pain,
 * DK Blood Shield, etc.). The shield's caster gets healing credit for the
 * absorbed amount — matching Details/Recount convention.
 *
 * Two subformats depending on whether the absorbed damage came from a swing
 * or a spell. We read the shield metadata by scanning from the END of the
 * token list: the trailing layout is always identical.
 *   ..., casterGUID, casterName, casterFlags, casterRaidFlags,
 *        shieldSpellId, shieldSpellName, shieldSchool,
 *        amount, baseAmount, critical
 * So casterGUID is at tokens.length - 10, amount at tokens.length - 3.
 */
function parseSpellAbsorbed(
  timestamp: Date,
  tokens: string[],
): SpellAbsorbedEvent | null {
  if (tokens.length < 18) return null;
  const { source, dest } = readPrefix(tokens);
  const n = tokens.length;
  const casterGuid = tokens[n - 10] ?? '';
  const casterName = unquote(tokens[n - 9] ?? '');
  const shieldSpellId = toNumber(tokens[n - 6]);
  const shieldSpellName = unquote(tokens[n - 5] ?? '');
  const amount = toNumber(tokens[n - 3]);

  // Guard: caster GUID should always be a Player-* GUID for player shields.
  if (!casterGuid.startsWith('Player-')) return null;

  return {
    timestamp,
    eventType: 'SPELL_ABSORBED',
    source,
    dest,
    casterGuid,
    casterName,
    shieldSpellId,
    shieldSpellName,
    amount,
  };
}

/**
 * SPELL_CAST_SUCCESS,<source 4>,<dest 4>,spellId,spellName,spellSchool,...
 * Source is the caster. dest can be "0000000000000000" for self-cast or
 * the target's GUID. We only need source + spellId for cooldown overlays.
 */
function parseSpellCastSuccess(
  timestamp: Date,
  tokens: string[],
): SpellCastSuccessEvent | null {
  if (tokens.length < 11) return null;
  const { source, dest, nextIndex } = readPrefix(tokens);
  // Skip events not cast by players (mobs, pets, etc.). Pets still matter for
  // some achievements but cast-event overlays are a player-focused feature.
  if (!source.guid.startsWith('Player-')) return null;
  return {
    timestamp,
    eventType: 'SPELL_CAST_SUCCESS',
    source,
    dest,
    spellId: toNumber(tokens[nextIndex]),
    spellName: unquote(tokens[nextIndex + 1] ?? ''),
  };
}

const MISS_TYPES = new Set<MissType>([
  'ABSORB',
  'BLOCK',
  'DEFLECT',
  'DODGE',
  'EVADE',
  'IMMUNE',
  'MISS',
  'PARRY',
  'REFLECT',
  'RESIST',
]);

function toMissType(raw: string | undefined): MissType | null {
  if (!raw) return null;
  const u = raw.toUpperCase() as MissType;
  return MISS_TYPES.has(u) ? u : null;
}

/**
 * SWING_MISSED,<source 4>,<dest 4>,missType,isOffHand[,amountMissed,baseAmount,critical]
 *
 * PARRY/DODGE/MISS/IMMUNE: no amount data in the log.
 * BLOCK/ABSORB: amountMissed + baseAmount are present.
 */
function parseSwingMissed(
  timestamp: Date,
  tokens: string[],
): SwingMissedEvent | null {
  if (tokens.length < 10) return null;
  const { source, dest, nextIndex } = readPrefix(tokens);
  const missType = toMissType(unquote(tokens[nextIndex] ?? ''));
  if (!missType) return null;
  // amountMissed sits at nextIndex + 2 (after isOffHand), if present.
  const amountMissed = toNumber(tokens[nextIndex + 2]);
  const baseAmount = toNumber(tokens[nextIndex + 3]);
  return {
    timestamp,
    eventType: 'SWING_MISSED',
    source,
    dest,
    missType,
    amountMissed,
    baseAmount,
  };
}

/**
 * SPELL_MISSED,<source 4>,<dest 4>,spellId,spellName,spellSchool,missType,isOffHand[,amountMissed,baseAmount,critical]
 */
function parseSpellMissed(
  timestamp: Date,
  tokens: string[],
): SpellMissedEvent | null {
  if (tokens.length < 13) return null;
  const { source, dest, nextIndex } = readPrefix(tokens);
  const spellId = toNumber(tokens[nextIndex]);
  const spellName = unquote(tokens[nextIndex + 1] ?? '');
  // Skip the spellSchool field at nextIndex + 2.
  const missType = toMissType(unquote(tokens[nextIndex + 3] ?? ''));
  if (!missType) return null;
  // amountMissed at nextIndex + 5 (after isOffHand), if present.
  const amountMissed = toNumber(tokens[nextIndex + 5]);
  const baseAmount = toNumber(tokens[nextIndex + 6]);
  return {
    timestamp,
    eventType: 'SPELL_MISSED',
    source,
    dest,
    spellId,
    spellName,
    missType,
    amountMissed,
    baseAmount,
  };
}
