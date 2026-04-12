/**
 * RaiderIO HTTP client.
 *
 * Public API, no auth required. Rate-limited generously; we cache hot
 * lookups in Redis later. For now this is a plain fetch wrapper.
 *
 * Docs: https://raider.io/api
 */

import { env } from "../config/env.js";
import { toRealmSlug } from "./realm.js";

export class RaiderIOError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "RaiderIOError";
  }
}

export class CharacterNotFoundError extends RaiderIOError {
  constructor(url: string) {
    super("Character not found on RaiderIO", 404, url);
    this.name = "CharacterNotFoundError";
  }
}

export type RaiderIORegion = "us" | "eu" | "kr" | "tw" | "cn";
export type RaiderIORole = "tank" | "healer" | "dps";

export interface RaiderIOCharacter {
  /** Normalized class slug, e.g. "death-knight" */
  classSlug: string;
  /** Display class name as returned by RaiderIO, e.g. "Death Knight" */
  className: string;
  /** Active spec name, e.g. "Blood" */
  specName: string;
  /** Active spec role as reported by RaiderIO */
  role: RaiderIORole;
  /** Current-season overall M+ score (integer) */
  rioScore: number;
  /** Canonicalized realm slug as RaiderIO returned it, e.g. "area-52" */
  realmSlug: string;
  /** Character name exactly as returned */
  name: string;
  /** Direct link to the RaiderIO profile */
  profileUrl: string;
}

interface RaiderIOProfileResponse {
  name: string;
  class: string;
  active_spec_name: string;
  active_spec_role: string; // "DPS" | "TANK" | "HEALING"
  region: string;
  realm: string;
  profile_url: string;
  mythic_plus_scores_by_season?: Array<{
    season: string;
    scores: {
      all: number;
      dps: number;
      healer: number;
      tank: number;
    };
  }>;
}

function classNameToSlug(className: string): string {
  return className.toLowerCase().replace(/\s+/g, "-");
}

function normalizeRole(rioRole: string): RaiderIORole {
  const r = rioRole.toLowerCase();
  if (r === "tank") return "tank";
  if (r === "healing" || r === "healer") return "healer";
  return "dps";
}

/**
 * Fetches a character from RaiderIO.
 *
 * @throws {CharacterNotFoundError} if RaiderIO returns 404
 * @throws {RaiderIOError} on other HTTP or network failures
 */
export async function fetchCharacter(
  region: RaiderIORegion,
  realm: string,
  name: string,
): Promise<RaiderIOCharacter> {
  const url = new URL(`${env.RAIDERIO_BASE_URL}/characters/profile`);
  url.searchParams.set("region", region);
  url.searchParams.set("realm", realm);
  url.searchParams.set("name", name);
  url.searchParams.set("fields", "mythic_plus_scores_by_season:current");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  // RaiderIO returns 400 with body { error: "Bad Request", message: "Could not find requested character" }
  // for a missing character — not 404. Normalize both to CharacterNotFoundError.
  if (!response.ok) {
    let errorBody: { message?: string } | null = null;
    try {
      errorBody = (await response.clone().json()) as { message?: string };
    } catch {
      // non-JSON body — ignore
    }
    const msg = errorBody?.message ?? "";
    if (response.status === 404 || /could not find/i.test(msg)) {
      throw new CharacterNotFoundError(url.toString());
    }
    throw new RaiderIOError(
      `RaiderIO returned ${response.status}${msg ? `: ${msg}` : ""}`,
      response.status,
      url.toString(),
    );
  }

  const data = (await response.json()) as RaiderIOProfileResponse;

  const currentSeasonScore =
    data.mythic_plus_scores_by_season?.[0]?.scores?.all ?? 0;

  return {
    classSlug: classNameToSlug(data.class),
    className: data.class,
    specName: data.active_spec_name,
    role: normalizeRole(data.active_spec_role),
    rioScore: Math.round(currentSeasonScore),
    // RaiderIO returns realm as a display name ("Trollbane", "Area 52").
    // We canonicalize to our slug format so DB lookups are stable regardless
    // of what the caller passed in.
    realmSlug: toRealmSlug(data.realm),
    name: data.name,
    profileUrl: data.profile_url,
  };
}
