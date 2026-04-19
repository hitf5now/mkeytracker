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
  /** Short one-liner shown on hover tooltip + modal subtitle. */
  flavor: string;
  /** Long, story-style description for the modal. 2–3 sentences, WoW-role-themed. */
  description: string;
  /** Emoji or short glyph that represents the achievement visually. */
  icon: string;
  severity: AchievementSeverity;
  scope: AchievementScope;
}

/** Rule output — the achievement plus the dynamic "why you got this" string. */
export interface AwardedAchievement {
  def: AchievementDef;
  reason: string;
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
  maxDispels: number;
  topDamagePlayerId: number | null;
}

export interface RuleContext {
  run: RunDetail;
  player: RunDetailEnrichmentPlayer;
  member: RunDetailMember | null;
  role: PlayerRole;
  damageDone: number;
  healingDone: number;
  averageDps: number;
  party: PartyStats;
}

export interface Rule {
  def: AchievementDef;
  /** Role / capability gate — may this player/run be considered at all? */
  eligible: (ctx: RuleContext) => boolean;
  /** Does this player trigger the achievement? */
  matches: (ctx: RuleContext) => boolean;
  /** Produce the runtime "why you got this" string. Called only when matched. */
  describe: (ctx: RuleContext) => string;
}

export interface PartyRuleContext {
  run: RunDetail;
  players: RunDetailEnrichmentPlayer[];
  party: PartyStats;
}

export interface PartyRule {
  def: AchievementDef;
  matches: (ctx: PartyRuleContext) => boolean;
  describe: (ctx: PartyRuleContext) => string;
}

export interface EvaluationResult {
  /** Per-enrichment-player achievements, keyed by enrichment player id. */
  byPlayerId: Map<number, AwardedAchievement[]>;
  /** Party-wide achievements (applied at the run level). */
  party: AwardedAchievement[];
}
