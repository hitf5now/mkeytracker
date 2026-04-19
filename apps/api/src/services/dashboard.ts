/**
 * User dashboard aggregation service.
 *
 * Loads all of a user's characters and their runs in the active season,
 * then aggregates into sections for the personal dashboard:
 *   - Overview stats (total runs, timed vs depleted, highest keys, Juice totals)
 *   - Per-character cards
 *   - Role breakdown with best-run context per role
 *   - Dungeon breakdown with best completed + best timed context
 *   - Recent runs (across all characters)
 *   - Chart data (runs per week, key progression)
 */

import { prisma } from "../lib/prisma.js";
import {
  getEndorsementSummaryForUser,
  type EndorsementSummary,
} from "./endorsement-stats.js";
import {
  getTokenBalance,
  type TokenBalance,
} from "./endorsement-tokens.js";

// ─── Types ───────────────────────────────────────────────────────

export interface DashboardOverview {
  totalRuns: number;
  timedRuns: number;
  depletedRuns: number;
  totalDeaths: number;
  /** Highest keystone level finished (timed OR depleted). */
  highestKeyCompleted: number;
  /** Highest keystone level beat within par time. */
  highestKeyTimed: number;
  /** Personal Juice total for this season. */
  totalJuice: number;
  /** Event Juice — only accumulated on event-linked runs. */
  totalEventJuice: number;
  /** Team Juice — only accumulated when the full 5 shared a team. */
  totalTeamJuice: number;
  weeklyJuice: number;
  /** Percent of completed runs that were timed. 0–100. */
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

/**
 * A "best run" pointer — level plus the dungeon + character where it happened.
 * Null when the role has no matching run (e.g. the user never tanked timed).
 */
export interface BestRunRef {
  level: number;
  dungeonName: string;
  dungeonShortCode: string;
  characterName: string;
  characterClass: string;
}

export interface DashboardRoleBreakdown {
  role: "tank" | "healer" | "dps";
  totalRuns: number;
  timedRuns: number;
  totalJuice: number;
  /** Highest finished key in this role (timed OR depleted). Null if never played. */
  bestKeyCompleted: BestRunRef | null;
  /** Highest timed key in this role. Null if never timed in this role. */
  bestKeyTimed: BestRunRef | null;
}

export interface DashboardDungeonBreakdown {
  dungeonSlug: string;
  dungeonName: string;
  dungeonShortCode: string;
  /** Highest key finished for this dungeon (timed or depleted). Null = never run. */
  bestKeyCompleted: { level: number; characterName: string; characterClass: string } | null;
  /** Highest key timed for this dungeon. Null = never timed. */
  bestKeyTimed: { level: number; characterName: string; characterClass: string } | null;
  /** Fastest timed clear in ms. Null = never timed. */
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

// ─── Helpers ─────────────────────────────────────────────────────

function getISOWeekLabel(date: Date): string {
  const monday = new Date(date);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getISOWeekKey(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.toISOString().slice(0, 10);
}

const EMPTY_OVERVIEW: DashboardOverview = {
  totalRuns: 0,
  timedRuns: 0,
  depletedRuns: 0,
  totalDeaths: 0,
  highestKeyCompleted: 0,
  highestKeyTimed: 0,
  totalJuice: 0,
  totalEventJuice: 0,
  totalTeamJuice: 0,
  weeklyJuice: 0,
  timedRate: 0,
};

// ─── Main function ───────────────────────────────────────────────

export async function getUserDashboard(userId: number): Promise<DashboardResult | null> {
  const season = await prisma.season.findFirst({ where: { isActive: true } });
  if (!season) return null;

  const characters = await prisma.character.findMany({
    where: { userId },
    orderBy: { rioScore: "desc" },
  });

  if (characters.length === 0) {
    const [endorsements, tokenBalance] = await Promise.all([
      getEndorsementSummaryForUser(userId),
      getTokenBalance(userId),
    ]);
    return {
      overview: EMPTY_OVERVIEW,
      characters: [],
      roleBreakdown: [],
      dungeonBreakdown: [],
      recentRuns: [],
      chartData: { runsPerWeek: [], keyProgression: [] },
      season: { slug: season.slug, name: season.name },
      endorsements,
      tokenBalance,
    };
  }

  const characterIds = characters.map((c) => c.id);
  const characterMap = new Map(characters.map((c) => [c.id, c]));

  // Single query: all run members for this user's characters in the active season
  const memberRuns = await prisma.runMember.findMany({
    where: {
      characterId: { in: characterIds },
      run: { seasonId: season.id },
    },
    include: { run: { include: { dungeon: true } } },
    orderBy: { run: { recordedAt: "desc" } },
  });

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  // ── Overview ──────────────────────────────────────────────
  const totalRuns = memberRuns.length;
  const timedRuns = memberRuns.filter((rm) => rm.run.onTime).length;
  const depletedRuns = totalRuns - timedRuns;
  const totalDeaths = memberRuns.reduce((sum, rm) => sum + rm.run.deaths, 0);

  // Highest completed = any finished run (timed or depleted).
  const highestKeyCompleted = memberRuns.reduce(
    (max, rm) => Math.max(max, rm.run.keystoneLevel),
    0,
  );
  // Highest timed = only onTime runs.
  const highestKeyTimed = memberRuns
    .filter((rm) => rm.run.onTime)
    .reduce((max, rm) => Math.max(max, rm.run.keystoneLevel), 0);

  const totalJuice = memberRuns.reduce((sum, rm) => sum + rm.run.personalJuice, 0);
  const totalEventJuice = memberRuns.reduce(
    (sum, rm) => sum + (rm.run.eventJuice ?? 0),
    0,
  );
  const totalTeamJuice = memberRuns.reduce(
    (sum, rm) => sum + (rm.run.teamJuice ?? 0),
    0,
  );
  const weeklyJuice = memberRuns
    .filter((rm) => rm.run.recordedAt >= oneWeekAgo)
    .reduce((sum, rm) => sum + rm.run.personalJuice, 0);
  const timedRate = totalRuns > 0 ? Math.round((timedRuns / totalRuns) * 100) : 0;

  const overview: DashboardOverview = {
    totalRuns,
    timedRuns,
    depletedRuns,
    totalDeaths,
    highestKeyCompleted,
    highestKeyTimed,
    totalJuice,
    totalEventJuice,
    totalTeamJuice,
    weeklyJuice,
    timedRate,
  };

  // ── Per-character stats ───────────────────────────────────
  const dashCharacters: DashboardCharacter[] = characters.map((c) => {
    const charRuns = memberRuns.filter((rm) => rm.characterId === c.id);
    return {
      id: c.id,
      name: c.name,
      realm: c.realm,
      region: c.region,
      class: c.class,
      spec: c.spec,
      role: c.role,
      rioScore: c.rioScore,
      hasCompanionApp: c.hasCompanionApp,
      totalRuns: charRuns.length,
      timedRuns: charRuns.filter((rm) => rm.run.onTime).length,
      highestKey: charRuns
        .filter((rm) => rm.run.onTime)
        .reduce((max, rm) => Math.max(max, rm.run.keystoneLevel), 0),
      totalJuice: charRuns.reduce((sum, rm) => sum + rm.run.personalJuice, 0),
    };
  });

  // ── Role breakdown ────────────────────────────────────────
  // Iterate once, track both best-completed and best-timed with full context.
  interface RoleAggregate {
    totalRuns: number;
    timedRuns: number;
    totalJuice: number;
    bestCompleted: { rm: (typeof memberRuns)[number]; level: number } | null;
    bestTimed: { rm: (typeof memberRuns)[number]; level: number } | null;
  }
  const roleMap = new Map<string, RoleAggregate>();
  for (const rm of memberRuns) {
    const role = (rm.roleSnapshot || "dps").toLowerCase();
    const entry =
      roleMap.get(role) ?? {
        totalRuns: 0,
        timedRuns: 0,
        totalJuice: 0,
        bestCompleted: null,
        bestTimed: null,
      };
    entry.totalRuns++;
    entry.totalJuice += rm.run.personalJuice;
    if (rm.run.onTime) entry.timedRuns++;
    if (
      entry.bestCompleted === null ||
      rm.run.keystoneLevel > entry.bestCompleted.level
    ) {
      entry.bestCompleted = { rm, level: rm.run.keystoneLevel };
    }
    if (
      rm.run.onTime &&
      (entry.bestTimed === null || rm.run.keystoneLevel > entry.bestTimed.level)
    ) {
      entry.bestTimed = { rm, level: rm.run.keystoneLevel };
    }
    roleMap.set(role, entry);
  }

  const toBestRef = (pick: RoleAggregate["bestCompleted"]): BestRunRef | null => {
    if (!pick) return null;
    const char = characterMap.get(pick.rm.characterId);
    return {
      level: pick.level,
      dungeonName: pick.rm.run.dungeon.name,
      dungeonShortCode: pick.rm.run.dungeon.shortCode,
      characterName: char?.name ?? "Unknown",
      characterClass: char?.class ?? "warrior",
    };
  };

  const roleBreakdown: DashboardRoleBreakdown[] = (
    ["tank", "healer", "dps"] as const
  ).map((role) => {
    const entry = roleMap.get(role);
    return {
      role,
      totalRuns: entry?.totalRuns ?? 0,
      timedRuns: entry?.timedRuns ?? 0,
      totalJuice: entry?.totalJuice ?? 0,
      bestKeyCompleted: toBestRef(entry?.bestCompleted ?? null),
      bestKeyTimed: toBestRef(entry?.bestTimed ?? null),
    };
  });

  // ── Dungeon breakdown ─────────────────────────────────────
  interface DungeonAggregate {
    dungeon: { slug: string; name: string; shortCode: string };
    totalJuice: number;
    timedCount: number;
    fastestClearMs: number | null;
    bestCompleted: { level: number; characterId: number } | null;
    bestTimed: { level: number; characterId: number } | null;
  }
  const dungeonMap = new Map<number, DungeonAggregate>();

  for (const rm of memberRuns) {
    const d = rm.run.dungeon;
    const entry =
      dungeonMap.get(rm.run.dungeonId) ?? {
        dungeon: { slug: d.slug, name: d.name, shortCode: d.shortCode },
        totalJuice: 0,
        timedCount: 0,
        fastestClearMs: null,
        bestCompleted: null,
        bestTimed: null,
      };

    entry.totalJuice += rm.run.personalJuice;
    if (rm.run.onTime) {
      entry.timedCount++;
      if (entry.fastestClearMs === null || rm.run.completionMs < entry.fastestClearMs) {
        entry.fastestClearMs = rm.run.completionMs;
      }
      if (entry.bestTimed === null || rm.run.keystoneLevel > entry.bestTimed.level) {
        entry.bestTimed = {
          level: rm.run.keystoneLevel,
          characterId: rm.characterId,
        };
      }
    }
    if (
      entry.bestCompleted === null ||
      rm.run.keystoneLevel > entry.bestCompleted.level
    ) {
      entry.bestCompleted = {
        level: rm.run.keystoneLevel,
        characterId: rm.characterId,
      };
    }
    dungeonMap.set(rm.run.dungeonId, entry);
  }

  const toDungeonRef = (
    pick: DungeonAggregate["bestCompleted"],
  ): DashboardDungeonBreakdown["bestKeyCompleted"] => {
    if (!pick) return null;
    const char = characterMap.get(pick.characterId);
    return {
      level: pick.level,
      characterName: char?.name ?? "Unknown",
      characterClass: char?.class ?? "warrior",
    };
  };

  const dungeonBreakdown: DashboardDungeonBreakdown[] = Array.from(
    dungeonMap.values(),
  )
    .map((entry) => ({
      dungeonSlug: entry.dungeon.slug,
      dungeonName: entry.dungeon.name,
      dungeonShortCode: entry.dungeon.shortCode,
      bestKeyCompleted: toDungeonRef(entry.bestCompleted),
      bestKeyTimed: toDungeonRef(entry.bestTimed),
      fastestClearMs: entry.fastestClearMs,
      totalJuice: entry.totalJuice,
      timedCount: entry.timedCount,
    }))
    .sort((a, b) => b.totalJuice - a.totalJuice);

  // ── Recent runs (20) — stays in dashboard for backwards compat; full
  //    filter/pagination lives on /api/v1/users/:userId/runs. ──────────
  const recentRuns: DashboardRecentRun[] = memberRuns.slice(0, 20).map((rm) => {
    const char = characterMap.get(rm.characterId);
    return {
      id: rm.run.id,
      dungeonName: rm.run.dungeon.name,
      dungeonSlug: rm.run.dungeon.slug,
      level: rm.run.keystoneLevel,
      onTime: rm.run.onTime,
      upgrades: rm.run.upgrades,
      deaths: rm.run.deaths,
      juice: rm.run.personalJuice,
      recordedAt: rm.run.recordedAt.toISOString(),
      characterName: char?.name ?? "Unknown",
      characterClass: char?.class ?? "warrior",
      roleSnapshot: rm.roleSnapshot,
    };
  });

  // ── Chart data ────────────────────────────────────────────
  const weekMap = new Map<string, { label: string; count: number }>();
  for (const rm of memberRuns) {
    const key = getISOWeekKey(rm.run.recordedAt);
    const entry = weekMap.get(key) ?? {
      label: getISOWeekLabel(rm.run.recordedAt),
      count: 0,
    };
    entry.count++;
    weekMap.set(key, entry);
  }

  const runsPerWeek = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ week: v.label, count: v.count }));

  const keyProgression = memberRuns
    .slice()
    .reverse() // oldest first for chart
    .map((rm) => {
      const char = characterMap.get(rm.characterId);
      return {
        date: rm.run.recordedAt.toISOString().slice(0, 10),
        level: rm.run.keystoneLevel,
        characterName: char?.name ?? "Unknown",
        characterClass: char?.class ?? "warrior",
      };
    });

  const [endorsements, tokenBalance] = await Promise.all([
    getEndorsementSummaryForUser(userId),
    getTokenBalance(userId),
  ]);

  return {
    overview,
    characters: dashCharacters,
    roleBreakdown,
    dungeonBreakdown,
    recentRuns,
    chartData: { runsPerWeek, keyProgression },
    season: { slug: season.slug, name: season.name },
    endorsements,
    tokenBalance,
  };
}
