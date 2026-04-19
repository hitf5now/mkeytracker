/**
 * Endorsement aggregation queries for profile/dashboard surfaces.
 *
 * Lifetime counts (persistent) + current-season counts + per-category
 * breakdown + recent feed + favorite-endorsement resolution.
 *
 * Unscoped to any per-request auth context — callers are responsible
 * for deciding which view to render publicly.
 */

import { prisma } from "../lib/prisma.js";
import type { EndorsementCategory } from "@prisma/client";

export interface EndorsementListItem {
  id: number;
  runId: number;
  category: EndorsementCategory;
  note: string | null;
  createdAt: string;
  giverDiscordId: string;
  giverUserId: number;
}

export interface EndorsementSummary {
  totalReceived: number;
  seasonReceived: number;
  categoryBreakdown: Array<{ category: EndorsementCategory; count: number }>;
  recent: EndorsementListItem[];
  favorite: EndorsementListItem | null;
}

const RECENT_LIMIT = 10;

/**
 * Full endorsement summary for a user. Returns zeroes/nulls for a user
 * who has never received an endorsement.
 *
 * Scopes "seasonReceived" to the active season when one exists.
 */
export async function getEndorsementSummaryForUser(
  userId: number,
): Promise<EndorsementSummary> {
  const [user, activeSeason] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { favoriteEndorsementId: true },
    }),
    prisma.season.findFirst({
      where: { isActive: true },
      select: { id: true },
    }),
  ]);
  if (!user) {
    return emptySummary();
  }

  // Use parallel count-style queries rather than one mega-query; Prisma's
  // groupBy is cleaner than raw SQL and the volume is tiny (<<1k rows per
  // user at any foreseeable scale).
  const [totalReceived, seasonReceived, breakdownRaw, recentRaw, favoriteRaw] =
    await Promise.all([
      prisma.endorsement.count({ where: { receiverId: userId } }),
      activeSeason
        ? prisma.endorsement.count({
            where: { receiverId: userId, seasonId: activeSeason.id },
          })
        : Promise.resolve(0),
      prisma.endorsement.groupBy({
        by: ["category"],
        where: { receiverId: userId },
        _count: { category: true },
      }),
      prisma.endorsement.findMany({
        where: { receiverId: userId },
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
        include: {
          giver: { select: { id: true, discordId: true } },
        },
      }),
      user.favoriteEndorsementId !== null
        ? prisma.endorsement.findUnique({
            where: { id: user.favoriteEndorsementId },
            include: {
              giver: { select: { id: true, discordId: true } },
            },
          })
        : Promise.resolve(null),
    ]);

  const categoryBreakdown = breakdownRaw
    .map((r) => ({ category: r.category, count: r._count.category }))
    .sort((a, b) => b.count - a.count);

  const recent = recentRaw.map(toListItem);
  const favorite =
    favoriteRaw && favoriteRaw.receiverId === userId
      ? toListItem(favoriteRaw)
      : null;

  return {
    totalReceived,
    seasonReceived,
    categoryBreakdown,
    recent,
    favorite,
  };
}

function emptySummary(): EndorsementSummary {
  return {
    totalReceived: 0,
    seasonReceived: 0,
    categoryBreakdown: [],
    recent: [],
    favorite: null,
  };
}

function toListItem(
  row: {
    id: number;
    runId: number;
    category: EndorsementCategory;
    note: string | null;
    createdAt: Date;
    giver: { id: number; discordId: string };
  },
): EndorsementListItem {
  return {
    id: row.id,
    runId: row.runId,
    category: row.category,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    giverDiscordId: row.giver.discordId,
    giverUserId: row.giver.id,
  };
}

/**
 * Set or clear a user's pinned favorite endorsement.
 *
 * If `endorsementId` is null, clears the favorite. Otherwise, validates
 * the endorsement belongs to the user (as receiver) before setting it.
 * Returns true on success, false if the endorsement doesn't belong to
 * the user (or doesn't exist).
 */
export async function setFavoriteEndorsement(
  userId: number,
  endorsementId: number | null,
): Promise<boolean> {
  if (endorsementId === null) {
    await prisma.user.update({
      where: { id: userId },
      data: { favoriteEndorsementId: null },
    });
    return true;
  }

  const endorsement = await prisma.endorsement.findUnique({
    where: { id: endorsementId },
    select: { id: true, receiverId: true },
  });
  if (!endorsement || endorsement.receiverId !== userId) {
    return false;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { favoriteEndorsementId: endorsement.id },
  });
  return true;
}
