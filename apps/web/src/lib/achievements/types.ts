import type {
  RunDetail,
  RunDetailEnrichmentPlayer,
  RunDetailMember,
} from "@/types/api";

export type AchievementSeverity = "negative" | "positive" | "neutral";

export type AchievementScope = "any" | "tank" | "healer" | "dps" | "party";

export interface AchievementDef {
  id: string;
  name: string;
  flavor: string;
  severity: AchievementSeverity;
  scope: AchievementScope;
}

export type PlayerRole = "tank" | "healer" | "dps" | "unknown";

export interface PartyStats {
  runDurationSec: number;
  totalDamage: number;
  totalHealing: number;
  totalInterrupts: number;
  totalDispels: number;
  partyDeaths: number;
  maxDeaths: number;
  everyoneDied: boolean;
  tank: { playerId: number; damage: number } | null;
  healer: { playerId: number; damage: number; healing: number } | null;
  dps: Array<{ playerId: number; damage: number }>;
  maxInterrupts: number;
  topDamagePlayerId: number | null;
}

export interface RuleContext {
  run: RunDetail;
  player: RunDetailEnrichmentPlayer;
  member: RunDetailMember | null;
  role: PlayerRole;
  damageDone: number;
  healingDone: number;
  party: PartyStats;
}

export interface Rule {
  def: AchievementDef;
  /** Role/capability gate — may this player/run be considered at all? */
  eligible: (ctx: RuleContext) => boolean;
  /** Does this player trigger the achievement? */
  matches: (ctx: RuleContext) => boolean;
}

export interface PartyRuleContext {
  run: RunDetail;
  players: RunDetailEnrichmentPlayer[];
  party: PartyStats;
}

export interface PartyRule {
  def: AchievementDef;
  matches: (ctx: PartyRuleContext) => boolean;
}

export interface EvaluationResult {
  /** Per-enrichment-player achievements, keyed by enrichment player id. */
  byPlayerId: Map<number, AchievementDef[]>;
  /** Party-wide achievements (applied at the run level). */
  party: AchievementDef[];
}
