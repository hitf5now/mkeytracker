/**
 * Shared types for run submission, storage, and display.
 *
 * The addon builds a `RunSubmission` object from the post-dungeon
 * `CHALLENGE_MODE_COMPLETED` event, writes it into `MKeyTrackerDB.pendingRuns[]`,
 * and the companion app POSTs it to the API.
 */

import type { WowClass, WowRole } from "./users.js";

export type RunSource = "addon" | "manual" | "raiderio";

export interface RunMemberPayload {
  /** WoW character name */
  name: string;
  /** Normalized realm slug (e.g. "area-52") */
  realm: string;
  class: WowClass;
  /** Spec name as reported by client, e.g. "Blood" */
  spec: string;
  role: WowRole;
}

/**
 * The exact shape the companion app POSTs to `POST /api/v1/runs`.
 * Validated server-side with JSON schema.
 */
export interface RunSubmission {
  /** WoW challenge mode map id (e.g. 378 = Halls of Atonement) */
  challengeModeId: number;
  keystoneLevel: number;
  /** Completion time in ms, from GetCompletionInfo() */
  completionMs: number;
  /** True if the run beat par time */
  onTime: boolean;
  /** 0, 1, 2, or 3 — keystone upgrade levels */
  upgrades: 0 | 1 | 2 | 3;
  /** Total party deaths */
  deaths: number;
  /** Seconds added to run time by deaths (5 sec per death) */
  timeLostSec: number;
  /** Server time as unix seconds at run completion */
  serverTime: number;
  /** Active affix ids from C_MythicPlus.GetCurrentAffixes() */
  affixes: number[];
  /** Region shared by all party members (cross-region parties are impossible) */
  region: "us" | "eu" | "kr" | "tw" | "cn";
  members: RunMemberPayload[];
  /** Optional: event id this run belongs to, if addon was aware of an active event */
  eventId?: number;
  /** Source of the submission — always "addon" for the normal flow */
  source: RunSource;
  /**
   * Optional combat-log enrichment from the companion's WoWCombatLog.txt parser.
   * When present, the API will create RunEnrichment + children rows linked to
   * this run. When absent, the run is still recorded normally.
   *
   * The companion always ATTEMPTS to produce enrichment when running; it only
   * omits this field when the log file is missing, unreadable, or contains no
   * matching segment. See packages/combat-log-parser for the source format.
   */
  enrichment?: RunEnrichmentSubmission;
}

// ────────────────────────────────────────────────────────────────────────────
// Combat-log enrichment (Sprint 15)
// ────────────────────────────────────────────────────────────────────────────

export type EnrichmentStatus = "complete" | "partial" | "unavailable";

export interface EnrichmentPlayerStats {
  /** WoW GUID, e.g. "Player-1175-0F92E4A5" */
  playerGuid: string;
  /** Combined name-realm-region as it appeared in the log */
  playerName: string;
  /** Auto-detected from COMBATANT_INFO; null if not found */
  specId: number | null;
  damageDone: number;
  damageDoneSupport: number;
  healingDone: number;
  healingDoneSupport: number;
  interrupts: number;
  dispels: number;
  deaths: number;
  /**
   * Per-bucket damage from CHALLENGE_MODE_START. Bucket width is stored on
   * the parent submission (bucketSizeMs). Omitted on "unavailable" rows.
   */
  damageBuckets?: number[];
  /** Index into damageBuckets of the highest-damage bucket. */
  peakBucketIndex?: number;
  /** Damage in the peak bucket. Peak DPS = peakDamage / (bucketSizeMs / 1000). */
  peakDamage?: number;
  /**
   * Full COMBATANT_INFO payload (gear, talents, stats, auras) captured as an
   * opaque JSON value. Stored so Phase D/E work can decode extra fields
   * without a re-migration. Null if no COMBATANT_INFO was observed for this
   * player (rare — fires on every encounter start).
   */
  combatantInfoRaw?: unknown;
}

export interface EnrichmentEncounter {
  /** WoW DungeonEncounterID */
  encounterId: number;
  encounterName: string;
  /** true = kill, false = wipe */
  success: boolean;
  fightTimeMs: number;
  /** 8 for M+; higher for other content (diagnostic only) */
  difficultyId: number;
  groupSize: number;
  /** Unix ms of ENCOUNTER_START */
  startedAt: number;
  /** 0-indexed order in the segment — distinguishes wipe + kill of same boss */
  sequenceIndex: number;
}

export interface RunEnrichmentSubmission {
  status: EnrichmentStatus;
  /** When status !== "complete", short machine-readable reason */
  statusReason?: string;
  /** Version string of @mplus/combat-log-parser that produced this */
  parserVersion: string;

  /** Aggregate totals across the M+ segment */
  totalDamage: number;
  totalDamageSupport: number;
  totalHealing: number;
  totalHealingSupport: number;
  totalInterrupts: number;
  totalDispels: number;
  partyDeaths: number;

  /** Raw trailing fields from CHALLENGE_MODE_END, captured verbatim */
  endTrailingFields: number[];

  /** Event-type histogram within the segment (diagnostic) */
  eventCountsRaw?: Record<string, number>;

  /**
   * Width of each entry in the per-player damageBuckets arrays, in ms.
   * Optional for backward compat with pre-timeline submissions.
   */
  bucketSizeMs?: number;
  /**
   * CHALLENGE_MODE_START timestamp as unix ms. The client aligns
   * boss-kill markers against this reference point.
   */
  segmentStartedAt?: number;

  players: EnrichmentPlayerStats[];
  encounters: EnrichmentEncounter[];
}

/**
 * Server-side view of a persisted run (with scoring applied).
 */
export interface RunRecord extends RunSubmission {
  id: number;
  parMs: number;
  recordedAt: string;
  verified: boolean;
  groupId: number | null;
  personalJuice: number;
}
