/**
 * Season-sync decision rules — pure, no I/O.
 *
 * Split from `season-sync.ts` so the gating logic that decides whether to
 * flip the active season can be unit-tested without env, network or DB.
 * `season-sync.ts` owns the effects; this file owns the judgement.
 */

import type { SeasonInput } from "./seasons.js";

/** A season pool smaller than this is treated as an upstream data glitch. */
const MIN_POOL_SIZE = 4;

/**
 * Raider.IO marks the open-ended current season with a far-future sentinel
 * (2030-01-01). Anything this far past the start is "no end date yet".
 */
const OPEN_ENDED_AFTER_DAYS = 400;

export interface RioDungeon {
  challenge_mode_id: number;
  slug: string;
  name: string;
  short_name: string;
  keystone_timer_seconds: number;
}

export interface RioSeason {
  slug: string;
  name: string;
  blizzard_season_id: number | null;
  is_main_season: boolean;
  short_name: string;
  starts: Record<string, string>;
  ends: Record<string, string> | null;
  dungeons: RioDungeon[];
}

export interface SeasonSyncResult {
  /** What the sync did. */
  action: "activated" | "updated" | "noop" | "skipped" | "failed";
  /** Human-readable explanation — surfaced in logs and the Discord ping. */
  reason: string;
  /** Slug of the season this run settled on, when one was resolved. */
  seasonSlug?: string;
  /** Slug of the season that was active before this run. */
  previousSeasonSlug?: string;
  /** Blizzard's current season id, when it could be fetched. */
  blizzardSeasonId?: number | null;
  /** True when Blizzard corroborated Raider.IO's choice. */
  crossChecked?: boolean;
  dungeonsUpserted?: number;
  dungeonsRemoved?: number;
}

/**
 * Our display name + slug for a Raider.IO season.
 *
 * Raider.IO uses terse forms ("MN Season 2" / `season-mn-2`); the platform
 * has always used the full expansion name. Unknown abbreviations fall
 * through to Raider.IO's own values rather than guessing — an admin can
 * rename the row afterwards and the `externalSlug` key keeps the sync
 * pointed at it.
 */
const EXPANSION_NAMES: Record<string, string> = {
  mn: "Midnight",
  tww: "The War Within",
  df: "Dragonflight",
  sl: "Shadowlands",
  bfa: "Battle for Azeroth",
};

export interface SeasonIdentity {
  slug: string;
  name: string;
  /** Expansion display name, or null when the slug isn't recognisable. */
  expansion: string | null;
  /** Ordinal within the expansion, or null when it can't be determined. */
  seasonNumber: number | null;
}

export function deriveSeasonIdentity(rio: RioSeason): SeasonIdentity {
  const m = /^season-([a-z]+)-(\d+)$/.exec(rio.slug);
  const abbr = m?.[1];
  const num = m?.[2];
  const expansion = abbr ? EXPANSION_NAMES[abbr] : undefined;
  if (expansion && num) {
    return {
      slug: `${expansion.toLowerCase().replace(/\s+/g, "-")}-s${num}`,
      name: `${expansion} Season ${num}`,
      expansion,
      seasonNumber: Number(num),
    };
  }
  // Unrecognised upstream slug (a new expansion abbreviation, or a variant
  // like "season-tww-1-post"). Fall back to upstream's own labels and leave
  // the grouping fields null — the picker renders those under "Other" rather
  // than inventing an expansion name.
  return { slug: rio.slug, name: rio.name, expansion: null, seasonNumber: null };
}

export function toSeasonInput(rio: RioSeason, startsAt: Date, patch: string): SeasonInput {
  const endsUs = rio.ends?.us;
  const rawEnds = endsUs ? new Date(endsUs) : null;
  const openEnded =
    rawEnds === null ||
    rawEnds.getTime() - startsAt.getTime() > OPEN_ENDED_AFTER_DAYS * 86_400_000;

  const { slug, name, expansion, seasonNumber } = deriveSeasonIdentity(rio);

  return {
    slug,
    name,
    expansion,
    seasonNumber,
    patch,
    startsAt,
    endsAt: openEnded ? null : rawEnds,
    isActive: false, // activation is a separate, gated decision
    externalSlug: rio.slug,
    wowSeasonId: rio.blizzard_season_id,
    dungeons: rio.dungeons.map((d) => ({
      challengeModeId: d.challenge_mode_id,
      slug: d.slug,
      name: d.name,
      shortCode: d.short_name,
      parTimeSec: d.keystone_timer_seconds,
    })),
  };
}

/**
 * Decide whether `candidate` should become the active season.
 *
 * Split out from `syncSeasons` so the gating rules are testable on their own
 * and readable without the I/O around them.
 */
export function evaluateCandidate(args: {
  candidate: SeasonInput;
  activeSlug: string | null;
  activePoolKey: string | null;
  now: Date;
}): { activate: boolean; reason: string } {
  const { candidate, activeSlug, activePoolKey, now } = args;

  if (new Date(candidate.startsAt).getTime() > now.getTime()) {
    return { activate: false, reason: `${candidate.slug} has not started yet` };
  }
  if (candidate.dungeons.length < MIN_POOL_SIZE) {
    return {
      activate: false,
      reason: `${candidate.slug} reported only ${candidate.dungeons.length} dungeons — refusing to activate a suspect pool`,
    };
  }
  if (candidate.slug === activeSlug) {
    return { activate: false, reason: `${candidate.slug} is already active` };
  }
  // A genuine rollover always swaps the pool. An identical pool under a new
  // slug means upstream re-labelled the season rather than starting one, and
  // activating it would reset leaderboards for no reason.
  if (activePoolKey !== null && poolKey(candidate) === activePoolKey) {
    return {
      activate: false,
      reason: `${candidate.slug} has the same dungeon pool as the active season — treating as a relabel, not a rollover`,
    };
  }
  return { activate: true, reason: `${candidate.slug} is the current main season` };
}

/** Order-independent fingerprint of a dungeon pool. */
export function poolKey(season: { dungeons: { challengeModeId: number }[] }): string {
  return season.dungeons
    .map((d) => d.challengeModeId)
    .sort((a, b) => a - b)
    .join(",");
}

