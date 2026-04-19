/**
 * Endorsement token economy.
 *
 * Two separate balance pools on User:
 *   - seasonalTokensRemaining: earned from Personal Juice at 1 per 15,000.
 *     Zeroes out at season rollover (use-it-or-lose-it).
 *   - starterTokensRemaining:  one-time grants (Discord login, companion
 *     link). Persists across seasons until spent.
 *
 * Spend order: seasonal first, then starter. That way long-lived starter
 * tokens only drain when the player has exhausted everything they earned
 * this season — matches the "lifetime gift" framing.
 *
 * Idempotency:
 *   - grantStarterDiscord / grantStarterCompanion use boolean flags on
 *     User so repeated calls (re-login, re-link) are no-ops.
 *   - grantJuiceTokens is formula-driven:
 *       tokensOwed = floor(lifetimeJuiceEarned / TOKEN_COST_JUICE)
 *     We persist how many we've already minted (tokensGrantedFromJuice)
 *     and only mint the delta. Even if called twice with the same juice
 *     increment, the second call mints zero tokens.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/prisma.js";

/** Juice required to earn one endorsement token. */
export const TOKEN_COST_JUICE = 15_000;

/** One-time starter grant sizes. */
export const STARTER_GRANT_DISCORD = 1;
export const STARTER_GRANT_COMPANION = 1;

/** Accept either the singleton client or a transaction client. */
type Client = PrismaClient | Prisma.TransactionClient;

export interface TokenBalance {
  seasonalTokensRemaining: number;
  starterTokensRemaining: number;
  total: number;
  /** Lifetime Personal Juice earned (drives token minting). */
  lifetimeJuiceEarned: number;
  /** Juice already "spent" toward minted tokens (tokensGrantedFromJuice × 15,000). */
  juiceConsumedByTokens: number;
  /** Juice accumulated within the current not-yet-minted token. 0..TOKEN_COST_JUICE-1. */
  juiceTowardNextToken: number;
  /** Juice still required to mint the next token. */
  juiceToNextToken: number;
  /** Same as TOKEN_COST_JUICE, echoed for client convenience. */
  juicePerToken: number;
}

/**
 * Resolves the current active season id. Throws if none exists — a live
 * season is a platform invariant, not a recoverable state here.
 */
async function getActiveSeasonId(client: Client): Promise<number> {
  const season = await client.season.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (!season) {
    throw new Error("No active season — cannot operate on endorsement tokens");
  }
  return season.id;
}

/**
 * Grant tokens earned from a Personal Juice increment.
 *
 * Bumps lifetimeJuiceEarned, recomputes total-tokens-owed, and mints the
 * delta into seasonalTokensRemaining (rebinding to the current season if
 * the previous seasonal bucket was stale).
 *
 * Stale seasonal tokens are wiped as part of this call — if a player's
 * first action in a new season is earning more Juice, their old unspent
 * seasonal tokens expire at that moment.
 *
 * Returns the number of tokens newly minted (0 if the delta didn't cross
 * a 15,000 boundary).
 */
export async function grantJuiceTokens(
  userId: number,
  juiceDelta: number,
  client: Client = defaultPrisma,
): Promise<number> {
  if (juiceDelta <= 0) return 0;

  const activeSeasonId = await getActiveSeasonId(client);
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      lifetimeJuiceEarned: true,
      tokensGrantedFromJuice: true,
      seasonalTokensRemaining: true,
      seasonalTokensSeasonId: true,
    },
  });
  if (!user) return 0;

  const newLifetime = user.lifetimeJuiceEarned + juiceDelta;
  const totalOwed = Math.floor(newLifetime / TOKEN_COST_JUICE);
  const newlyMinted = Math.max(0, totalOwed - user.tokensGrantedFromJuice);

  // Stale seasonal bucket? Wipe it before we add anything new.
  const staleSeasonalBucket =
    user.seasonalTokensSeasonId !== null &&
    user.seasonalTokensSeasonId !== activeSeasonId;
  const nextSeasonalRemaining = staleSeasonalBucket
    ? newlyMinted
    : user.seasonalTokensRemaining + newlyMinted;

  await client.user.update({
    where: { id: userId },
    data: {
      lifetimeJuiceEarned: newLifetime,
      tokensGrantedFromJuice: user.tokensGrantedFromJuice + newlyMinted,
      seasonalTokensRemaining: nextSeasonalRemaining,
      seasonalTokensSeasonId: activeSeasonId,
    },
  });

  return newlyMinted;
}

