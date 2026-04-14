/**
 * User dashboard aggregation service.
 *
 * Loads all of a user's characters and their runs in the active season,
 * then aggregates into sections for the personal dashboard:
 *   - Overview stats (total runs, timed, Juice, etc.)
 *   - Per-character cards
 *   - Role breakdown (tank/healer/dps)
 *   - Dungeon breakdown (best key, fastest clear per dungeon)
 *   - Recent runs (across all characters)
 *   - Chart data (runs per week, key progression)
 */

import { prisma } from "../lib/prisma.js";

// ─── Types ───────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────

function getISOWeekLabel(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Thursday of current week determines the year/week
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7,
  );
  // Return the Monday of that week as a readable label
  const monday = new Date(date);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getISOWeekKey(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.toISOString().slice(0, 10);
}

// ─── Main function ───────────────────────────────────────────────

export async function getUserDashboard(userId: number): Promise<DashboardResult | null> {
  const season = await prisma.season.findFirst({ where: { isActive: true } });
  if (!season) return null;

  const characters = await prisma.character.findMany({
    where: { userId },
    orderBy: { rioScore: "desc" },
  });

  if (characters.length === 0) {
    return {
      overview: {
        totalRuns: 0, timedRuns: 0, depletedRuns: 0, totalDeaths: 0,
        highestKeyCompleted: 0, totalJuice: 0, weeklyJuice: 0, timedRate: 0,
      },
      characters: [],
      roleBreakdown: [],
      dungeonBreakdown: [],
      recentRuns: [],
      chartData: { runsPerWeek: [], keyProgression: [] },
      season: { slug: season.slug, name: season.name },
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
  const highestKeyCompleted = memberRuns
    .filter((rm) => rm.run.onTime)
    .reduce((max, rm) => Math.max(max, rm.run.keystoneLevel), 0);
  const totalJuice = memberRuns.reduce((sum, rm) => sum + rm.run.personalJuice, 0);
  const weeklyJuice = memberRuns
    .filter((rm) => rm.run.recordedAt >= oneWeekAgo)
    .reduce((sum, rm) => sum + rm.run.personalJuice, 0);
  const timedRate = totalRuns > 0 ? Math.round((timedRuns / totalRuns) * 100) : 0;

  const overview: DashboardOverview = {
    totalRuns, timedRuns, depletedRuns, totalDeaths,
    highestKeyCompleted, totalJuice, weeklyJuice, timedRate,
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
  const roleMap = new Map<string, { totalRuns: number; timedRuns: number; bestKey: number; totalJuice: number }>();
  for (const rm of memberRuns) {
    const role = rm.roleSnapshot || "dps";
    const entry = roleMap.get(role) ?? { totalRuns: 0, timedRuns: 0, bestKey: 0, totalJuice: 0 };
    entry.totalRuns++;
    if (rm.run.onTime) {
      entry.timedRuns++;
      entry.bestKey = Math.max(entry.bestKey, rm.run.keystoneLevel);
    }
    entry.totalJuice += rm.run.personalJuice;
    roleMap.set(role, entry);
  }

  const roleBreakdown: DashboardRoleBreakdown[] = ["tank", "healer", "dps"]
    .map((role) => ({
      role,
      ...(roleMap.get(role) ?? { totalRuns: 0, timedRuns: 0, bestKey: 0, totalJuice: 0 }),
    }));

  // ── Dungeon breakdown ─────────────────────────────────────
  const dungeonMap = new Map<number, {
    dungeon: { slug: string; name: string; shortCode: string };
    bestKeyLevel: number;
    fastestClearMs: number | null;
    totalJuice: number;
    timedCount: number;
    bestRunJuice: number;
    bestCharId: number;
  }>();

  for (const rm of memberRuns) {
    const d = rm.run.dungeon;
    const entry = dungeonMap.get(rm.run.dungeonId) ?? {
      dungeon: { slug: d.slug, name: d.name, shortCode: d.shortCode },
      bestKeyLevel: 0, fastestClearMs: null, totalJuice: 0, timedCount: 0,
      bestRunJuice: 0, bestCharId: rm.characterId,
    };

    entry.totalJuice += rm.run.personalJuice;
    if (rm.run.onTime) {
      entry.timedCount++;
      entry.bestKeyLevel = Math.max(entry.bestKeyLevel, rm.run.keystoneLevel);
      if (entry.fastestClearMs === null || rm.run.completionMs < entry.fastestClearMs) {
        entry.fastestClearMs = rm.run.completionMs;
      }
    }
    if (rm.run.personalJuice > entry.bestRunJuice) {
      entry.bestRunJuice = rm.run.personalJuice;
      entry.bestCharId = rm.characterId;
    }
    dungeonMap.set(rm.run.dungeonId, entry);
  }

  const dungeonBreakdown: DashboardDungeonBreakdown[] = Array.from(dungeonMap.values())
    .map((entry) => {
      const bestChar = characterMap.get(entry.bestCharId);
      return {
        dungeonSlug: entry.dungeon.slug,
        dungeonName: entry.dungeon.name,
        dungeonShortCode: entry.dungeon.shortCode,
        bestKeyLevel: entry.bestKeyLevel,
        fastestClearMs: entry.fastestClearMs,
        totalJuice: entry.totalJuice,
        timedCount: entry.timedCount,
        bestCharacterName: bestChar?.name ?? "Unknown",
        bestCharacterClass: bestChar?.class ?? "warrior",
      };
    })
    .sort((a, b) => b.totalJuice - a.totalJuice);

  // ── Recent runs (20) ──────────────────────────────────────
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
    const entry = weekMap.get(key) ?? { label: getISOWeekLabel(rm.run.recordedAt), count: 0 };
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

  return {
    overview,
    characters: dashCharacters,
    roleBreakdown,
    dungeonBreakdown,
    recentRuns,
    chartData: { runsPerWeek, keyProgression },
    season: { slug: season.slug, name: season.name },
  };
}
