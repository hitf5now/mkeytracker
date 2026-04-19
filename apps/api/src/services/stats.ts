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
  season: {
    slug: string;
    name: string;
  };
  /** Null if the character is unclaimed (no linked User). */
  endorsements: EndorsementSummary | null;
  /** Discord ID of the claiming user, for linking to their profile surfaces. */
  claimedByDiscordId: string | null;
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
  /** Extra aggregates for the season-juice board (other boards leave null). */
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
    include: { user: { select: { discordId: true } } },
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
    season: { slug: season.slug, name: season.name },
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

// ─── Leaderboards ────────────────────────────────────────────────────

/**
 * A leaderboard category string. Predefined shapes:
 *   - "season-juice"
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

  if (category === "season-juice") {
    entries = await leaderboardSeasonJuice(season.id, limit);
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

async function leaderboardSeasonJuice(
  seasonId: number,
  limit: number,
): Promise<LeaderboardEntry[]> {
  // Per-character aggregates for the active season. Run count is distinct
  // because a run can join the member table once per character; SUM is
  // fine here since we have (runId, characterId) unique.
  const rows = await prisma.$queryRaw<
    Array<{
      characterId: number;
      personalJuice: bigint;
      teamJuice: bigint;
      eventJuice: bigint;
      runCount: bigint;
    }>
  >`
    SELECT
      rm.character_id                       AS "characterId",
      COALESCE(SUM(r.personal_juice), 0)    AS "personalJuice",
      COALESCE(SUM(r.team_juice), 0)        AS "teamJuice",
      COALESCE(SUM(r.event_juice), 0)       AS "eventJuice",
      COUNT(DISTINCT r.id)                  AS "runCount"
    FROM run_members rm
    JOIN runs r ON r.id = rm.run_id
    WHERE r.season_id = ${seasonId}
    GROUP BY rm.character_id
    ORDER BY "personalJuice" DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) return [];

  const charMap = await loadCharactersById(rows.map((r) => r.characterId));

  // Endorsement counts PER CHARACTER (not per user) — a player's warrior
  // and mage each earn their own endorsements. Batched via groupBy on
  // receiver_character_id.
  const characterIds = rows.map((r) => r.characterId);
  const endorsementCounts = new Map<number, number>();
  if (characterIds.length > 0) {
    const counts = await prisma.endorsement.groupBy({
      by: ["receiverCharacterId"],
      where: { receiverCharacterId: { in: characterIds } },
      _count: { receiverCharacterId: true },
    });
    for (const c of counts) {
      endorsementCounts.set(c.receiverCharacterId, c._count.receiverCharacterId);
    }
  }

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
    const personalJuice = Number(row.personalJuice);
    const teamJuice = Number(row.teamJuice);
    const eventJuice = Number(row.eventJuice);
    const runCount = Number(row.runCount);
    const endorsements = endorsementCounts.get(row.characterId) ?? 0;
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
      value: personalJuice,
      displayValue: `${personalJuice.toLocaleString()} Juice`,
      personalJuice,
      teamJuice,
      eventJuice,
      runCount,
      endorsementsReceived: endorsements,
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
