/**
 * Stats aggregation service.
 *
 * Reads the `runs` + `run_members` tables directly to compute player
 * profiles on demand. For MVP these queries are
 * uncached — with current data volume (<1k runs) it's trivial. When
 * the platform grows past a few thousand runs, move the hot paths
 * into Redis sorted sets or materialized views per MPLUS_PLATFORM.md
 * "Leaderboard Computation Strategy".
 *
 * Queries are season-scoped. Callers pass a season slug/id (or "all") and
 * default to the active season when they pass nothing.
 */

import { prisma } from "../lib/prisma.js";
import { resolveSeasonParam } from "./seasons.js";
import {
  getEndorsementSummaryForCharacter,
  type EndorsementSummary,
} from "./endorsement-stats.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface CharacterPublic {
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
}

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
  character: CharacterPublic;
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
  /** Season the stats are scoped to, or null when spanning every season. */
  season: {
    slug: string;
    name: string;
  } | null;
  /** Null if the character is unclaimed (no linked User). */
  endorsements: EndorsementSummary | null;
  /** Discord ID of the claiming user, for linking to their profile surfaces. */
  claimedByDiscordId: string | null;
}


// ─── Helpers ─────────────────────────────────────────────────────────

async function getActiveSeason() {
  const season = await prisma.season.findFirst({ where: { isActive: true } });
  if (!season) {
    throw new Error("No active season configured. Run the seed script.");
  }
  return season;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

async function loadCharactersById(ids: number[]) {
  if (ids.length === 0) return new Map<number, unknown>();
  const rows = await prisma.character.findMany({ where: { id: { in: ids } } });
  return new Map(rows.map((c) => [c.id, c]));
}

// ─── Character profile ──────────────────────────────────────────────

/**
 * @param seasonParam Season slug, id, or "all". Omit for the active season.
 *   Without this a profile reads "no runs this season" for a player with
 *   hundreds of runs the day a new season starts.
 */
export async function getCharacterProfile(
  region: string,
  realm: string,
  name: string,
  seasonParam?: string,
): Promise<CharacterProfile | null> {
  const character = await prisma.character.findUnique({
    where: { region_realm_name: { region, realm, name } },
    include: { user: { select: { discordId: true } } },
  });
  if (!character) return null;

  const resolved = await resolveSeasonParam(prisma, seasonParam);
  if (!resolved) return null;
  const season = resolved.season;
  const seasonRef = season ? { slug: season.slug, name: season.name } : null;

  // All of this character's run_member rows in the selected scope
  const memberRuns = await prisma.runMember.findMany({
    where: {
      characterId: character.id,
      ...(season ? { run: { seasonId: season.id } } : {}),
    },
    include: { run: { include: { dungeon: true } } },
    orderBy: { run: { recordedAt: "desc" } },
  });

  const totalRuns = memberRuns.length;
  const timedRuns = memberRuns.filter((rm) => rm.run.onTime).length;
  const depletedRuns = totalRuns - timedRuns;
  const totalDeaths = memberRuns.reduce((sum, rm) => sum + rm.run.deaths, 0);
  const highestKeyCompleted = memberRuns
    .filter((rm) => rm.run.onTime)
    .reduce((max, rm) => Math.max(max, rm.run.keystoneLevel), 0);
  const totalJuice = memberRuns.reduce((sum, rm) => sum + rm.run.personalJuice, 0);

  // Weekly scope: runs recorded in the last 7 days
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const weeklyJuice = memberRuns
    .filter((rm) => rm.run.recordedAt >= oneWeekAgo)
    .reduce((sum, rm) => sum + rm.run.personalJuice, 0);

  // Best run per dungeon (highest Juice)
  const bestPerDungeonMap = new Map<number, (typeof memberRuns)[number]>();
  for (const rm of memberRuns) {
    const existing = bestPerDungeonMap.get(rm.run.dungeonId);
    if (!existing || rm.run.personalJuice > existing.run.personalJuice) {
      bestPerDungeonMap.set(rm.run.dungeonId, rm);
    }
  }

  const bestRunPerDungeon: ProfileBestRun[] = Array.from(
    bestPerDungeonMap.values(),
  )
    .map((rm) => ({
      id: rm.run.id,
      dungeonSlug: rm.run.dungeon.slug,
      dungeonName: rm.run.dungeon.name,
      dungeonShortCode: rm.run.dungeon.shortCode,
      level: rm.run.keystoneLevel,
      completionMs: rm.run.completionMs,
      parMs: rm.run.parMs,
      onTime: rm.run.onTime,
      upgrades: rm.run.upgrades,
      juice: rm.run.personalJuice,
      recordedAt: rm.run.recordedAt.toISOString(),
    }))
    .sort((a, b) => b.juice - a.juice);

  const recentRuns: ProfileRecentRun[] = memberRuns.slice(0, 5).map((rm) => ({
    id: rm.run.id,
    dungeonSlug: rm.run.dungeon.slug,
    dungeonName: rm.run.dungeon.name,
    level: rm.run.keystoneLevel,
    onTime: rm.run.onTime,
    upgrades: rm.run.upgrades,
    deaths: rm.run.deaths,
    juice: rm.run.personalJuice,
    recordedAt: rm.run.recordedAt.toISOString(),
  }));

  // Scope endorsements to this specific character, not the whole
  // account — a "Great Tank" earned on my warrior shouldn't show up
  // on my mage's profile.
  const endorsements =
    character.userId !== null
      ? await getEndorsementSummaryForCharacter(character.id)
      : null;

  return {
    character: {
      id: character.id,
      name: character.name,
      realm: character.realm,
      region: character.region,
      class: character.class,
      spec: character.spec,
      role: character.role,
      rioScore: character.rioScore,
      claimed: character.userId !== null,
      thumbnailUrl: character.thumbnailUrl ?? null,
      avatarUrl: character.avatarUrl ?? null,
      insetUrl: character.insetUrl ?? null,
      mainRawUrl: character.mainRawUrl ?? null,
    },
    stats: {
      totalRuns,
      timedRuns,
      depletedRuns,
      totalDeaths,
      highestKeyCompleted,
      totalJuice,
      weeklyJuice,
      bestRunPerDungeon,
      recentRuns,
    },
    season: seasonRef,
    endorsements,
    claimedByDiscordId: character.user?.discordId ?? null,
  };
}

/**
 * Pick the first claimed character for a given Discord user, used by the
 * bot's /profile command when the user doesn't specify one.
 */
export async function getFirstCharacterForDiscordUser(
  discordId: string,
): Promise<{ region: string; realm: string; name: string } | null> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    include: {
      characters: {
        where: { userId: { not: null } },
        orderBy: { id: "asc" },
        take: 1,
      },
    },
  });
  const first = user?.characters[0];
  if (!first) return null;
  return { region: first.region, realm: first.realm, name: first.name };
}
