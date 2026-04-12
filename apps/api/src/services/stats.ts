/**
 * Stats aggregation service.
 *
 * Reads the `runs` + `run_members` tables directly to compute player
 * profiles and leaderboards on demand. For MVP these queries are
 * uncached — with current data volume (<1k runs) it's trivial. When
 * the platform grows past a few thousand runs, move the hot paths
 * into Redis sorted sets or materialized views per MPLUS_PLATFORM.md
 * "Leaderboard Computation Strategy".
 *
 * All queries scope to the currently-active season.
 */

import { prisma } from "../lib/prisma.js";

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
  character: CharacterPublic;
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
  /** Optional per-entry context like dungeon name for fastest-clear boards */
  context?: string;
}

export interface LeaderboardResult {
  category: string;
  season: { slug: string; name: string };
  entries: LeaderboardEntry[];
  updatedAt: string;
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

export async function getCharacterProfile(
  region: string,
  realm: string,
  name: string,
): Promise<CharacterProfile | null> {
  const character = await prisma.character.findUnique({
    where: { region_realm_name: { region, realm, name } },
  });
  if (!character) return null;

  const season = await getActiveSeason();

  // All of this character's run_member rows in the active season
  const memberRuns = await prisma.runMember.findMany({
    where: {
      characterId: character.id,
      run: { seasonId: season.id },
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
  const totalPoints = memberRuns.reduce((sum, rm) => sum + rm.run.points, 0);

  // Weekly scope: runs recorded in the last 7 days
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const weeklyPoints = memberRuns
    .filter((rm) => rm.run.recordedAt >= oneWeekAgo)
    .reduce((sum, rm) => sum + rm.run.points, 0);

  // Best run per dungeon (highest points)
  const bestPerDungeonMap = new Map<number, (typeof memberRuns)[number]>();
  for (const rm of memberRuns) {
    const existing = bestPerDungeonMap.get(rm.run.dungeonId);
    if (!existing || rm.run.points > existing.run.points) {
      bestPerDungeonMap.set(rm.run.dungeonId, rm);
    }
  }

  const bestRunPerDungeon: ProfileBestRun[] = Array.from(
    bestPerDungeonMap.values(),
  )
    .map((rm) => ({
      dungeonSlug: rm.run.dungeon.slug,
      dungeonName: rm.run.dungeon.name,
      dungeonShortCode: rm.run.dungeon.shortCode,
      level: rm.run.keystoneLevel,
      completionMs: rm.run.completionMs,
      parMs: rm.run.parMs,
      onTime: rm.run.onTime,
      upgrades: rm.run.upgrades,
      points: rm.run.points,
      recordedAt: rm.run.recordedAt.toISOString(),
    }))
    .sort((a, b) => b.points - a.points);

  const recentRuns: ProfileRecentRun[] = memberRuns.slice(0, 5).map((rm) => ({
    id: rm.run.id,
    dungeonSlug: rm.run.dungeon.slug,
    dungeonName: rm.run.dungeon.name,
    level: rm.run.keystoneLevel,
    onTime: rm.run.onTime,
    upgrades: rm.run.upgrades,
    deaths: rm.run.deaths,
    points: rm.run.points,
    recordedAt: rm.run.recordedAt.toISOString(),
  }));

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
      totalPoints,
      weeklyPoints,
      bestRunPerDungeon,
      recentRuns,
    },
    season: { slug: season.slug, name: season.name },
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

// ─── Leaderboards ────────────────────────────────────────────────────

/**
 * A leaderboard category string. Predefined shapes:
 *   - "season-points"
 *   - "highest-key"
 *   - "most-timed"
 *   - "fastest-clear-<dungeonSlug>"
 */
export type LeaderboardCategory = string;

export async function getLeaderboard(
  category: LeaderboardCategory,
  limit = 10,
): Promise<LeaderboardResult> {
  const season = await getActiveSeason();
  const now = new Date().toISOString();

  let entries: LeaderboardEntry[] = [];
  let context: string | undefined;

  if (category === "season-points") {
    entries = await leaderboardSeasonPoints(season.id, limit);
  } else if (category === "highest-key") {
    entries = await leaderboardHighestKey(season.id, limit);
  } else if (category === "most-timed") {
    entries = await leaderboardMostTimed(season.id, limit);
  } else if (category.startsWith("fastest-clear-")) {
    const dungeonSlug = category.substring("fastest-clear-".length);
    const dungeon = await prisma.dungeon.findFirst({
      where: { seasonId: season.id, slug: dungeonSlug },
    });
    if (!dungeon) {
      return {
        category,
        season: { slug: season.slug, name: season.name },
        entries: [],
        updatedAt: now,
      };
    }
    context = dungeon.name;
    entries = await leaderboardFastestClear(season.id, dungeon.id, limit);
    for (const e of entries) e.context = context;
  }

  return {
    category,
    season: { slug: season.slug, name: season.name },
    entries,
    updatedAt: now,
  };
}

// ─── Category queries ────────────────────────────────────────────────

async function leaderboardSeasonPoints(
  seasonId: number,
  limit: number,
): Promise<LeaderboardEntry[]> {
  const rows = await prisma.$queryRaw<
    Array<{ characterId: number; total: bigint }>
  >`
    SELECT rm.character_id AS "characterId", SUM(r.points) AS total
    FROM run_members rm
    JOIN runs r ON r.id = rm.run_id
    WHERE r.season_id = ${seasonId}
    GROUP BY rm.character_id
    ORDER BY total DESC
    LIMIT ${limit}
  `;

  const charMap = await loadCharactersById(rows.map((r) => r.characterId));
  return rows.map((row, i) => {
    const c = charMap.get(row.characterId) as {
      id: number;
      name: string;
      realm: string;
      region: string;
      class: string;
      spec: string;
      userId: number | null;
    };
    const total = Number(row.total);
    return {
      rank: i + 1,
      character: {
        id: c.id,
        name: c.name,
        realm: c.realm,
        region: c.region,
        class: c.class,
        spec: c.spec,
        claimed: c.userId !== null,
      },
      value: total,
      displayValue: `${total.toLocaleString()} pts`,
    };
  });
}

async function leaderboardHighestKey(
  seasonId: number,
  limit: number,
): Promise<LeaderboardEntry[]> {
  const rows = await prisma.$queryRaw<
    Array<{ characterId: number; maxLevel: number }>
  >`
    SELECT rm.character_id AS "characterId", MAX(r.keystone_level) AS "maxLevel"
    FROM run_members rm
    JOIN runs r ON r.id = rm.run_id
    WHERE r.season_id = ${seasonId} AND r.on_time = true
    GROUP BY rm.character_id
    ORDER BY "maxLevel" DESC
    LIMIT ${limit}
  `;

  const charMap = await loadCharactersById(rows.map((r) => r.characterId));
  return rows.map((row, i) => {
    const c = charMap.get(row.characterId) as {
      id: number;
      name: string;
      realm: string;
      region: string;
      class: string;
      spec: string;
      userId: number | null;
    };
    return {
      rank: i + 1,
      character: {
        id: c.id,
        name: c.name,
        realm: c.realm,
        region: c.region,
        class: c.class,
        spec: c.spec,
        claimed: c.userId !== null,
      },
      value: row.maxLevel,
      displayValue: `+${row.maxLevel}`,
    };
  });
}

async function leaderboardMostTimed(
  seasonId: number,
  limit: number,
): Promise<LeaderboardEntry[]> {
  const rows = await prisma.$queryRaw<
    Array<{ characterId: number; cnt: bigint }>
  >`
    SELECT rm.character_id AS "characterId", COUNT(*) AS cnt
    FROM run_members rm
    JOIN runs r ON r.id = rm.run_id
    WHERE r.season_id = ${seasonId} AND r.on_time = true
    GROUP BY rm.character_id
    ORDER BY cnt DESC
    LIMIT ${limit}
  `;

  const charMap = await loadCharactersById(rows.map((r) => r.characterId));
  return rows.map((row, i) => {
    const c = charMap.get(row.characterId) as {
      id: number;
      name: string;
      realm: string;
      region: string;
      class: string;
      spec: string;
      userId: number | null;
    };
    const n = Number(row.cnt);
    return {
      rank: i + 1,
      character: {
        id: c.id,
        name: c.name,
        realm: c.realm,
        region: c.region,
        class: c.class,
        spec: c.spec,
        claimed: c.userId !== null,
      },
      value: n,
      displayValue: `${n} timed`,
    };
  });
}

async function leaderboardFastestClear(
  seasonId: number,
  dungeonId: number,
  limit: number,
): Promise<LeaderboardEntry[]> {
  const rows = await prisma.$queryRaw<
    Array<{ characterId: number; minTime: number }>
  >`
    SELECT rm.character_id AS "characterId", MIN(r.completion_ms) AS "minTime"
    FROM run_members rm
    JOIN runs r ON r.id = rm.run_id
    WHERE r.season_id = ${seasonId}
      AND r.dungeon_id = ${dungeonId}
      AND r.on_time = true
    GROUP BY rm.character_id
    ORDER BY "minTime" ASC
    LIMIT ${limit}
  `;

  const charMap = await loadCharactersById(rows.map((r) => r.characterId));
  return rows.map((row, i) => {
    const c = charMap.get(row.characterId) as {
      id: number;
      name: string;
      realm: string;
      region: string;
      class: string;
      spec: string;
      userId: number | null;
    };
    return {
      rank: i + 1,
      character: {
        id: c.id,
        name: c.name,
        realm: c.realm,
        region: c.region,
        class: c.class,
        spec: c.spec,
        claimed: c.userId !== null,
      },
      value: row.minTime,
      displayValue: formatDuration(row.minTime),
    };
  });
}
