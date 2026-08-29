/**
 * Season service — reads and writes for the `seasons` / `dungeons` tables.
 *
 * One code path writes seasons and their dungeon pools, used by both:
 *   - `prisma/seed.ts` (bootstrap / manual correction from dungeons.json)
 *   - `services/season-sync.ts` (automated rollover from upstream APIs)
 *
 * Keeping them together means a season created by the nightly sync is
 * shaped identically to one created by the seed — no drift between the
 * "automatic" and "manual" paths.
 */

import type { PrismaClient } from "@prisma/client";

export interface DungeonInput {
  challengeModeId: number;
  slug: string;
  name: string;
  shortCode: string;
  parTimeSec: number;
}

export interface SeasonInput {
  slug: string;
  name: string;
  patch: string;
  startsAt: string | Date;
  endsAt?: string | Date | null;
  /**
   * Seed value only — applied when the row is first created. Changing which
   * season is active on an existing row goes through `activateSeason`.
   */
  isActive: boolean;
  /** Raider.IO season slug, e.g. "season-mn-2". */
  externalSlug?: string | null;
  /** Blizzard mythic-keystone season id, e.g. 18. */
  wowSeasonId?: number | null;
  /** Expansion display name, e.g. "Midnight". Groups seasons in pickers. */
  expansion?: string | null;
  /** Ordinal within the expansion, e.g. 2 for "Midnight Season 2". */
  seasonNumber?: number | null;
  dungeons: DungeonInput[];
}

export interface SeasonUpsertResult {
  seasonId: number;
  slug: string;
  created: boolean;
  dungeonsUpserted: number;
  dungeonsRemoved: number;
}

/**
 * Create or update one season and reconcile its dungeon pool.
 *
 * Dungeons are matched on (seasonId, slug). Any dungeon row belonging to
 * this season that is *not* in `input.dungeons` is removed — but only when
 * it has no runs or events attached, so historical data is never orphaned.
 */
export async function upsertSeason(
  prisma: PrismaClient,
  input: SeasonInput,
): Promise<SeasonUpsertResult> {
  const existing = await prisma.season.findUnique({ where: { slug: input.slug } });

  const scalars = {
    name: input.name,
    patch: input.patch,
    startsAt: new Date(input.startsAt),
    endsAt: input.endsAt == null ? null : new Date(input.endsAt),
    externalSlug: input.externalSlug ?? null,
    wowSeasonId: input.wowSeasonId ?? null,
    expansion: input.expansion ?? null,
    seasonNumber: input.seasonNumber ?? null,
  };

  // `isActive` is deliberately absent from the update: which season is active
  // is owned solely by `activateSeason`. The sync refreshes season metadata on
  // every tick and passes isActive:false to mean "not my decision" — writing
  // that through here would deactivate the live season on the next poll.
  const season = await prisma.season.upsert({
    where: { slug: input.slug },
    create: { slug: input.slug, isActive: input.isActive, ...scalars },
    update: scalars,
  });

  for (const d of input.dungeons) {
    await prisma.dungeon.upsert({
      where: { seasonId_slug: { seasonId: season.id, slug: d.slug } },
      create: {
        seasonId: season.id,
        slug: d.slug,
        challengeModeId: d.challengeModeId,
        name: d.name,
        shortCode: d.shortCode,
        parTimeSec: d.parTimeSec,
      },
      update: {
        challengeModeId: d.challengeModeId,
        name: d.name,
        shortCode: d.shortCode,
        parTimeSec: d.parTimeSec,
      },
    });
  }

  // Prune dungeons that upstream dropped from the pool — but never one that
  // already has runs or events pointing at it.
  const keep = new Set(input.dungeons.map((d) => d.slug));
  const stale = await prisma.dungeon.findMany({
    where: { seasonId: season.id, slug: { notIn: [...keep] } },
    include: { _count: { select: { runs: true, events: true } } },
  });
  let dungeonsRemoved = 0;
  for (const d of stale) {
    if (d._count.runs > 0 || d._count.events > 0) continue;
    await prisma.dungeon.delete({ where: { id: d.id } });
    dungeonsRemoved++;
  }

  return {
    seasonId: season.id,
    slug: season.slug,
    created: existing === null,
    dungeonsUpserted: input.dungeons.length,
    dungeonsRemoved,
  };
}

/**
 * Make exactly one season active, deactivating every other.
 * Also closes out the previous season's `endsAt` if it was left open.
 */
export async function activateSeason(
  prisma: PrismaClient,
  seasonId: number,
): Promise<void> {
  const target = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });

  // Any previously-active season that never got an end date ends where this
  // one begins, so timestamp-based lookups have no gap between seasons.
  await prisma.season.updateMany({
    where: { isActive: true, id: { not: seasonId }, endsAt: null },
    data: { endsAt: target.startsAt },
  });
  await prisma.season.updateMany({
    where: { id: { not: seasonId } },
    data: { isActive: false },
  });
  await prisma.season.update({ where: { id: seasonId }, data: { isActive: true } });
}

