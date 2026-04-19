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

/** Sent endorsement — keys the "other party" as receiver rather than giver. */
export interface SentEndorsementListItem {
  id: number;
  runId: number;
  category: EndorsementCategory;
  note: string | null;
  createdAt: string;
  receiverUserId: number;
  receiverDiscordId: string;
  /** The specific character the endorsement was attached to (if any). */
  receiverCharacterId: number | null;
  receiverCharacterName: string | null;
}

export interface EndorsementSummary {
  totalReceived: number;
  seasonReceived: number;
  categoryBreakdown: Array<{ category: EndorsementCategory; count: number }>;
  recent: EndorsementListItem[];
  favorite: EndorsementListItem | null;
  /** Lifetime count of endorsements this user has GIVEN. */
  totalSent: number;
  /** Endorsements given in the active season. */
  seasonSent: number;
  /** Most recent endorsements given by this user. */
  sentRecent: SentEndorsementListItem[];
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
  const [
    totalReceived,
    seasonReceived,
    breakdownRaw,
    recentRaw,
    favoriteRaw,
    totalSent,
    seasonSent,
    sentRecentRaw,
  ] = await Promise.all([
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
    prisma.endorsement.count({ where: { giverId: userId } }),
    activeSeason
      ? prisma.endorsement.count({
          where: { giverId: userId, seasonId: activeSeason.id },
        })
      : Promise.resolve(0),
    prisma.endorsement.findMany({
      where: { giverId: userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
      include: {
        receiver: { select: { id: true, discordId: true } },
        receiverCharacter: { select: { id: true, name: true } },
      },
    }),
  ]);

  const categoryBreakdown = breakdownRaw
    .map((r) => ({ category: r.category, count: r._count.category }))
    .sort((a, b) => b.count - a.count);

  const recent = recentRaw.map(toListItem);
  const favorite =
    favoriteRaw && favoriteRaw.receiverId === userId
      ? toListItem(favoriteRaw)
      : null;
  const sentRecent = sentRecentRaw.map(toSentListItem);

  return {
    totalReceived,
    seasonReceived,
    categoryBreakdown,
    recent,
    favorite,
    totalSent,
    seasonSent,
    sentRecent,
  };
}

/**
 * Character-scoped endorsement summary. Used on the character profile
 * page and anywhere the view should be scoped to one specific character
 * rather than aggregated across the user's whole account.
 *
 * Favorite is only returned if the user's pinned favorite was received
 * on this exact character — otherwise null.
 */
export async function getEndorsementSummaryForCharacter(
  characterId: number,
): Promise<EndorsementSummary> {
  const [character, activeSeason] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        userId: true,
        user: { select: { favoriteEndorsementId: true } },
      },
    }),
    prisma.season.findFirst({
      where: { isActive: true },
      select: { id: true },
    }),
  ]);
  if (!character) {
    return emptySummary();
  }

  const favoriteId = character.user?.favoriteEndorsementId ?? null;

  const [totalReceived, seasonReceived, breakdownRaw, recentRaw, favoriteRaw] =
    await Promise.all([
      prisma.endorsement.count({ where: { receiverCharacterId: characterId } }),
      activeSeason
        ? prisma.endorsement.count({
            where: {
              receiverCharacterId: characterId,
              seasonId: activeSeason.id,
            },
          })
        : Promise.resolve(0),
      prisma.endorsement.groupBy({
        by: ["category"],
        where: { receiverCharacterId: characterId },
        _count: { category: true },
      }),
      prisma.endorsement.findMany({
        where: { receiverCharacterId: characterId },
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
        include: {
          giver: { select: { id: true, discordId: true } },
        },
      }),
      favoriteId !== null
        ? prisma.endorsement.findUnique({
            where: { id: favoriteId },
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
  // Only show the pinned favorite if it was received on THIS character;
  // otherwise it belongs on a different character's profile.
  const favorite =
    favoriteRaw && favoriteRaw.receiverCharacterId === characterId
      ? toListItem(favoriteRaw)
      : null;

  return {
    totalReceived,
    seasonReceived,
    categoryBreakdown,
    recent,
    favorite,
    // Sent-endorsement fields aren't meaningful at character scope — they're
    // per-user. The dashboard surface fills them; this view leaves them zeroed.
    totalSent: 0,
    seasonSent: 0,
    sentRecent: [],
  };
}

function emptySummary(): EndorsementSummary {
  return {
    totalReceived: 0,
    seasonReceived: 0,
    categoryBreakdown: [],
    recent: [],
    favorite: null,
    totalSent: 0,
    seasonSent: 0,
    sentRecent: [],
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

function toSentListItem(
  row: {
    id: number;
    runId: number;
    category: EndorsementCategory;
    note: string | null;
    createdAt: Date;
    receiver: { id: number; discordId: string };
    receiverCharacter: { id: number; name: string } | null;
  },
): SentEndorsementListItem {
  return {
    id: row.id,
    runId: row.runId,
    category: row.category,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    receiverUserId: row.receiver.id,
    receiverDiscordId: row.receiver.discordId,
    receiverCharacterId: row.receiverCharacter?.id ?? null,
    receiverCharacterName: row.receiverCharacter?.name ?? null,
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