/**
 * Idempotent starter grant: Discord login. Awards STARTER_GRANT_DISCORD
 * tokens the first time it's called for a user; subsequent calls no-op.
 * Returns tokens granted (0 if already claimed).
 */
export async function grantStarterDiscord(
  userId: number,
  client: Client = defaultPrisma,
): Promise<number> {
  const result = await client.user.updateMany({
    where: { id: userId, starterDiscordGranted: false },
    data: {
      starterDiscordGranted: true,
      starterTokensRemaining: { increment: STARTER_GRANT_DISCORD },
    },
  });
  return result.count > 0 ? STARTER_GRANT_DISCORD : 0;
}

/**
 * Idempotent starter grant: first companion-app link. Awards
 * STARTER_GRANT_COMPANION tokens on first call only.
 */
export async function grantStarterCompanion(
  userId: number,
  client: Client = defaultPrisma,
): Promise<number> {
  const result = await client.user.updateMany({
    where: { id: userId, starterCompanionGranted: false },
    data: {
      starterCompanionGranted: true,
      starterTokensRemaining: { increment: STARTER_GRANT_COMPANION },
    },
  });
  return result.count > 0 ? STARTER_GRANT_COMPANION : 0;
}

/**
 * Current spendable balance for a user. Applies season-rollover logic
 * lazily: if the seasonal bucket is tagged to a past season, it's
 * reported as 0 (and would be wiped on the next grant/spend).
 */
export async function getTokenBalance(
  userId: number,
  client: Client = defaultPrisma,
): Promise<TokenBalance> {
  const activeSeasonId = await getActiveSeasonId(client);
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      seasonalTokensRemaining: true,
      seasonalTokensSeasonId: true,
      starterTokensRemaining: true,
      lifetimeJuiceEarned: true,
      tokensGrantedFromJuice: true,
    },
  });
  if (!user) {
    return {
      seasonalTokensRemaining: 0,
      starterTokensRemaining: 0,
      total: 0,
      lifetimeJuiceEarned: 0,
      juiceConsumedByTokens: 0,
      juiceTowardNextToken: 0,
      juiceToNextToken: TOKEN_COST_JUICE,
      juicePerToken: TOKEN_COST_JUICE,
    };
  }
  const seasonal =
    user.seasonalTokensSeasonId === activeSeasonId
      ? user.seasonalTokensRemaining
      : 0;
  const juiceConsumedByTokens = user.tokensGrantedFromJuice * TOKEN_COST_JUICE;
  const juiceTowardNextToken = Math.max(
    0,
    user.lifetimeJuiceEarned - juiceConsumedByTokens,
  );
  const juiceToNextToken = Math.max(0, TOKEN_COST_JUICE - juiceTowardNextToken);
  return {
    seasonalTokensRemaining: seasonal,
    starterTokensRemaining: user.starterTokensRemaining,
    total: seasonal + user.starterTokensRemaining,
    lifetimeJuiceEarned: user.lifetimeJuiceEarned,
    juiceConsumedByTokens,
    juiceTowardNextToken,
    juiceToNextToken,
    juicePerToken: TOKEN_COST_JUICE,
  };
}

/**
 * Spend one token. Tries seasonal first, falls back to starter. Also
 * wipes a stale seasonal bucket as a side effect if encountered.
 *
 * Returns true if spent, false if the user has no tokens. Use inside the
 * same transaction as the endorsement insert so concurrent spends can't
 * race past a zero balance.
 */
export async function spendToken(
  userId: number,
  client: Client = defaultPrisma,
): Promise<boolean> {
  const activeSeasonId = await getActiveSeasonId(client);

  // Try seasonal (current-season bucket only).
  const seasonalSpent = await client.user.updateMany({
    where: {
      id: userId,
      seasonalTokensSeasonId: activeSeasonId,
      seasonalTokensRemaining: { gt: 0 },
    },
    data: {
      seasonalTokensRemaining: { decrement: 1 },
    },
  });
  if (seasonalSpent.count > 0) return true;

  // Wipe stale seasonal bucket if present (so the next grant starts clean).
  await client.user.updateMany({
    where: {
      id: userId,
      seasonalTokensSeasonId: { not: activeSeasonId },
      seasonalTokensRemaining: { gt: 0 },
    },
    data: {
      seasonalTokensRemaining: 0,
      seasonalTokensSeasonId: activeSeasonId,
    },
  });

  // Fall back to starter.
  const starterSpent = await client.user.updateMany({
    where: { id: userId, starterTokensRemaining: { gt: 0 } },
    data: { starterTokensRemaining: { decrement: 1 } },
  });
  return starterSpent.count > 0;
}
