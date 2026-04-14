/**
 * Inbound data channel — the companion app writes this structure into the
 * SavedVariables .lua file every ~2 minutes. The addon reads it on next /reload.
 *
 * See MPLUS_PLATFORM.md "Companion App — Inbound Data Schema".
 */

export interface LeaderboardEntry {
  category: string;
  rank: number;
  name: string;
  score: number;
  realm: string | null;
}

export interface MyRankEntry {
  category: string;
  rank: number;
  score: number;
  /** Total entries in the leaderboard for this category */
  total: number;
}

export interface RivalGroup {
  groupId: number;
  groupName: string;
  bestCompletionMs: number;
  bestKeystoneLevel: number;
}

export interface ActiveCompetition {
  eventId: number;
  groupName: string;
  rivals: RivalGroup[];
  /** Unix timestamp (seconds) */
  eventWindowEnds: number;
}

export interface InboundData {
  leaderboard: LeaderboardEntry[];
  myRankings: MyRankEntry[];
  activeCompetition: ActiveCompetition | null;
  messages: string[];
  /** Unix timestamp (seconds) of last server sync */
  updatedAt: number;
}
