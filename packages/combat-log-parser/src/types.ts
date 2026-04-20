export interface EventBase {
  timestamp: Date;
  eventType: string;
}

export interface SourceDest {
  guid: string;
  name: string;
  flags: string;
  raidFlags: string;
}

export interface ChallengeModeStart extends EventBase {
  eventType: 'CHALLENGE_MODE_START';
  zoneName: string;
  instanceId: number;
  challengeModeId: number;
  keystoneLevel: number;
  affixIds: number[];
}

export interface ChallengeModeEnd extends EventBase {
  eventType: 'CHALLENGE_MODE_END';
  instanceId: number;
  success: boolean;
  keystoneLevel: number;
  durationMs: number;
  /** Extra trailing floats (e.g. rating before/after). Captured raw. */
  trailing: number[];
}

export interface EncounterStart extends EventBase {
  eventType: 'ENCOUNTER_START';
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  groupSize: number;
  instanceId: number;
}

export interface EncounterEnd extends EventBase {
  eventType: 'ENCOUNTER_END';
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  groupSize: number;
  success: boolean;
  fightTimeMs: number;
}

export interface CombatantInfo extends EventBase {
  eventType: 'COMBATANT_INFO';
  playerGuid: string;
  specId: number;
  /** Equipped item count. Full gear array kept raw for later if needed. */
  itemLevelAvg: number;
}

export interface CombatEventSourceDest extends EventBase {
  source: SourceDest;
  dest: SourceDest;
}

export interface DamageEvent extends CombatEventSourceDest {
  eventType:
    | 'SPELL_DAMAGE'
    | 'SPELL_PERIODIC_DAMAGE'
    | 'SWING_DAMAGE'
    | 'SWING_DAMAGE_LANDED'
    | 'RANGE_DAMAGE'
    | 'SPELL_DAMAGE_SUPPORT'
    | 'SPELL_PERIODIC_DAMAGE_SUPPORT'
    | 'RANGE_DAMAGE_SUPPORT'
    | 'SWING_DAMAGE_LANDED_SUPPORT';
  spellId?: number;
  spellName?: string;
  amount: number;
  overkill: number;
  /** Magic resistance portion (school-specific). */
  resisted: number;
  /** Partial-block amount when the dest has a shield up. */
  blocked: number;
  absorbed: number;
  critical: boolean;
  /** Present on _SUPPORT events: the GUID being credited for the buff contribution. */
  supporterGuid?: string;
  /**
   * Advanced-logging `ownerGUID` field. For Pet-/Creature-/Vehicle- sources
   * this is the owning Player GUID when advanced combat logging is on.
   * Used as a fallback pet-attribution signal when a SPELL_SUMMON record is
   * missing (e.g. the pet was summoned before /combatlog started).
   */
  ownerGuid?: string;
}

export interface HealEvent extends CombatEventSourceDest {
  eventType:
    | 'SPELL_HEAL'
    | 'SPELL_PERIODIC_HEAL'
    | 'SPELL_HEAL_SUPPORT'
    | 'SPELL_PERIODIC_HEAL_SUPPORT';
  spellId: number;
  spellName: string;
  amount: number;
  overhealing: number;
  absorbed: number;
  critical: boolean;
  supporterGuid?: string;
}

export interface InterruptEvent extends CombatEventSourceDest {
  eventType: 'SPELL_INTERRUPT';
  spellId: number;
  spellName: string;
  interruptedSpellId: number;
  interruptedSpellName: string;
}

export interface DispelEvent extends CombatEventSourceDest {
  eventType: 'SPELL_DISPEL';
  spellId: number;
  spellName: string;
  dispelledSpellId: number;
  dispelledSpellName: string;
  auraType: string;
}

export interface UnitDiedEvent extends CombatEventSourceDest {
  eventType: 'UNIT_DIED';
}

export interface SummonEvent extends CombatEventSourceDest {
  eventType: 'SPELL_SUMMON';
  spellId: number;
  spellName: string;
}

/**
 * Fires when a damage event is fully or partially absorbed by a shield.
 * The shield's caster gets healing credit for the absorbed amount.
 *
 * source = attacker, dest = victim (shield holder), caster = shield provider.
 */
export interface SpellAbsorbedEvent extends CombatEventSourceDest {
  eventType: 'SPELL_ABSORBED';
  casterGuid: string;
  casterName: string;
  shieldSpellId: number;
  shieldSpellName: string;
  amount: number;
}

/** Spell cast landed successfully. Used for future cooldown-overlay mapping. */
export interface SpellCastSuccessEvent extends CombatEventSourceDest {
  eventType: 'SPELL_CAST_SUCCESS';
  spellId: number;
  spellName: string;
}

export type MissType =
  | 'ABSORB'
  | 'BLOCK'
  | 'DEFLECT'
  | 'DODGE'
  | 'EVADE'
  | 'IMMUNE'
  | 'MISS'
  | 'PARRY'
  | 'REFLECT'
  | 'RESIST';

/**
 * Swing-based avoidance (parry/dodge/miss/immune) or full absorb/block of a
 * melee hit. amountMissed is present for ABSORB and BLOCK, otherwise 0.
 */
export interface SwingMissedEvent extends CombatEventSourceDest {
  eventType: 'SWING_MISSED';
  missType: MissType;
  amountMissed: number;
  baseAmount: number;
}

