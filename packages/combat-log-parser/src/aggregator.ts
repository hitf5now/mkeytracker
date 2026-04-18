import type {
  ParsedEvent,
  PlayerStats,
  EncounterSummary,
  RunSummary,
} from './types.js';

interface MutablePlayerStats extends PlayerStats {}

/**
 * Consumes a stream of ParsedEvent objects and builds a RunSummary for the
 * first complete CHALLENGE_MODE_START → CHALLENGE_MODE_END segment found.
 *
 * The "phantom" CHALLENGE_MODE_END that WoW emits with a zero duration at key
 * activation time is ignored: only CHALLENGE_MODE_END events with durationMs > 0
 * close the segment.
 */
export class RunAggregator {
  private started = false;
  private ended = false;

  private startEvent: import('./types.js').ChallengeModeStart | null = null;
  private endEvent: import('./types.js').ChallengeModeEnd | null = null;

  private players = new Map<string, MutablePlayerStats>();
  private encounters: EncounterSummary[] = [];
  private activeEncounter: {
    startedAt: Date;
    encounterId: number;
    encounterName: string;
    difficultyId: number;
    groupSize: number;
  } | null = null;
  private eventCounts: Record<string, number> = {};

  process(event: ParsedEvent): void {
    // Boundary events are counted only if they actually start/close the segment;
    // all other events are counted only while inside an open segment. This
    // keeps summaries scoped to the M+ run even when the file also contains
    // delves, raids, or world content before/after.
    switch (event.eventType) {
      case 'CHALLENGE_MODE_START':
        if (!this.started) {
          this.startEvent = event;
          this.started = true;
          this.bumpCount(event.eventType);
        }
        return;

      case 'CHALLENGE_MODE_END':
        if (this.started && !this.ended && event.durationMs > 0) {
          this.endEvent = event;
          this.ended = true;
          this.bumpCount(event.eventType);
        }
        return;
    }

    if (!this.started || this.ended) return;
    this.bumpCount(event.eventType);

    switch (event.eventType) {
      case 'ENCOUNTER_START':
        this.activeEncounter = {
          startedAt: event.timestamp,
          encounterId: event.encounterId,
          encounterName: event.encounterName,
          difficultyId: event.difficultyId,
          groupSize: event.groupSize,
        };
        return;

      case 'ENCOUNTER_END':
        if (this.activeEncounter) {
          this.encounters.push({
            encounterId: event.encounterId,
            encounterName: event.encounterName,
            success: event.success,
            fightTimeMs: event.fightTimeMs,
            startedAt: this.activeEncounter.startedAt,
            difficultyId: this.activeEncounter.difficultyId,
            groupSize: this.activeEncounter.groupSize,
          });
          this.activeEncounter = null;
        }
        return;

      case 'COMBATANT_INFO':
        this.recordSpec(event.playerGuid, event.specId);
        return;

      case 'SPELL_DAMAGE':
      case 'SPELL_PERIODIC_DAMAGE':
      case 'RANGE_DAMAGE':
      case 'SWING_DAMAGE':
      case 'SWING_DAMAGE_LANDED':
        this.addDamage(event.source.guid, event.source.name, event.amount, false);
        return;

      case 'SPELL_DAMAGE_SUPPORT':
        // Support credits go to the supporter (the Augmentation Evoker / etc.)
        if (event.supporterGuid) {
          this.addDamage(event.supporterGuid, '', event.amount, true);
        }
        return;

      case 'SPELL_HEAL':
      case 'SPELL_PERIODIC_HEAL':
        // Using raw amount (including overheal) for prototype — matches how
        // most DPS meters display healing. Overheal field extraction is
        // unreliable across patches; revisit once the field order is
        // confirmed with more samples.
        this.addHealing(event.source.guid, event.source.name, event.amount, false);
        return;

      case 'SPELL_HEAL_SUPPORT':
        if (event.supporterGuid) {
          this.addHealing(event.supporterGuid, '', event.amount, true);
        }
        return;

      case 'SPELL_INTERRUPT':
        this.getOrCreatePlayer(event.source.guid, event.source.name).interrupts++;
        return;

      case 'SPELL_DISPEL':
        this.getOrCreatePlayer(event.source.guid, event.source.name).dispels++;
        return;

      case 'UNIT_DIED':
        if (event.dest.guid.startsWith('Player-')) {
          this.getOrCreatePlayer(event.dest.guid, event.dest.name).deaths++;
        }
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private bumpCount(eventType: string): void {
    this.eventCounts[eventType] = (this.eventCounts[eventType] ?? 0) + 1;
  }

  private getOrCreatePlayer(guid: string, name: string): MutablePlayerStats {
    let p = this.players.get(guid);
    if (!p) {
      p = {
        guid,
        name,
        damageDone: 0,
        damageDoneSupport: 0,
        healingDone: 0,
        healingDoneSupport: 0,
        interrupts: 0,
        dispels: 0,
        deaths: 0,
      };
      this.players.set(guid, p);
    } else if (!p.name && name) {
      p.name = name;
    }
    return p;
  }

  private recordSpec(guid: string, specId: number): void {
    const p = this.getOrCreatePlayer(guid, '');
    if (specId > 0 && !p.specId) p.specId = specId;
  }

  private addDamage(
    guid: string,
    name: string,
    amount: number,
    isSupport: boolean,
  ): void {
    if (!guid || !guid.startsWith('Player-')) return;
    const p = this.getOrCreatePlayer(guid, name);
    if (isSupport) p.damageDoneSupport += amount;
    else p.damageDone += amount;
  }

  private addHealing(
    guid: string,
    name: string,
    amount: number,
    isSupport: boolean,
  ): void {
    if (!guid || !guid.startsWith('Player-')) return;
    const p = this.getOrCreatePlayer(guid, name);
    if (isSupport) p.healingDoneSupport += amount;
    else p.healingDone += amount;
  }

  // -------------------------------------------------------------------------
  // Finalization
  // -------------------------------------------------------------------------

  get isComplete(): boolean {
    return this.ended;
  }

  finalize(): RunSummary | null {
    if (!this.startEvent || !this.endEvent) return null;

    const players = Array.from(this.players.values())
      .filter((p) => p.guid.startsWith('Player-'))
      .sort((a, b) => b.damageDone - a.damageDone);

    const totals = players.reduce(
      (acc, p) => {
        acc.damage += p.damageDone;
        acc.damageSupport += p.damageDoneSupport;
        acc.healing += p.healingDone;
        acc.healingSupport += p.healingDoneSupport;
        acc.deaths += p.deaths;
        acc.interrupts += p.interrupts;
        acc.dispels += p.dispels;
        return acc;
      },
      {
        damage: 0,
        damageSupport: 0,
        healing: 0,
        healingSupport: 0,
        deaths: 0,
        interrupts: 0,
        dispels: 0,
      },
    );

    return {
      zoneName: this.startEvent.zoneName,
      instanceId: this.startEvent.instanceId,
      challengeModeId: this.startEvent.challengeModeId,
      keystoneLevel: this.startEvent.keystoneLevel,
      affixIds: this.startEvent.affixIds,
      startedAt: this.startEvent.timestamp,
      endedAt: this.endEvent.timestamp,
      durationMs: this.endEvent.durationMs,
      success: this.endEvent.success,
      endingTrailingFields: this.endEvent.trailing,
      encounters: this.encounters,
      players,
      totals,
      eventCounts: this.eventCounts,
    };
  }
}
