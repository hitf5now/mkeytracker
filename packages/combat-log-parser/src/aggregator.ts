import type {
  ParsedEvent,
  PlayerStats,
  EncounterSummary,
  RunSummary,
} from './types.js';

/** Width of a player-damage timeline bucket, in milliseconds. */
export const DAMAGE_BUCKET_SIZE_MS = 5000;

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
  /**
   * Pet / guardian / totem GUID → owning player GUID, populated from
   * SPELL_SUMMON events. Populated regardless of segment state so a pet
   * summoned pre-combat still attributes correctly once the run starts.
   */
  private petOwners = new Map<string, string>();
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
        if (this.started && !this.ended) {
          if (event.durationMs > 0 && event.keystoneLevel > 0 && event.success) {
            // Real end of a completed run.
            this.endEvent = event;
            this.ended = true;
            this.bumpCount(event.eventType);
          } else {
            // Abandon sentinel: WoW emits CHALLENGE_MODE_END with
            // durationMs=0 / keyLvl=0 / success=false when a key is reset or
            // abandoned. Reset accumulated state so the NEXT CHALLENGE_MODE_START
            // can begin a clean segment. Without this, the aggregator stays
            // locked on the abandoned key and merges the next key's events in.
            this.resetSegmentState();
          }
        }
        return;

      case 'SPELL_SUMMON':
        // Pre-gate: a player may summon their pet seconds before
        // CHALLENGE_MODE_START. Record ownership regardless of segment state.
        if (event.source.guid.startsWith('Player-') && event.dest.guid) {
          this.petOwners.set(event.dest.guid, event.source.guid);
        }
        if (this.started && !this.ended) this.bumpCount(event.eventType);
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
        // NOTE: SWING_DAMAGE_LANDED is intentionally NOT handled. WoW emits
        // both SWING_DAMAGE and SWING_DAMAGE_LANDED for the same melee hit
        // (the latter is for addons that need a guaranteed-landed frame).
        // Counting both would double-count every autoattack. Details/Recount
        // count only SWING_DAMAGE.
        this.addDamage(
          event.source.guid,
          event.source.name,
          event.amount,
          false,
          event.timestamp,
        );
        // Attribute pet/guardian/totem damage to the owning player.
        this.addPetDamage(event.source.guid, event.amount, event.timestamp);
        return;

      case 'SWING_DAMAGE_LANDED':
        // Explicitly a no-op — counted above via SWING_DAMAGE. Bump the event
        // count so the summary still reflects log coverage.
        return;

      case 'SPELL_DAMAGE_SUPPORT':
        // Support credits go to the supporter (the Augmentation Evoker / etc.)
        if (event.supporterGuid) {
          this.addDamage(event.supporterGuid, '', event.amount, true, event.timestamp);
        }
        return;

      case 'SPELL_HEAL':
      case 'SPELL_PERIODIC_HEAL': {
        // Effective healing (Details/Recount convention) = amount - overheal
        // - heal-absorbed. Overheal is tracked separately so the UI can show
        // "1.2M / 300k overheal" and achievements can roast people who spam
        // heal topped-off targets.
        const effective = Math.max(
          0,
          event.amount - event.overhealing - event.absorbed,
        );
        this.addHealing(event.source.guid, event.source.name, effective, false);
        this.addOverhealing(event.source.guid, event.overhealing);
        this.addPetHealing(event.source.guid, effective);
        return;
      }

      case 'SPELL_HEAL_SUPPORT':
        if (event.supporterGuid) {
          const effective = Math.max(
            0,
            event.amount - event.overhealing - event.absorbed,
          );
          this.addHealing(event.supporterGuid, '', effective, true);
        }
        return;

      case 'SPELL_ABSORBED':
        // The shield's caster gets healing credit for the absorbed amount.
        // This is what Details/Recount do — a shield that ate 500k damage
        // is effectively 500k healing done by the shield provider.
        this.addHealing(event.casterGuid, event.casterName, event.amount, false);
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
        petDamageDone: 0,
        healingDone: 0,
        healingDoneSupport: 0,
        petHealingDone: 0,
        overhealing: 0,
        interrupts: 0,
        dispels: 0,
        deaths: 0,
        damageBuckets: [],
        peakBucketIndex: 0,
        peakDamage: 0,
      };
      this.players.set(guid, p);
    } else if (!p.name && name) {
      p.name = name;
    }
    return p;
  }

  /**
   * Wipe everything accumulated for the current segment so a new START can
   * begin fresh. Called when we detect an abandon sentinel
   * (CHALLENGE_MODE_END with durationMs=0). We keep `petOwners` — a pet
   * summoned in a previous pull may still be out and attacking, and its
   * GUID→owner mapping remains valid.
   */
  private resetSegmentState(): void {
    this.started = false;
    this.ended = false;
    this.startEvent = null;
    this.endEvent = null;
    this.players.clear();
    this.encounters = [];
    this.activeEncounter = null;
    this.eventCounts = {};
  }

  /**
   * Bucket index for a given event timestamp, relative to CHALLENGE_MODE_START.
   * Returns -1 if the segment hasn't started (shouldn't happen inside the
   * damage handlers due to the `started && !ended` gate, but defensive).
   */
  private bucketIndexFor(eventTimestamp: Date): number {
    if (!this.startEvent) return -1;
    const offsetMs = eventTimestamp.getTime() - this.startEvent.timestamp.getTime();
    if (offsetMs < 0) return -1;
    return Math.floor(offsetMs / DAMAGE_BUCKET_SIZE_MS);
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
    timestamp: Date,
  ): void {
    if (!guid || !guid.startsWith('Player-')) return;
    const p = this.getOrCreatePlayer(guid, name);
    if (isSupport) {
      p.damageDoneSupport += amount;
    } else {
      p.damageDone += amount;
      // Timeline bucketing — only for primary damage, not the support credit,
      // so the line chart reflects what the player personally put out.
      const bucketIndex = this.bucketIndexFor(timestamp);
      if (bucketIndex >= 0) {
        while (p.damageBuckets.length <= bucketIndex) p.damageBuckets.push(0);
        p.damageBuckets[bucketIndex]! += amount;
      }
    }
  }

  private addHealing(
    guid: string,
    name: string,
    amount: number,
    isSupport: boolean,
  ): void {
    if (!guid || !guid.startsWith('Player-')) return;
    if (amount <= 0) return;
    const p = this.getOrCreatePlayer(guid, name);
    if (isSupport) p.healingDoneSupport += amount;
    else p.healingDone += amount;
  }

  private addOverhealing(guid: string, amount: number): void {
    if (!guid || !guid.startsWith('Player-')) return;
    if (amount <= 0) return;
    const p = this.getOrCreatePlayer(guid, '');
    p.overhealing += amount;
  }

  /**
   * If a damage event's source is a known pet/guardian/totem, roll the damage
   * into the owner's `damageDone` + timeline bucket, and track the subtotal
   * separately in `petDamageDone` for UI display.
   */
  private addPetDamage(
    sourceGuid: string,
    amount: number,
    timestamp: Date,
  ): void {
    if (!sourceGuid || sourceGuid.startsWith('Player-')) return;
    const ownerGuid = this.petOwners.get(sourceGuid);
    if (!ownerGuid) return;
    const owner = this.getOrCreatePlayer(ownerGuid, '');
    owner.damageDone += amount;
    owner.petDamageDone += amount;
    const bucketIndex = this.bucketIndexFor(timestamp);
    if (bucketIndex >= 0) {
      while (owner.damageBuckets.length <= bucketIndex) owner.damageBuckets.push(0);
      owner.damageBuckets[bucketIndex]! += amount;
    }
  }

  private addPetHealing(sourceGuid: string, amount: number): void {
    if (!sourceGuid || sourceGuid.startsWith('Player-')) return;
    const ownerGuid = this.petOwners.get(sourceGuid);
    if (!ownerGuid) return;
    const owner = this.getOrCreatePlayer(ownerGuid, '');
    owner.healingDone += amount;
    owner.petHealingDone += amount;
  }

  // -------------------------------------------------------------------------
  // Finalization
  // -------------------------------------------------------------------------

  get isComplete(): boolean {
    return this.ended;
  }

  finalize(): RunSummary | null {
    if (!this.startEvent || !this.endEvent) return null;

    // Normalize bucket arrays to the full run length, then compute each
    // player's peak. Short arrays are padded with zeros; this keeps the
    // client-side chart x-axis consistent across players.
    const totalBuckets = Math.max(
      1,
      Math.ceil(this.endEvent.durationMs / DAMAGE_BUCKET_SIZE_MS),
    );
    for (const p of this.players.values()) {
      while (p.damageBuckets.length < totalBuckets) p.damageBuckets.push(0);
      // Trim any stragglers past run end (shouldn't happen, but defensive).
      if (p.damageBuckets.length > totalBuckets) {
        p.damageBuckets.length = totalBuckets;
      }
      let peakIdx = 0;
      let peakVal = p.damageBuckets[0] ?? 0;
      for (let i = 1; i < p.damageBuckets.length; i++) {
        if (p.damageBuckets[i]! > peakVal) {
          peakVal = p.damageBuckets[i]!;
          peakIdx = i;
        }
      }
      p.peakBucketIndex = peakIdx;
      p.peakDamage = peakVal;
    }

    const players = Array.from(this.players.values())
      .filter((p) => p.guid.startsWith('Player-'))
      .sort((a, b) => b.damageDone - a.damageDone);

    const totals = players.reduce(
      (acc, p) => {
        acc.damage += p.damageDone;
        acc.damageSupport += p.damageDoneSupport;
        acc.petDamage += p.petDamageDone;
        acc.healing += p.healingDone;
        acc.healingSupport += p.healingDoneSupport;
        acc.petHealing += p.petHealingDone;
        acc.overhealing += p.overhealing;
        acc.deaths += p.deaths;
        acc.interrupts += p.interrupts;
        acc.dispels += p.dispels;
        return acc;
      },
      {
        damage: 0,
        damageSupport: 0,
        petDamage: 0,
        healing: 0,
        healingSupport: 0,
        petHealing: 0,
        overhealing: 0,
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
      bucketSizeMs: DAMAGE_BUCKET_SIZE_MS,
      encounters: this.encounters,
      players,
      totals,
      eventCounts: this.eventCounts,
    };
  }
}
