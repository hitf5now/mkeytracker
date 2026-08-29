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
