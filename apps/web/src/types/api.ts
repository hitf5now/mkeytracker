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
  /** Extra aggregates on the season-juice board; undefined elsewhere. */
  personalJuice?: number;
  teamJuice?: number;
  eventJuice?: number;
  runCount?: number;
  endorsementsReceived?: number;
}

export interface LeaderboardResult {
  category: string;
  season: { slug: string; name: string };
  entries: LeaderboardEntry[];
  updatedAt: string;
}

// ─── Character Profile ────────────��─────────────────────────────────

export interface ProfileBestRun {
  id: number;
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
  endorsements: EndorsementSummary | null;
  claimedByDiscordId: string | null;
}

export interface EndorsementListItem {
  id: number;
  runId: number;
  category: EndorsementCategory;
  note: string | null;
  createdAt: string;
  giverDiscordId: string;
  giverUserId: number;
}

export interface SentEndorsementListItem {
  id: number;
  runId: number;
  category: EndorsementCategory;
  note: string | null;
  createdAt: string;
  receiverUserId: number;
  receiverDiscordId: string;
  receiverCharacterId: number | null;
  receiverCharacterName: string | null;
}

export interface EndorsementSummary {
  totalReceived: number;
  seasonReceived: number;
  categoryBreakdown: Array<{ category: EndorsementCategory; count: number }>;
  recent: EndorsementListItem[];
  favorite: EndorsementListItem | null;
  totalSent: number;
  seasonSent: number;
  sentRecent: SentEndorsementListItem[];
}

// ─── Events ─────────────────────────────────────────────────────────

export type EventStatus =
  | "draft"
  | "open"
  | "in_progress"
  | "completed"
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

export type FlexRole = "tank" | "healer" | "dps" | "none";
export type SlotPosition = "tank" | "healer" | "dps1" | "dps2" | "dps3";
export type EventGroupState = "forming" | "matched" | "disbanded" | "timed_out";

