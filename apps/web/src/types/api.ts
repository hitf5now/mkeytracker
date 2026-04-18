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
  juice: number;
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
  juice: number;
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
    thumbnailUrl: string | null;
    avatarUrl: string | null;
    insetUrl: string | null;
    mainRawUrl: string | null;
  };
  stats: {
    totalRuns: number;
    timedRuns: number;
    depletedRuns: number;
    totalDeaths: number;
    highestKeyCompleted: number;
    totalJuice: number;
    weeklyJuice: number;
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
  | "random_draft"
  | "key_climbing"
  | "marathon"
  | "best_average"
  | "bracket_tournament";

export interface EventTypeConfig {
  slug: string;
  label: string;
  description: string;
  rules: string[];
  winCondition: string;
  scoringDescription: string;
  juiceTable: Array<{ label: string; juice: string }>;
  supportedModes: ("group" | "team")[];
  configFields?: Array<{ key: string; label: string; type: "number"; default: number; min: number; max: number }>;
}

export type EventMode = "group" | "team";

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
  mode: EventMode;
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
    groups: number;
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
  groupId: number | null;
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
  group: EventGroup | null;
}

export interface EventGroup {
  id: number;
  eventId: number;
  name: string;
  status: string;
  assignedAt: string;
  members?: EventSignup[];
}

export interface TeamEventSignup {
  id: number;
  eventId: number;
  teamId: number;
  status: string;
  signedUpAt: string;
  team: TeamSummary;
}

export interface EventDetail {
  id: number;
  name: string;
  type: EventType;
  mode: EventMode;
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
  groups: EventGroup[];
  teamSignups: TeamEventSignup[];
  createdAt: string;
  updatedAt: string;
}

// ─── Teams ─────────────────────────────────────────────────────────

export interface TeamMember {
  id: number;
  characterId: number;
  role: "tank" | "healer" | "dps";
  joinedAt: string;
  character: {
    id: number;
    name: string;
    realm: string;
    region: string;
    class: string;
    spec: string;
    rioScore: number;
    hasCompanionApp: boolean;
  };
}

export interface TeamSummary {
  id: number;
  name: string;
  active: boolean;
  seasonId: number;
  captainUserId: number;
  captain: { id: number; discordId: string };
  season: { slug: string; name: string };
  members: TeamMember[];
  createdAt: string;
}

export interface TeamDetail extends TeamSummary {}

// ─── Event Results / Leaderboard ───────────────────────────────────

export interface EventRunDetail {
  runId: number;
  keystoneLevel: number;
  onTime: boolean;
  upgrades: number;
  completionMs: number;
  deaths: number;
  dungeonId: number;
  dungeonName: string | null;
  dungeonShortCode: string | null;
  matchedAt: string;
  runScore: number;
  counted: boolean;
}

export interface EventStandingMeta {
  peakKeystone?: number;
  peakTimed?: boolean;
  peakDeaths?: number;
  peakCompletionMs?: number;
  topNAverage?: number;
  topNAllTimed?: boolean;
  topNRunCount?: number;
  lowestCountedScore?: number;
}

export interface EventGapToFirst {
  scoreGap: number;
  hint: string;
}

export interface EventGroupStanding {
  rank: number;
  groupId: number;
  groupName: string;
  score: number;
  displayScore: string;
  runCount: number;
  members: { characterName: string; realm: string; classSlug: string }[];
  runs?: EventRunDetail[];
  meta?: EventStandingMeta;
  gapToFirst?: EventGapToFirst;
}

export interface EventResults {
  eventId: number;
  eventType: string;
  standings: EventGroupStanding[];
  totalRuns: number;
  totalParticipants: number;
}

// ─── Download ────────────────────────────────────────────��──────────

export interface ReleaseInfo {
  version: string;
  url: string;
  size: number;
  publishedAt: string;
  fileName: string;
}

// ─── Dashboard ──────────────────────────────────────────────────

export interface DashboardOverview {
  totalRuns: number;
  timedRuns: number;
  depletedRuns: number;
  totalDeaths: number;
  highestKeyCompleted: number;
  totalJuice: number;
  weeklyJuice: number;
  timedRate: number;
}

