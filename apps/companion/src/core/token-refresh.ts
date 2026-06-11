/**
 * Companion JWT auto-renewal.
 *
 * Tokens from the pairing flow live 30 days. Rather than letting them
 * lapse (which silently 401s every run submission), the companion
 * renews via POST /auth/refresh whenever the stored token is inside
 * the renewal window — including already past expiry, because the API
 * grants a grace window where an expired-but-signature-valid token can
 * still be swapped for a fresh one.
 *
 * Called from three places:
 *   - app startup
 *   - a long setInterval (covers companions idling in the tray)
 *   - the start of every queue tick (just-in-time before submission)
 *
 * If the API definitively rejects the token (`token_too_old`,
 * `invalid_token`, `user_not_found`), renewal can never succeed, so we
 * unpair — clearing the JWT and flagging onboarding — to surface the
 * re-pair wizard instead of failing silently forever. Network errors
 * and 5xx leave the config untouched and we just try again later.
 */

import { CompanionApiClient, CompanionApiError } from "./api-client.js";
import { loadConfig, updateConfig } from "./config.js";

/** Renew when less than this much lifetime remains (or already expired). */
export const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Error codes from /auth/refresh that mean "this token will never work". */
const TERMINAL_REFRESH_CODES = new Set([
  "token_too_old",
  "invalid_token",
  "invalid_jwt_subject",
  "user_not_found",
]);

/** Minimal logger shape — compatible with console and fileLogger. */
interface LoggerLike {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export type RefreshOutcome =
  | "not-paired"
  | "not-due"
  | "refreshed"
  | "unpaired"
  | "deferred";

/**
 * Pure check: does this jwt/expiry pair need a refresh attempt at `now`?
 * A paired config with no stored expiry counts as due — it predates the
 * expiry field and we can't know how much life it has left.
 */
export function isRefreshDue(
  jwt: string | null,
  jwtExpiresAt: string | null,
  now: number,
): boolean {
  if (!jwt) return false;
  if (!jwtExpiresAt) return true;
  const expMs = Date.parse(jwtExpiresAt);
  if (Number.isNaN(expMs)) return true;
  return expMs - now < REFRESH_WINDOW_MS;
}

/**
 * Renew the stored JWT if it's inside the renewal window.
 * Safe to call often — exits immediately when nothing is due.
 */
export async function maybeRefreshToken(log: LoggerLike): Promise<RefreshOutcome> {
  const cfg = loadConfig();
  if (!cfg.jwt) return "not-paired";
  if (!isRefreshDue(cfg.jwt, cfg.jwtExpiresAt, Date.now())) return "not-due";

  const client = new CompanionApiClient(cfg.apiBaseUrl, cfg.jwt);
  try {
    const result = await client.refreshToken();
    updateConfig({ jwt: result.token, jwtExpiresAt: result.expiresAt });
    log.log(`[token-refresh] renewed JWT — now expires ${result.expiresAt}`);
    return "refreshed";
  } catch (err) {
    if (err instanceof CompanionApiError && TERMINAL_REFRESH_CODES.has(err.code)) {
      log.warn(
        `[token-refresh] token rejected (${err.code}) — unpairing, user must run /link again`,
      );
      updateConfig({ jwt: null, jwtExpiresAt: null, onboarded: false });
      return "unpaired";
    }
    // Transient (network, 5xx, unknown) — keep the token, retry later.
    log.warn(
      `[token-refresh] refresh attempt failed, will retry: ${err instanceof Error ? err.message : String(err)}`,
    );
    return "deferred";
  }
}
