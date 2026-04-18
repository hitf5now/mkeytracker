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
    | 'SPELL_DAMAGE_SUPPORT';
  spellId?: number;
  spellName?: string;
  amount: number;
  overkill: number;
  absorbed: number;
  critical: boolean;
  /** Present on _SUPPORT events: the GUID actually being supported. */
  supporterGuid?: string;
}

export interface HealEvent extends CombatEventSourceDest {
  eventType: 'SPELL_HEAL' | 'SPELL_PERIODIC_HEAL' | 'SPELL_HEAL_SUPPORT';
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
  | UnitDiedEvent;

// ---------------------------------------------------------------------------
// Aggregated output
// ---------------------------------------------------------------------------

export interface PlayerStats {
  guid: string;
  name: string;
  specId?: number;
  damageDone: number;
  damageDoneSupport: number;
  healingDone: number;
  healingDoneSupport: number;
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
    healing: number;
    healingSupport: number;
    deaths: number;
    interrupts: number;
    dispels: number;
  };
  eventCounts: Record<string, number>;
}
