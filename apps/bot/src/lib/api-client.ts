/**
 * Typed client for the M+ API, using the shared internal bearer token.
 *
 * Only used by bot→API server-side calls. Never exposed to users.
 */

import { env } from "../config/env.js";

export interface RegisterRequest {
  discordId: string;
  character: string;
  realm: string;
  region: "us" | "eu" | "kr" | "tw" | "cn";
}

export interface RegisterResponseCharacter {
  id: number;
  name: string;
  realm: string;
  region: string;
  class: string;
  spec: string;
  role: string;
  rioScore: number;
  profileUrl: string;
}

export interface RegisterResponse {
  user: { id: number; discordId: string };
  character: RegisterResponseCharacter;
}

export interface LinkCodeRequest {
  discordId: string;
}

export interface LinkCodeResponse {
  code: string;
  expiresInSeconds: number;
}

// ── Profile ──────────────────────────────────────────────────────────
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

export interface CharacterProfileResponse {
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
    totalJuice: number;
    weeklyJuice: number;
    bestRunPerDungeon: ProfileBestRun[];
    recentRuns: ProfileRecentRun[];
  };
  season: { slug: string; name: string };
}

// ── Leaderboards ─────────────────────────────────────────────────────
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

export interface LeaderboardResponse {
  category: string;
  season: { slug: string; name: string };
  entries: LeaderboardEntry[];
  updatedAt: string;
}

// ── Events ────────────────────────────────────────────────────────
export interface EventResponse {
  id: number;
  name: string;
  type: string;
  mode: "group" | "team";
  status: string;
  dungeonId: number | null;
  minKeyLevel: number;
  maxKeyLevel: number;
  startsAt: string;
  endsAt: string;
  description: string | null;
}

export interface EventListItem extends EventResponse {
  dungeon: { name: string; slug: string } | null;
  _count: { signups: number; groups: number };
}

export interface EventSignupDetail {
  id: number;
  rolePreference: string;
  flexRole: "tank" | "healer" | "dps" | "none";
  priorityFlag: boolean;
  spec: string | null;
  signupStatus: string;
  discordUserId: string | null;
  slotPosition: "tank" | "healer" | "dps1" | "dps2" | "dps3" | null;
  character: { name: string; realm: string; region: string; class: string; hasCompanionApp: boolean };
  group: { id: number; name: string } | null;
}

export interface EventGroupDetail {
  id: number;
  state: "forming" | "matched" | "disbanded" | "timed_out";
  readyCheckId: number | null;
  assignedAt: string;
  resolvedAt: string | null;
  name: string;
  members: EventSignupDetail[];
}

export interface EventDetailResponse extends EventResponse {
  dungeon: { name: string; slug: string } | null;
  season: { slug: string; name: string };
  discordMessageId: string | null;
  discordChannelId: string | null;
  discordGuildId: string | null;
  signups: EventSignupDetail[];
  groups: EventGroupDetail[];
  teamSignups: Array<{
    id: number;
    status: string;
    team: {
      id: number;
      name: string;
      members: Array<{
        role: string;
        character: { name: string; realm: string; class: string; hasCompanionApp: boolean };
      }>;
    };
  }>;
}

export interface AssignGroupsResponse {
  groups: Array<{
    name: string;
    members: Array<{ characterName: string; realm: string; role: string }>;
  }>;
  benched: Array<{ characterName: string; realm: string; role: string }>;
  stats: {
    totalSignups: number;
    groupsFormed: number;
    benchedCount: number;
    limitingRole: string;
  };
}

export interface ApiErrorBody {
  error: string;
  message?: string;
}

// ── User characters (for button signups) ────────────────────────────
export interface UserCharacter {
  id: number;
  name: string;
  realm: string;
  region: string;
  class: string;
  spec: string;
  role: string;
  rioScore: number;
  hasCompanionApp: boolean;
}

export interface UserCharactersResponse {
  user: { id: number; discordId: string } | null;
  characters: UserCharacter[];
}

export interface RaiderIOLookupResponse {
  found: boolean;
  character: {
    name: string;
    realm: string;
    region: string;
    class: string;
    spec: string;
    role: string;
    rioScore: number;
    profileUrl: string;
  } | null;
}

