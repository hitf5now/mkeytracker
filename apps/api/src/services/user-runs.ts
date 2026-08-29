/**
 * Paginated, filterable run list scoped to one user.
 *
 * Powers the Runs tab on the user dashboard — returns a page of runs across
 * all of the user's claimed characters, with optional filters for character,
 * dungeon, season, and a date-range preset. Always sorted by recordedAt DESC.
 *
 * Season and date range are independent axes. They used to be tangled: the
 * query was hard-scoped to the active season while offering an "All time"
 * range, so a user's previous-season runs were unreachable no matter which
 * range they picked. Season now selects *which* season (or all of them) and
 * range narrows *within* that.
 */

import { prisma } from "../lib/prisma.js";
import { resolveSeasonParam } from "./seasons.js";

export type UserRunsRange = "7d" | "30d" | "all";

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
  /** Season the list is scoped to, or null when spanning every season. */
  season: { slug: string; name: string } | null;
  /** Characters the user has — used to populate the character filter dropdown. */
  filterCharacters: UserRunsFilterOption<number>[];
  /** Dungeons the user has run in the selected scope — for the dungeon dropdown. */
  filterDungeons: UserRunsFilterOption<number>[];
}

export interface UserRunsQuery {
  userId: number;
  characterId?: number;
  dungeonId?: number;
  /** Season slug, id, or "all". Omit for the active season. */
  season?: string;
  range: UserRunsRange;
  limit: number;
  offset: number;
}

function rangeStart(range: UserRunsRange): Date | null {
  const now = Date.now();
  if (range === "7d") return new Date(now - 7 * 24 * 3600 * 1000);
  if (range === "30d") return new Date(now - 30 * 24 * 3600 * 1000);
  return null;
}

export async function getUserRuns(q: UserRunsQuery): Promise<UserRunsResult | null> {
  const resolved = await resolveSeasonParam(prisma, q.season);
  if (!resolved) return null;
  const season = resolved.season;
  const seasonFilter = season ? { seasonId: season.id } : {};
  const seasonRef = season ? { slug: season.slug, name: season.name } : null;

  const characters = await prisma.character.findMany({
    where: { userId: q.userId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, realm: true, class: true },
  });
  const characterIds = characters.map((c) => c.id);

  if (characterIds.length === 0) {
    return {
      runs: [],
      total: 0,
      limit: q.limit,
      offset: q.offset,
      season: seasonRef,
      filterCharacters: [],
      filterDungeons: [],
    };
  }

  const characterMap = new Map(characters.map((c) => [c.id, c]));
  const filterCharacters = characters.map((c) => ({
    id: c.id,
    label: c.name,
  }));

  // Constrain character filter to one the user actually owns.
  const characterFilter =
    q.characterId && characterIds.includes(q.characterId)
      ? [q.characterId]
      : characterIds;

  const since = rangeStart(q.range);

  const where = {
    characterId: { in: characterFilter },
    run: {
      ...seasonFilter,
      ...(q.dungeonId ? { dungeonId: q.dungeonId } : {}),
      ...(since ? { recordedAt: { gte: since } } : {}),
    },
  };

  const [total, memberRuns, dungeonRows] = await Promise.all([
    prisma.runMember.count({ where }),
    prisma.runMember.findMany({
      where,
      include: { run: { include: { dungeon: true } } },
      orderBy: { run: { recordedAt: "desc" } },
      skip: q.offset,
      take: q.limit,
    }),
    // Populate the dungeon dropdown with the dungeons this user has actually
    // played in the selected scope (not every dungeon in the game).
    prisma.run.findMany({
      where: {
        ...seasonFilter,
        members: { some: { characterId: { in: characterIds } } },
      },
      select: { dungeonId: true, dungeon: { select: { name: true } } },
      distinct: ["dungeonId"],
    }),
  ]);

  const filterDungeons = dungeonRows
    .map((d) => ({ id: d.dungeonId, label: d.dungeon.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const runs: UserRunsListItem[] = memberRuns.map((rm) => {
    const char = characterMap.get(rm.characterId);
    return {
      id: rm.run.id,
      dungeonId: rm.run.dungeonId,
      dungeonName: rm.run.dungeon.name,
      dungeonSlug: rm.run.dungeon.slug,
      dungeonShortCode: rm.run.dungeon.shortCode,
      keystoneLevel: rm.run.keystoneLevel,
      completionMs: rm.run.completionMs,
      onTime: rm.run.onTime,
      upgrades: rm.run.upgrades,
      deaths: rm.run.deaths,
      juice: rm.run.personalJuice,
      recordedAt: rm.run.recordedAt.toISOString(),
      characterId: rm.characterId,
      characterName: char?.name ?? "Unknown",
      characterClass: char?.class ?? "warrior",
      roleSnapshot: rm.roleSnapshot,
    };
  });

  return {
    runs,
    total,
    limit: q.limit,
    offset: q.offset,
    season: seasonRef,
    filterCharacters,
    filterDungeons,
  };
}