export interface DashboardCharacter {
  id: number;
  name: string;
  realm: string;
  region: string;
  class: string;
  spec: string;
  role: string;
  rioScore: number;
  hasCompanionApp: boolean;
  totalRuns: number;
  timedRuns: number;
  highestKey: number;
  totalJuice: number;
}

export interface DashboardRoleBreakdown {
  role: string;
  totalRuns: number;
  timedRuns: number;
  bestKey: number;
  totalJuice: number;
}

export interface DashboardDungeonBreakdown {
  dungeonSlug: string;
  dungeonName: string;
  dungeonShortCode: string;
  bestKeyLevel: number;
  fastestClearMs: number | null;
  totalJuice: number;
  timedCount: number;
  bestCharacterName: string;
  bestCharacterClass: string;
}

export interface DashboardRecentRun {
  id: number;
  dungeonName: string;
  dungeonSlug: string;
  level: number;
  onTime: boolean;
  upgrades: number;
  deaths: number;
  juice: number;
  recordedAt: string;
  characterName: string;
  characterClass: string;
  roleSnapshot: string;
}

export interface DashboardChartData {
  runsPerWeek: { week: string; count: number }[];
  keyProgression: { date: string; level: number; characterName: string; characterClass: string }[];
}

export interface DashboardResult {
  overview: DashboardOverview;
  characters: DashboardCharacter[];
  roleBreakdown: DashboardRoleBreakdown[];
  dungeonBreakdown: DashboardDungeonBreakdown[];
  recentRuns: DashboardRecentRun[];
  chartData: DashboardChartData;
  season: { slug: string; name: string };
}

// ─── Run detail (Sprint 15) ────────────────────────────────────────────────

export interface RunDetailMember {
  id: number;
  characterId: number;
  userId: number | null;
  classSnapshot: string;
  specSnapshot: string;
  roleSnapshot: string;
  character: {
    id: number;
    name: string;
    realm: string;
    region: string;
    class: string;
    thumbnailUrl: string | null;
  } | null;
}

export interface RunDetailEnrichmentPlayer {
  id: number;
  playerGuid: string;
  playerName: string;
  specId: number | null;
  characterId: number | null;
  /** BigInt serialized as string — parse with Number() for display */
  damageDone: string;
  damageDoneSupport: string;
  healingDone: string;
  healingDoneSupport: string;
  interrupts: number;
  dispels: number;
  deaths: number;
  combatantInfoRaw: unknown;
}

export interface RunDetailEnrichmentEncounter {
  id: number;
  encounterId: number;
  encounterName: string;
  success: boolean;
  fightTimeMs: number;
  difficultyId: number;
  groupSize: number;
  startedAt: string;
  sequenceIndex: number;
}

export interface RunDetailEnrichment {
  id: number;
  status: "complete" | "partial" | "unavailable";
  statusReason: string | null;
  parserVersion: string;
  totalDamage: string;
  totalDamageSupport: string;
  totalHealing: string;
  totalHealingSupport: string;
  totalInterrupts: number;
  totalDispels: number;
  partyDeaths: number;
  endTrailingFields: number[];
  eventCountsRaw: Record<string, number> | null;
  createdAt: string;
  players: RunDetailEnrichmentPlayer[];
  encounters: RunDetailEnrichmentEncounter[];
}

export interface RunDetail {
  id: number;
  keystoneLevel: number;
  completionMs: number;
  parMs: number;
  onTime: boolean;
  upgrades: number;
  deaths: number;
  timeLostSec: number;
  affixes: number[];
  serverTime: string;
  recordedAt: string;
  source: string;
  verified: boolean;
  personalJuice: number;
  eventJuice: number | null;
  teamJuice: number | null;
  dungeonName: string | null;
  oldRating: number | null;
  newRating: number | null;
  ratingGained: number | null;
  isMapRecord: boolean;
  isAffixRecord: boolean;
  dungeon: {
    id: number;
    name: string;
    slug: string;
    shortCode: string;
    parTimeSec: number;
    challengeModeId: number;
  };
  season: { id: number; name: string; slug: string };
  members: RunDetailMember[];
  enrichment: RunDetailEnrichment | null;
}