export interface EventSignup {
  id: number;
  eventId: number;
  userId: number | null;
  discordUserId: string | null;
  characterId: number;
  rolePreference: "tank" | "healer" | "dps";
  flexRole: FlexRole;
  priorityFlag: boolean;
  spec: string | null;
  signupSource: string;
  signupStatus: string;
  groupId: number | null;
  slotPosition: SlotPosition | null;
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

export interface EventGroupRun {
  id: number;
  completionMs: number;
  onTime: boolean;
  upgrades: number;
  keystoneLevel: number;
  dungeon: { name: string; shortCode: string } | null;
}

export interface EventGroup {
  id: number;
  eventId: number;
  name: string;
  state: EventGroupState;
  readyCheckId: number | null;
  assignedAt: string;
  resolvedAt: string | null;
  members?: EventSignup[];
  runs?: EventGroupRun[];
}

export interface ReadyCheckParticipantView {
  signupId: number;
  joinedAt: string;
  characterName: string;
  realm: string;
  primaryRole: "tank" | "healer" | "dps";
  flexRole: FlexRole;
  priorityFlag: boolean;
}

export interface ActiveReadyCheck {
  id: number;
  startedAt: string;
  expiresAt: string;
  state: "active" | "expired";
  participants: ReadyCheckParticipantView[];
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
  /** Highest keystone level finished at all (timed OR depleted). */
  highestKeyCompleted: number;
  /** Highest keystone level beat within timer. */
  highestKeyTimed: number;
  totalJuice: number;
  totalEventJuice: number;
  totalTeamJuice: number;
  weeklyJuice: number;
  timedRate: number;
}

export interface BestRunRef {
  level: number;
  dungeonName: string;
  dungeonShortCode: string;
  characterName: string;
  characterClass: string;
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
  role: "tank" | "healer" | "dps";
  totalRuns: number;
  timedRuns: number;
  totalJuice: number;
  bestKeyCompleted: BestRunRef | null;
  bestKeyTimed: BestRunRef | null;
}

export interface DashboardDungeonBreakdown {
  dungeonSlug: string;
  dungeonName: string;
  dungeonShortCode: string;
  bestKeyCompleted: { level: number; characterName: string; characterClass: string } | null;
  bestKeyTimed: { level: number; characterName: string; characterClass: string } | null;
  fastestClearMs: number | null;
  totalJuice: number;
  timedCount: number;
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
  endorsements: EndorsementSummary;
  tokenBalance: TokenBalance;
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
    avatarUrl: string | null;
    insetUrl: string | null;
    mainRawUrl: string | null;
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
  /** Portion of damageDone attributable to this player's pets/guardians/totems. */
  petDamageDone: string;
  /** Effective healing (Details-style): BigInt string. EXCLUDES shield absorbs. */
  healingDone: string;
  healingDoneSupport: string;
  /** Portion of healingDone from this player's pets/guardians. */
  petHealingDone: string;
  /** Raw overheal total serialized as string (BigInt). */
  overhealing: string;
  /** Shield absorbs cast by this player (BigInt string). */
  absorbProvided: string;
  /** Actual damage received (BigInt string). */
  damageTaken: string;
  /** Damage directed at this player (post-armor, pre-shield/block/resist). */
  damageIncoming: string;
  /** Self-healing total (source = dest). */
  selfHealing: string;
  /** Avoidance counts — log has no amount data for these. */
  parries: number;
  dodges: number;
  misses: number;
  interrupts: number;
  dispels: number;
  deaths: number;
  /** Per-bucket damage from segment start. Null on legacy rows. */
  damageBuckets: number[] | null;
  peakBucketIndex: number | null;
  /** BigInt serialized as string — damage in peak bucket. */
  peakDamage: string | null;
  /** Raw healing output per bucket (for Healing tab chart). */
  healingBuckets: number[] | null;
  /** Shield-absorb output per bucket. */
  absorbProvidedBuckets: number[] | null;
  /** Damage received per bucket (Tank chart line 2). */
  damageTakenBuckets: number[] | null;
  /** Damage directed per bucket (Tank chart line 1). */
  damageIncomingBuckets: number[] | null;
  /** Self-heals per bucket (Tank chart line 3). */
  selfHealingBuckets: number[] | null;
  /** Cast events for future CD overlays. */
  castEvents: Array<{ spellId: number; offsetMs: number }> | null;
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
  totalPetDamage: string;
  /** Effective healing, EXCLUDING shield absorbs. */
  totalHealing: string;
  totalHealingSupport: string;
  totalPetHealing: string;
  /** Raw overheal aggregated across all players. */
  totalOverhealing: string;
  /** Shield-absorb output across all players. */
  totalAbsorbProvided: string;
  /** Damage received across all players. */
  totalDamageTaken: string;
  totalInterrupts: number;
  totalDispels: number;
  partyDeaths: number;
  endTrailingFields: number[];
  eventCountsRaw: Record<string, number> | null;
  /** Width of each damageBuckets entry, in ms. Null on legacy rows. */
  bucketSizeMs: number | null;
  /** CHALLENGE_MODE_START as ISO string — reference for boss-kill markers. */
  segmentStartedAt: string | null;
  createdAt: string;
  players: RunDetailEnrichmentPlayer[];
  encounters: RunDetailEnrichmentEncounter[];
}

export interface RunJuiceBreakdown {
  base: number;
  timeModifier: number;
  afterModifier: number;
  bonuses: {
    noDeaths: number;
    personalDungeonRecord: number;
    personalOverallRecord: number;
    eventParticipation: number;
  };
  total: number;
}

export type EndorsementCategory =
  | "great_tank"
  | "great_healer"
  | "great_dps"
  | "interrupt_master"
  | "dispel_wizard"
  | "cc_master"
  | "cooldown_hero"
  | "affix_slayer"
  | "route_master"
  | "patient_teacher"
  | "calm_under_pressure"
  | "positive_vibes"
  | "shot_caller"
  | "clutch_saviour"
  | "comeback_kid";

export interface RunDetailEndorsement {
  id: number;
  giverId: number;
  receiverId: number;
  category: EndorsementCategory;
  note: string | null;
  createdAt: string;
  giverDiscordId: string;
  receiverDiscordId: string;
}

export interface TokenBalance {
  seasonalTokensRemaining: number;
  starterTokensRemaining: number;
  total: number;
  lifetimeJuiceEarned: number;
  juiceConsumedByTokens: number;
  juiceTowardNextToken: number;
  juiceToNextToken: number;
  juicePerToken: number;
}

// ─── User runs (paginated list for dashboard Runs tab) ──────────────

export type UserRunsRange = "7d" | "30d" | "season" | "all";

export interface UserRunsListItem {
  id: number;
  dungeonId: number;
  dungeonName: string;
  dungeonSlug: string;
  dungeonShortCode: string;
  keystoneLevel: number;
  completionMs: number;
  onTime: boolean;
  upgrades: number;
  deaths: number;
  juice: number;
  recordedAt: string;
  characterId: number;
  characterName: string;
  characterClass: string;
  roleSnapshot: string;
}

export interface UserRunsFilterOption<T> {
  id: T;
  label: string;
}

export interface UserRunsResult {
  runs: UserRunsListItem[];
  total: number;
  limit: number;
  offset: number;
  season: { slug: string; name: string };
  filterCharacters: UserRunsFilterOption<number>[];
  filterDungeons: UserRunsFilterOption<number>[];
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
  juiceBreakdown: RunJuiceBreakdown;
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
  endorsements: RunDetailEndorsement[];
}