/** Spell equivalent of SWING_MISSED. */
export interface SpellMissedEvent extends CombatEventSourceDest {
  eventType: 'SPELL_MISSED';
  spellId: number;
  spellName: string;
  missType: MissType;
  amountMissed: number;
  baseAmount: number;
}

export type ParsedEvent =
  | ChallengeModeStart
  | ChallengeModeEnd
  | EncounterStart
  | EncounterEnd
  | CombatantInfo
  | DamageEvent
  | HealEvent
  | InterruptEvent
  | DispelEvent
  | UnitDiedEvent
  | SummonEvent
  | SpellAbsorbedEvent
  | SpellCastSuccessEvent
  | SwingMissedEvent
  | SpellMissedEvent;

// ---------------------------------------------------------------------------
// Aggregated output
// ---------------------------------------------------------------------------

export interface PlayerStats {
  guid: string;
  name: string;
  specId?: number;
  damageDone: number;
  damageDoneSupport: number;
  /**
   * Portion of `damageDone` that came from this player's pets, guardians, and
   * totems (routed via SPELL_SUMMON → source GUID lookup). Already included in
   * `damageDone`; exposed separately so UIs can show a pet subtotal.
   */
  petDamageDone: number;
  /**
   * Effective healing (Details/Recount convention): raw heal amount minus
   * overhealing and minus any heal-absorbed portion. Also includes
   * SPELL_ABSORBED credits for shields this player cast.
   */
  healingDone: number;
  healingDoneSupport: number;
  /** Portion of `healingDone` that came from this player's pets/guardians. */
  petHealingDone: number;
  /**
   * Amount of healing that went to targets already at full HP — tracked
   * separately so the UI can show "Heal / Overheal" and achievements can
   * roast people who spam heal fully-topped targets.
   */
  overhealing: number;
  /**
   * Damage absorbed by shields this player cast (sum of SPELL_ABSORBED
   * amounts where caster = this player). Split out of healingDone so the
   * UI can show shield output separately from raw heal output.
   */
  absorbProvided: number;
  /** Actual damage received by this player (sum of SPELL/SWING/RANGE_DAMAGE dest=player). */
  damageTaken: number;
  /**
   * Damage the log showed aiming at this player: damageTaken + absorbed +
   * blocked + resisted + amountMissed(full-absorb/block). Post-armor,
   * pre-shield/block/resist. Does NOT include fully avoided hits
   * (parry/dodge/miss) since the log doesn't compute an amount for them.
   */
  damageIncoming: number;
  /** Healing where source = dest = this player (self-heals). Effective amounts. */
  selfHealing: number;
  /** Avoidance counts — events only, no amount data in the log. */
  parries: number;
  dodges: number;
  misses: number;
  interrupts: number;
  dispels: number;
  deaths: number;
  /**
   * Damage done in each 5-second bucket from CHALLENGE_MODE_START.
   * buckets[i] covers [i * bucketSizeMs, (i+1) * bucketSizeMs). The array
   * length equals the run duration in buckets (ceil(durationMs / bucketSizeMs)).
   */
  damageBuckets: number[];
  /** Index of the bucket with the most damage (argmax of damageBuckets). */
  peakBucketIndex: number;
  /** Damage in the peak bucket. DPS = peakDamage / (bucketSizeMs / 1000). */
  peakDamage: number;
  /** Raw healing output per bucket (includes overheal). For the Healing tab. */
  healingBuckets: number[];
  /** Shield-absorb output per bucket. For the Absorbs section. */
  absorbProvidedBuckets: number[];
  /** Damage received per bucket. For the Tanking tab (line 2). */
  damageTakenBuckets: number[];
  /** Damage directed per bucket (post-armor, pre-shield/block/resist). For the Tanking tab (line 1). */
  damageIncomingBuckets: number[];
  /** Self-heals per bucket. For the Tanking tab (line 3). */
  selfHealingBuckets: number[];
  /**
   * Cast events the player landed — stored for future cooldown-overlay
   * rendering. Keeping this lightweight: only spellId + offsetMs (ms from
   * segment start). Typically tens to a few hundred entries per player.
   */
  castEvents: Array<{ spellId: number; offsetMs: number }>;
}

export interface EncounterSummary {
  encounterId: number;
  encounterName: string;
  success: boolean;
  fightTimeMs: number;
  startedAt: Date;
  /** M+ = 8; other content differs. Preserved for diagnostics. */
  difficultyId: number;
  groupSize: number;
}

export interface RunSummary {
  zoneName: string;
  instanceId: number;
  challengeModeId: number;
  keystoneLevel: number;
  affixIds: number[];
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  success: boolean;
  endingTrailingFields: number[];
  /** Bucket size used for player damage timelines, in milliseconds. */
  bucketSizeMs: number;
  encounters: EncounterSummary[];
  players: PlayerStats[];
  totals: {
    damage: number;
    damageSupport: number;
    petDamage: number;
    healing: number;
    healingSupport: number;
    petHealing: number;
    overhealing: number;
    absorbProvided: number;
    damageTaken: number;
    deaths: number;
    interrupts: number;
    dispels: number;
  };
  eventCounts: Record<string, number>;
}
