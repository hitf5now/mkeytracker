/**
 * Refresh-eligibility rules for /auth/refresh.
 *
 * Kept separate from jwt-auth.ts (which imports the env loader) so the
 * logic stays importable from unit tests without a configured
 * environment.
 */

/**
 * How long past expiry a token is still accepted by /auth/refresh.
 * Within this window the companion can silently renew; beyond it the
 * user must re-pair with /link. The signature must still verify — the
 * grace only relaxes the `exp` claim.
 */
export const REFRESH_GRACE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Is a token with this `exp` claim eligible for refresh at `nowSeconds`?
 * Eligible = not yet expired, or expired less than REFRESH_GRACE_SECONDS ago.
 * Tokens without a numeric `exp` are never eligible.
 */
export function isRefreshEligible(exp: unknown, nowSeconds: number): boolean {
  if (typeof exp !== "number" || !Number.isFinite(exp)) return false;
  return nowSeconds - exp <= REFRESH_GRACE_SECONDS;
}
