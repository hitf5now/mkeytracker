/**
 * Paginated, filterable run list scoped to one user.
 *
 * Powers the Runs tab on the user dashboard — returns a page of runs across
 * all of the user's claimed characters, with optional filters for character,
 * dungeon, and a date-range preset. Always sorted by recordedAt DESC.
 */

import { prisma } from "../lib/prisma.js";

export type UserRunsRange = "7d" | "30d" | "season" | "all";

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
  season: { slug: string; name: string };
  /** Characters the user has — used to populate the character filter dropdown. */
  filterCharacters: UserRunsFilterOption<number>[];
  /** Dungeons with at least one run this season — for the dungeon dropdown. */
  filterDungeons: UserRunsFilterOption<number>[];
}

export interface UserRunsQuery {
  userId: number;
  characterId?: number;
  dungeonId?: number;
  range: UserRunsRange;
  limit: number;
  offset: number;
}

function rangeStart(range: UserRunsRange, seasonStartsAt: Date): Date | null {
  const now = Date.now();
  if (range === "7d") return new Date(now - 7 * 24 * 3600 * 1000);
  if (range === "30d") return new Date(now - 30 * 24 * 3600 * 1000);
  if (range === "season") return seasonStartsAt;
  return null;
}

export async function getUserRuns(q: UserRunsQuery): Promise<UserRunsResult | null> {
  const season = await prisma.season.findFirst({ where: { isActive: true } });
  if (!season) return null;

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
      season: { slug: season.slug, name: season.name },
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

  const since = rangeStart(q.range, season.startsAt);

  const where = {
    characterId: { in: characterFilter },
    run: {
      seasonId: season.id,
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
    // played in the active season (not every dungeon in the game).
    prisma.run.findMany({
      where: {
        seasonId: season.id,
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
    season: { slug: season.slug, name: season.name },
    filterCharacters,
    filterDungeons,
  };
}
