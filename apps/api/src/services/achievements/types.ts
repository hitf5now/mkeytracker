/**
 * Achievement engine types — API-side.
 *
 * The frontend version under apps/web/src/lib/achievements/ is being phased
 * out; evaluation now happens at run-completion in the API and persisted
 * results are read by the web. These types describe the in-memory shape the
 * archetype trigger functions operate on.
 */

import type { AchievementSeverity } from "@prisma/client";

export type PlayerRole = "tank" | "healer" | "dps" | "unknown";

/**
 * In-memory snapshot of one enrichment player's stats. Mirrors the columns
 * we actually read from RunEnrichmentPlayer; BigInts are coerced to Number
 * because the rule arithmetic doesn't need 64-bit precision.
 */
export interface PlayerStats {
  /** RunEnrichmentPlayer.id — used to key per-player results. */
  id: number;
  characterId: number | null;
  playerName: string;
  damageDone: number;
  healingDone: number;
  overhealing: number;
  interrupts: number;
  dispels: number;
  deaths: number;
  /** Peak damage in a single bucket (5s window). null on legacy enrichment rows. */
  peakDamage: number | null;
  /** Damage timeline buckets. null on legacy rows. */
  damageBuckets: number[] | null;
}

/**
 * Aggregated party-level stats computed once per run. All player rules can
 * read this without recomputing.
 */
export interface PartyStats {
  runDurationSec: number;
  totalDamage: number;
  totalHealing: number;
  totalInterrupts: number;
  totalDispels: number;
  partyDeaths: number;
  maxDeaths: number;
  maxInterrupts: number;
  maxDispels: number;
  everyoneDied: boolean;
  topDamagePlayerId: number | null;
  tank: { playerId: number; damage: number } | null;
  healer: { playerId: number; damage: number; healing: number } | null;
  dps: Array<{ playerId: number; damage: number }>;
}

/**
 * Run-level snapshot. Surface only what archetypes actually inspect — keep
 * it small so it's easy to remember what's in scope.
 */
export interface RunStats {
  id: number;
  keystoneLevel: number;
  completionMs: number;
  parMs: number;
  onTime: boolean;
  upgrades: number;
  deaths: number;
  timeLostSec: number;
  isMapRecord: boolean;
  isAffixRecord: boolean;
  dungeonSlug: string;
}

/** Context handed to a per-player archetype trigger. */
export interface PlayerRuleContext {
  run: RunStats;
  player: PlayerStats;
  /** All party members, keyed for cross-player rules (Concentrate etc.). */
  allPlayers: PlayerStats[];
  role: PlayerRole;
  /** Same as player.damageDone — convenience. */
  damageDone: number;
  /** Same as player.healingDone — convenience. */
  healingDone: number;
  /** player.damageDone / runDurationSec, rounded to int. */
  averageDps: number;
  party: PartyStats;
  /** Class slug ("warrior", null if member match failed). */
  characterClass: string | null;
}

/** Context handed to a party-scope archetype trigger. */
export interface PartyRuleContext {
  run: RunStats;
  players: PlayerStats[];
  party: PartyStats;
}

/**
 * An archetype's matcher returns either:
 *   - false (didn't trigger), or
 *   - { reason: string } (triggered, with the reason sentence)
 */
export type MatchResult = false | { reason: string };

export interface PlayerArchetype {
  key: string;
  category: "performance" | "shape" | "milestone" | "identity" | "comedic";
  /** null = any role; else the role this archetype is gated to. */
  roleGate: PlayerRole | null;
  /** Engineer-facing description (mirrored to the DB row). */
  description: string;
  match: (ctx: PlayerRuleContext) => MatchResult;
}

export interface PartyArchetype {
  key: string;
  category: "performance" | "shape" | "milestone" | "identity" | "comedic" | "party";
  description: string;
  match: (ctx: PartyRuleContext) => MatchResult;
}

/**
 * One archetype that fired during evaluation, before flavor selection.
 * Carries the archetype key + the reason sentence.
 */
export interface TriggeredArchetype {
  archetypeKey: string;
  reason: string;
}

/**
 * Final selection: one chosen flavor per archetype, ranked, capped, and
 * ready to write to run_achievements.
 */
export interface SelectedAchievement {
  archetypeKey: string;
  flavorKey: string;
  rarity: string;
  severity: AchievementSeverity;
  reason: string;
  /** Score used to rank within the per-player or party cap. */
  score: number;
}

/**
 * Per-player and party-scope rule arrays exported by ./archetypes.
 */
export interface ArchetypeRegistry {
  player: PlayerArchetype[];
  party: PartyArchetype[];
}