// ── Signup check (for context-aware buttons) ───────────────────────
export interface SignupCheckResponse {
  hasSignup: boolean;
  signup?: {
    id: number;
    signupStatus: string;
    rolePreference: string;
    spec: string | null;
    characterName: string;
    characterRealm: string;
    characterClass: string;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiGet<TResponse>(path: string): Promise<TResponse> {
  const url = `${env.API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(
      errBody?.message ?? `API ${response.status}`,
      response.status,
      errBody?.error ?? "unknown_error",
    );
  }

  return (await response.json()) as TResponse;
}

async function apiPost<TBody, TResponse>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const url = `${env.API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.API_INTERNAL_SECRET}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch {
      // non-JSON response
    }
    throw new ApiError(
      errBody?.message ?? `API ${response.status}`,
      response.status,
      errBody?.error ?? "unknown_error",
    );
  }

  return (await response.json()) as TResponse;
}

async function apiDelete<TResponse>(path: string): Promise<TResponse> {
  const url = `${env.API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.API_INTERNAL_SECRET}`,
    },
  });

  if (!response.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch { /* non-JSON */ }
    throw new ApiError(
      errBody?.message ?? `API ${response.status}`,
      response.status,
      errBody?.error ?? "unknown_error",
    );
  }

  return (await response.json()) as TResponse;
}

