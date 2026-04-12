/**
 * Response type interfaces matching the API's exact response shapes.
 * Sourced from apps/api/src/services/stats.ts and apps/api/src/routes/events.ts.
 */

// ─── Leaderboards ──────────────���────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  character: {
    id: number;
    name: string;
    realm: string;
    region: string;
    class: string;
    spec: string;
    claimed: boolean;
  };
  value: number;
  displayValue: string;
  context?: string;
}

export interface LeaderboardResult {
  category: string;
  season: { slug: string; name: string };
  entries: LeaderboardEntry[];
  updatedAt: string;
}

// ─── Character Profile ────────────��─────────────────────────────────

export interface ProfileBestRun {
  dungeonSlug: string;
  dungeonName: string;
  dungeonShortCode: string;
  level: number;
  completionMs: number;
  parMs: number;
  onTime: boolean;
  upgrades: number;
  points: number;
  recordedAt: string;
}

export interface ProfileRecentRun {
  id: number;
  dungeonSlug: string;
  dungeonName: string;
  level: number;
  onTime: boolean;
  upgrades: number;
  deaths: number;
  points: number;
  recordedAt: string;
}

export interface CharacterProfile {
  character: {
    id: number;
    name: string;
    realm: string;
    region: string;
    class: string;
    spec: string;
    role: string;
    rioScore: number;
    claimed: boolean;
  };
  stats: {
    totalRuns: number;
    timedRuns: number;
    depletedRuns: number;
    totalDeaths: number;
    highestKeyCompleted: number;
    totalPoints: number;
    weeklyPoints: number;
    bestRunPerDungeon: ProfileBestRun[];
    recentRuns: ProfileRecentRun[];
  };
  season: {
    slug: string;
    name: string;
  };
}

// ─── Events ─────────────────────────────────────────────────────────

export type EventStatus =
  | "open"
  | "signups_closed"
  | "in_progress"
  | "completed"
  | "draft"
  | "cancelled";

export type EventType =
  | "fastest_clear_race"
  | "speed_sprint"
  | "random_draft";

export interface EventDungeon {
  id: number;
  challengeModeId: number;
  slug: string;
  name: string;
  parTimeSec: number;
  shortCode: string;
}

export interface EventSummary {
  id: number;
  name: string;
  type: EventType;
  status: EventStatus;
  dungeonId: number | null;
  dungeon: EventDungeon | null;
  seasonId: number;
  minKeyLevel: number;
  maxKeyLevel: number;
  signupOpensAt: string | null;
  signupClosesAt: string | null;
  startsAt: string;
  endsAt: string;
  createdByUserId: number;
  description: string | null;
  _count: {
    signups: number;
    teams: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface EventSignup {
  id: number;
  eventId: number;
  userId: number | null;
  discordUserId: string | null;
  characterId: number;
  rolePreference: "tank" | "healer" | "dps";
  spec: string | null;
  signupSource: string;
  signupStatus: string;
  teamId: number | null;
  signedUpAt: string;
  character: {
    id: number;
    name: string;
    realm: string;
    region: string;
    class: string;
    spec: string;
    role: string;
    rioScore: number;
    hasCompanionApp: boolean;
  };
  team: EventTeam | null;
}

export interface EventTeam {
  id: number;
  eventId: number;
  name: string;
  status: string;
  assignedAt: string;
  members?: EventSignup[];
}

export interface EventDetail {
  id: number;
  name: string;
  type: EventType;
  status: EventStatus;
  dungeonId: number | null;
  dungeon: EventDungeon | null;
  season: { slug: string; name: string };
  minKeyLevel: number;
  maxKeyLevel: number;
  signupOpensAt: string | null;
  signupClosesAt: string | null;
  startsAt: string;
  endsAt: string;
  createdByUserId: number;
  description: string | null;
  signups: EventSignup[];
  teams: EventTeam[];
  createdAt: string;
  updatedAt: string;
}

// ─── Download ────────────────────────────────────────────��──────────

export interface ReleaseInfo {
  version: string;
  url: string;
  size: number;
  publishedAt: string;
  fileName: string;
}
