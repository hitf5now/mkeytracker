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
        // Attribute pet/guardian/totem damage to the owning player. Pass the
        // advanced-logging ownerGUID so we can backfill petOwners for pets
        // that were summoned before /combatlog started (no SPELL_SUMMON).
        this.addPetDamage(
          event.source.guid,
          event.amount,
          event.timestamp,
          event.ownerGuid,
        );
        // Record damage taken + incoming on the dest (tank-chart inputs).
        this.addDamageTaken(
          event.dest.guid,
          event.dest.name,
          event.amount,
          event.timestamp,
        );
        this.addDamageIncoming(
          event.dest.guid,
          event.dest.name,
          event.amount + event.absorbed + event.blocked + event.resisted,
          event.timestamp,
        );
        return;

      case 'SWING_DAMAGE_LANDED':
        // Explicitly a no-op — counted above via SWING_DAMAGE. Bump the event
        // count so the summary still reflects log coverage.
        return;

      case 'SPELL_DAMAGE_SUPPORT':
      case 'SPELL_PERIODIC_DAMAGE_SUPPORT':
      case 'RANGE_DAMAGE_SUPPORT':
      case 'SWING_DAMAGE_LANDED_SUPPORT':
        // Support credits go to the supporter (the Augmentation Evoker / etc.).
        // All four variants share the same trailer layout (supporter GUID as
        // the last token), so the parser surfaces a uniform supporterGuid.
        // NOTE: SWING_DAMAGE_LANDED_SUPPORT is the _SUPPORT counterpart of
        // melee autoattacks — WoW only emits the LANDED variant for swings
        // under support buffs, so we don't also skip it here (unlike the
        // primary SWING_DAMAGE_LANDED, there's no SWING_DAMAGE_SUPPORT twin
        // to worry about double-counting against).
        if (event.supporterGuid) {
          this.addDamage(event.supporterGuid, '', event.amount, true, event.timestamp);
        }
        return;

      case 'SPELL_HEAL':
      case 'SPELL_PERIODIC_HEAL': {
        // Effective healing (Details convention) = amount - overheal - heal-absorbed.
        // Overheal tracked separately. `healingBuckets` captures RAW heal output
        // (including overheal) for the Healing tab chart.
        const effective = Math.max(
          0,
          event.amount - event.overhealing - event.absorbed,
        );
        this.addHealing(event.source.guid, event.source.name, effective, false);
        this.addOverhealing(event.source.guid, event.overhealing);
        this.addPetHealing(event.source.guid, effective);
        this.addHealingBucket(event.source.guid, event.amount, event.timestamp);
        // Self-healing: source = dest. Used for the Tanking tab (line 3).
        if (event.source.guid === event.dest.guid) {
          this.addSelfHealing(
            event.source.guid,
            event.source.name,
            effective,
            event.timestamp,
          );
        }
        return;
      }

      case 'SPELL_HEAL_SUPPORT':
      case 'SPELL_PERIODIC_HEAL_SUPPORT':
        if (event.supporterGuid) {
          const effective = Math.max(
            0,
            event.amount - event.overhealing - event.absorbed,
          );
          this.addHealing(event.supporterGuid, '', effective, true);
        }
        return;

      case 'SPELL_ABSORBED':
        // Shield absorbs are split out of healingDone into absorbProvided so
        // the UI can separate "heals cast" from "damage mitigated via shield."
        this.addAbsorbProvided(
          event.casterGuid,
          event.casterName,
          event.amount,
          event.timestamp,
        );
        // Also contributes to the dest's damageIncoming for the tank chart.
        this.addDamageIncoming(
          event.dest.guid,
          event.dest.name,
          event.amount,
          event.timestamp,
        );
        return;

      case 'SWING_MISSED':
      case 'SPELL_MISSED':
        this.handleMissed(event);
        return;

      case 'SPELL_CAST_SUCCESS':
        if (this.startEvent) {
          const offsetMs =
            event.timestamp.getTime() - this.startEvent.timestamp.getTime();
          if (offsetMs >= 0) {
            const p = this.getOrCreatePlayer(event.source.guid, event.source.name);
            p.castEvents.push({ spellId: event.spellId, offsetMs });
          }
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

  /**
   * Route SWING_MISSED / SPELL_MISSED against a player dest.
   * - BLOCK/ABSORB missType with amountMissed: count as damage that was
   *   directed (damageIncoming) AND fully mitigated.
   * - PARRY / DODGE / MISS: count-only; no amount in the log.
   * Other missTypes (IMMUNE, DEFLECT, RESIST, REFLECT, EVADE) are ignored —
   * rare and mostly not tank-mitigation events.
   */
  private handleMissed(
    event: import('./types.js').SwingMissedEvent | import('./types.js').SpellMissedEvent,
  ): void {
    if (!event.dest.guid.startsWith('Player-')) return;
    const p = this.getOrCreatePlayer(event.dest.guid, event.dest.name);
    switch (event.missType) {
      case 'PARRY':
        p.parries++;
        return;
      case 'DODGE':
        p.dodges++;
        return;
      case 'MISS':
        p.misses++;
        return;
      case 'BLOCK':
      case 'ABSORB': {
        const amt = event.amountMissed;
        if (amt > 0) {
          // Fully mitigated attempts still count toward damageIncoming —
          // the enemy tried to hit and we saw it; the tank just ate none of it.
          this.addDamageIncoming(
            event.dest.guid,
            event.dest.name,
            amt,
            event.timestamp,
          );
        }
        return;
      }
      default:
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
        absorbProvided: 0,
        damageTaken: 0,
        damageIncoming: 0,
        selfHealing: 0,
        parries: 0,
        dodges: 0,
        misses: 0,
        interrupts: 0,
        dispels: 0,
        deaths: 0,
        damageBuckets: [],
        peakBucketIndex: 0,
        peakDamage: 0,
        healingBuckets: [],
        absorbProvidedBuckets: [],
        damageTakenBuckets: [],
        damageIncomingBuckets: [],
        selfHealingBuckets: [],
        castEvents: [],
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

  private writeToBucket(arr: number[], index: number, amount: number): void {
    while (arr.length <= index) arr.push(0);
    arr[index]! += amount;
  }

  private addHealingBucket(guid: string, amount: number, ts: Date): void {
    if (!guid || !guid.startsWith('Player-')) return;
    if (amount <= 0) return;
    const idx = this.bucketIndexFor(ts);
    if (idx < 0) return;
    const p = this.getOrCreatePlayer(guid, '');
    this.writeToBucket(p.healingBuckets, idx, amount);
  }

  private addAbsorbProvided(
    guid: string,
    name: string,
    amount: number,
    ts: Date,
  ): void {
    if (!guid || !guid.startsWith('Player-')) return;
    if (amount <= 0) return;
    const p = this.getOrCreatePlayer(guid, name);
    p.absorbProvided += amount;
    const idx = this.bucketIndexFor(ts);
    if (idx >= 0) this.writeToBucket(p.absorbProvidedBuckets, idx, amount);
  }

  private addDamageTaken(
    guid: string,
    name: string,
    amount: number,
    ts: Date,
  ): void {
    if (!guid || !guid.startsWith('Player-')) return;
    if (amount <= 0) return;
    const p = this.getOrCreatePlayer(guid, name);
    p.damageTaken += amount;
    const idx = this.bucketIndexFor(ts);
    if (idx >= 0) this.writeToBucket(p.damageTakenBuckets, idx, amount);
  }

  private addDamageIncoming(
    guid: string,
    name: string,
    amount: number,
    ts: Date,
  ): void {
    if (!guid || !guid.startsWith('Player-')) return;
    if (amount <= 0) return;
    const p = this.getOrCreatePlayer(guid, name);
    p.damageIncoming += amount;
    const idx = this.bucketIndexFor(ts);
    if (idx >= 0) this.writeToBucket(p.damageIncomingBuckets, idx, amount);
  }

  private addSelfHealing(
    guid: string,
    name: string,
    amount: number,
    ts: Date,
  ): void {
    if (!guid || !guid.startsWith('Player-')) return;
    if (amount <= 0) return;
    const p = this.getOrCreatePlayer(guid, name);
    p.selfHealing += amount;
    const idx = this.bucketIndexFor(ts);
    if (idx >= 0) this.writeToBucket(p.selfHealingBuckets, idx, amount);
  }

  /**
   * If a damage event's source is a known pet/guardian/totem, roll the damage
   * into the owner's `damageDone` + timeline bucket, and track the subtotal
   * separately in `petDamageDone` for UI display.
   *
   * Two attribution signals, in order of preference:
   *   1. `petOwners` — populated from SPELL_SUMMON when a player casts a
   *      summon spell while logging is active.
   *   2. `eventOwnerGuid` — the advanced-logging `ownerGUID` field on the
   *      damage event itself. This is what rescues pets that existed before
   *      /combatlog started (classic case: Hunter pets, persistent Warlock
   *      pets, pre-pulled Shaman totems). When this signal fires for a
   *      source we've never seen, we backfill `petOwners` so subsequent
   *      events — including those that came *before* the first ownerGUID
   *      observation if they live in bucket arrays — route to the right
   *      owner. (Prior events cannot be retroactively credited in a single
   *      pass; in practice WoW emits ownerGUID on a pet's first damage
   *      event, so the window of missed events is typically zero.)
   */
  private addPetDamage(
    sourceGuid: string,
    amount: number,
    timestamp: Date,
    eventOwnerGuid?: string,
  ): void {
    if (!sourceGuid || sourceGuid.startsWith('Player-')) return;
    let ownerGuid = this.petOwners.get(sourceGuid);
    if (!ownerGuid && eventOwnerGuid && eventOwnerGuid.startsWith('Player-')) {
      this.petOwners.set(sourceGuid, eventOwnerGuid);
      ownerGuid = eventOwnerGuid;
    }
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
    const normalize = (arr: number[]) => {
      while (arr.length < totalBuckets) arr.push(0);
      if (arr.length > totalBuckets) arr.length = totalBuckets;
    };

    for (const p of this.players.values()) {
      normalize(p.damageBuckets);
      normalize(p.healingBuckets);
      normalize(p.absorbProvidedBuckets);
      normalize(p.damageTakenBuckets);
      normalize(p.damageIncomingBuckets);
      normalize(p.selfHealingBuckets);

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
        acc.absorbProvided += p.absorbProvided;
        acc.damageTaken += p.damageTaken;
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
        absorbProvided: 0,
        damageTaken: 0,
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