async function apiPatch<TBody, TResponse>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const url = `${env.API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.API_INTERNAL_SECRET}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch { /* non-JSON */ }
    throw new ApiError(
      errBody?.message ?? `API ${response.status}`,
      response.status,
      errBody?.error ?? "unknown_error",
    );
  }

  return (await response.json()) as TResponse;
}

/** Internal-auth GET (for endpoints that require bearer token) */
async function apiGetInternal<TResponse>(path: string): Promise<TResponse> {
  const url = `${env.API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.API_INTERNAL_SECRET}`,
    },
  });

  if (!response.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch { /* non-JSON */ }
    throw new ApiError(
      errBody?.message ?? `API ${response.status}`,
      response.status,
      errBody?.error ?? "unknown_error",
    );
  }

  return (await response.json()) as TResponse;
}

export const apiClient = {
  register: (req: RegisterRequest): Promise<RegisterResponse> =>
    apiPost<RegisterRequest, RegisterResponse>("/api/v1/register", req),

  linkCode: (req: LinkCodeRequest): Promise<LinkCodeResponse> =>
    apiPost<LinkCodeRequest, LinkCodeResponse>("/api/v1/auth/link-code", req),

  getCharacterProfile: (
    region: string,
    realm: string,
    name: string,
  ): Promise<CharacterProfileResponse> =>
    apiGet<CharacterProfileResponse>(
      `/api/v1/characters/${encodeURIComponent(region)}/${encodeURIComponent(realm)}/${encodeURIComponent(name)}`,
    ),

  getLeaderboard: (
    category: string,
    limit = 10,
  ): Promise<LeaderboardResponse> =>
    apiGet<LeaderboardResponse>(
      `/api/v1/leaderboards/${encodeURIComponent(category)}?limit=${limit}`,
    ),

  // ── Events ─────────────────────────────────────────────────────
  createEvent: (req: {
    name: string;
    dungeonSlug?: string;
    startsAt: string;
    endsAt: string;
    minKeyLevel?: number;
    maxKeyLevel?: number;
    description?: string;
    createdByDiscordId: string;
    discordGuildId?: string;
  }): Promise<{ event: EventResponse }> =>
    apiPost("/api/v1/events", req),

  listEvents: (): Promise<{ events: EventListItem[] }> =>
    apiGet("/api/v1/events"),

  getEvent: (id: number): Promise<{ event: EventDetailResponse }> =>
    apiGet(`/api/v1/events/${id}`),

  eventSignup: (req: {
    eventId: number;
    discordId: string;
    characterName: string;
    characterRealm: string;
    characterRegion: "us" | "eu" | "kr" | "tw" | "cn";
    rolePreference: "tank" | "healer" | "dps";
    flexRole?: "tank" | "healer" | "dps" | "none";
    signupStatus?: "confirmed" | "tentative";
    spec?: string;
    characterClass?: string;
  }): Promise<{ signup: { id: number }; updated: boolean }> =>
    apiPost(`/api/v1/events/${req.eventId}/signup`, req),

  // ── Ready Check endpoints ─────────────────────────────────────
  readyCheckStartOrJoin: (
    eventId: number,
    discordId: string,
  ): Promise<{
    readyCheckId: number;
    startedNew: boolean;
    expiresAt: string;
    participantCount: number;
  }> =>
    apiPost(`/api/v1/events/${eventId}/ready-check`, { discordId }),

  readyCheckCancel: (
    eventId: number,
    readyCheckId: number,
    discordId: string,
  ): Promise<{ cancelled: boolean }> =>
    apiPost(`/api/v1/events/${eventId}/ready-check/${readyCheckId}/cancel`, { discordId }),

  getActiveReadyCheck: (
    eventId: number,
  ): Promise<{
    active: null | {
      id: number;
      startedAt: string;
      expiresAt: string;
      state: string;
      participants: Array<{
        signupId: number;
        joinedAt: string;
        characterName: string;
        realm: string;
        primaryRole: "tank" | "healer" | "dps";
        flexRole: "tank" | "healer" | "dps" | "none";
        priorityFlag: boolean;
      }>;
    };
  }> =>
    apiGet(`/api/v1/events/${eventId}/ready-check`),

  disbandVote: (
    groupId: number,
    discordId: string,
  ): Promise<{
    groupId: number;
    voteCount: number;
    required: number;
    disbanded: boolean;
  }> =>
    apiPost(`/api/v1/event-groups/${groupId}/disband-vote`, { discordId }),

  repostEvent: (eventId: number): Promise<{ reposted: boolean }> =>
    apiPost(`/api/v1/events/${eventId}/repost`, {}),

  // ── Phase 2: Bot interaction endpoints ─────────────────────────
  getUserCharacters: (discordId: string): Promise<UserCharactersResponse> =>
    apiGetInternal(`/api/v1/users/by-discord/${encodeURIComponent(discordId)}/characters`),

  raiderioLookup: (
    name: string,
    realm: string,
    region = "us",
  ): Promise<RaiderIOLookupResponse> =>
    apiGetInternal(
      `/api/v1/raiderio/lookup?name=${encodeURIComponent(name)}&realm=${encodeURIComponent(realm)}&region=${encodeURIComponent(region)}`,
    ),

  storeDiscordMessage: (
    eventId: number,
    messageId: string,
    channelId: string,
  ): Promise<unknown> =>
    apiPatch(`/api/v1/events/${eventId}/discord-message`, { messageId, channelId }),

  // ── Sprint 9: Signup management endpoints ─────────────────────
  signupCheck: (eventId: number, discordId: string): Promise<SignupCheckResponse> =>
    apiGetInternal(`/api/v1/events/${eventId}/signup-check?discordId=${encodeURIComponent(discordId)}`),

  removeSignup: (eventId: number, discordId: string): Promise<{ removed: boolean }> =>
    apiDelete(`/api/v1/events/${eventId}/signup?discordId=${encodeURIComponent(discordId)}`),

  transitionEvent: (eventId: number, targetStatus: string): Promise<{ event: EventResponse }> =>
    apiPost(`/api/v1/events/${eventId}/transition`, { targetStatus }),

  // ── Discord server config ────────────────────────────────────
  initServer: (guildId: string, data: { guildName?: string | null; guildIconUrl?: string | null; installedByDiscordId?: string | null }): Promise<unknown> =>
    apiPost(`/api/v1/servers/${guildId}/init`, data),

  uninstallServer: (guildId: string): Promise<unknown> =>
    apiPost(`/api/v1/servers/${guildId}/uninstall`, {}),

  setServerConfig: (guildId: string, config: { eventsChannelId?: string | null; resultsChannelId?: string | null; guildName?: string | null }): Promise<unknown> =>
    apiPost(`/api/v1/servers/${guildId}/config`, config),

  getServerConfig: (guildId: string): Promise<{ config: { eventsChannelId: string | null; resultsChannelId: string | null; guildName: string | null } | null }> =>
    apiGetInternal(`/api/v1/servers/${guildId}/config`),

  getResultsChannels: (): Promise<{ channelIds: string[] }> =>
    apiGetInternal("/api/v1/servers/results-channels"),

  // Per-user resolved channels for run-completed posting (respects mode).
  getRunResultsChannelsForUser: (
    userId: number,
  ): Promise<{ mode: "all_my_servers" | "none" | "primary"; channelIds: string[] }> =>
    apiGetInternal(`/api/v1/users/${userId}/run-results-channels`),

  // Atomically claim a set of channels for a run; returns only the freshly
  // claimed subset (others were already posted by an earlier submitter).
  claimRunDiscordChannels: (
    runId: number,
    channelIds: string[],
  ): Promise<{ claimedChannelIds: string[] }> =>
    apiPost(`/api/v1/runs/${runId}/claim-discord-channels`, { channelIds }),
};