/**
 * Resolve which season a run belongs to from the moment it was completed.
 *
 * Runs do not always arrive during the season they were played in: the addon
 * queues them in SavedVariables and the companion flushes on `/reload`, so a
 * run can surface days later — including after a season rollover. Resolving
 * by `serverTime` rather than by "whatever season is active right now" keeps
 * a late-arriving run attached to its real season, and means its dungeon is
 * looked up in the pool that was actually live when it was played.
 *
 * Falls back to the active season when the timestamp lands outside every
 * known window (a run from before the first seeded season, or a gap between
 * seasons), so submission never hard-fails on a bookkeeping hole.
 */
export async function resolveSeasonAt(
  prisma: PrismaClient,
  serverTimeSec: number | bigint,
): Promise<{ id: number; slug: string; matchedByTime: boolean } | null> {
  const at = new Date(Number(serverTimeSec) * 1000);

  const byTime = await prisma.season.findFirst({
    where: {
      startsAt: { lte: at },
      OR: [{ endsAt: null }, { endsAt: { gt: at } }],
    },
    orderBy: { startsAt: "desc" },
    select: { id: true, slug: true },
  });
  if (byTime) return { ...byTime, matchedByTime: true };

  const active = await prisma.season.findFirst({
    where: { isActive: true },
    select: { id: true, slug: true },
  });
  return active ? { ...active, matchedByTime: false } : null;
}

/**
 * How a caller asked for a season, and what that resolves to.
 *
 * `null` season means "every season" — the caller asked for `all`, so
 * queries should apply no season filter at all rather than falling back to
 * the active one.
 */
export interface ResolvedSeasonParam {
  season: { id: number; slug: string; name: string } | null;
  /** True when the caller explicitly asked to span every season. */
  isAll: boolean;
}

/**
 * Resolve the `?season=` query parameter used across the public API.
 *
 * Accepts a slug (`midnight-s2`), a numeric id (`11`), the literal `all`,
 * or nothing at all — which means the active season. Slugs are what the
 * website puts in URLs because they survive a database restore and read
 * sensibly in a shared link; numeric ids stay supported so older clients
 * and hand-written calls keep working.
 *
 * Returns `undefined` when the caller named a season that doesn't exist,
 * so routes can answer 404 rather than silently showing the wrong data.
 */
export async function resolveSeasonParam(
  prisma: PrismaClient,
  raw: string | undefined,
): Promise<ResolvedSeasonParam | undefined> {
  const select = { id: true, slug: true, name: true } as const;

  if (raw === "all") return { season: null, isAll: true };

  if (raw !== undefined && raw !== "" && raw !== "current") {
    const asId = /^\d+$/.test(raw) ? Number(raw) : null;
    const season = await prisma.season.findFirst({
      where: asId !== null ? { id: asId } : { slug: raw },
      select,
    });
    return season ? { season, isAll: false } : undefined;
  }

  const active = await prisma.season.findFirst({ where: { isActive: true }, select });
  return active ? { season: active, isAll: false } : undefined;
}

/** One season as the website's season picker needs it. */
export interface SeasonOption {
  id: number;
  slug: string;
  name: string;
  /** Expansion display name, or null for seasons predating the grouping. */
  expansion: string | null;
  seasonNumber: number | null;
  /** Label to show once the expansion is already the group heading. */
  shortLabel: string;
  isActive: boolean;
  startsAt: Date;
  endsAt: Date | null;
  runCount: number;
}

/**
 * Every season, newest first, shaped for the picker.
 *
 * Seasons with no runs are still included: an admin seeding next season
 * ahead of time should be able to see it, and hiding it would make the
 * list silently disagree with what the API accepts.
 */
export async function listSeasonOptions(prisma: PrismaClient): Promise<SeasonOption[]> {
  const rows = await prisma.season.findMany({
    orderBy: { startsAt: "desc" },
    select: {
      id: true,
      slug: true,
      name: true,
      expansion: true,
      seasonNumber: true,
      isActive: true,
      startsAt: true,
      endsAt: true,
      _count: { select: { runs: true } },
    },
  });

  return rows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    expansion: s.expansion,
    seasonNumber: s.seasonNumber,
    // Inside an expansion group the expansion name is redundant, so prefer
    // "Season 2". Without a number there's nothing better than the full name.
    shortLabel: s.seasonNumber !== null ? `Season ${s.seasonNumber}` : s.name,
    isActive: s.isActive,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    runCount: s._count.runs,
  }));
}
