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
    totalPoints: number;
    weeklyPoints: number;
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

export interface ApiErrorBody {
  error: string;
  message?: string;
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
};
