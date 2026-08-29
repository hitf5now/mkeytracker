/**
 * Companion-side API client.
 *
 * Unlike the bot's client, this one:
 *   - Uses a long-lived JWT (from the pairing flow) instead of a shared secret
 *   - Is run submission-focused — POST /runs is the hot path
 *   - Uses the no-auth /auth/link-exchange endpoint for initial pairing
 *
 * The base URL is read from the companion config so production vs local
 * is a config change, not a code change.
 */

import type { RunEnrichmentSubmission } from "@mplus/types";
import type { ParsedRun } from "./sv-parser.js";

export class CompanionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CompanionApiError";
  }
}

export interface LinkExchangeResponse {
  token: string;
  expiresAt: string;
  user: { id: number; discordId: string };
}

export interface RunSubmissionResponse {
  run: {
    id: number;
    juice: number;
    dungeonId: number;
    keystoneLevel: number;
  };
  deduplicated?: boolean;
  scoring?: {
    total: number;
  };
}

/**
 * The JWT can be a plain string or a getter. Pass a getter (e.g.
 * `() => loadConfig().jwt`) in long-lived contexts so a token renewed
 * by the auto-refresh flow is picked up without rebuilding the client.
 */
export type JwtSource = string | null | (() => string | null);

export class CompanionApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly jwtSource: JwtSource,
  ) {}

  private get jwt(): string | null {
    return typeof this.jwtSource === "function" ? this.jwtSource() : this.jwtSource;
  }

  /**
   * Swap a 6-digit pairing code for a long-lived JWT.
   * No auth required for this endpoint.
   */
  async exchangeLinkCode(code: string): Promise<LinkExchangeResponse> {
    return this.requestJson<LinkExchangeResponse>("POST", "/api/v1/auth/link-exchange", {
      body: { code },
      authenticated: false,
    });
  }

  /**
   * Swap the current (possibly recently-expired) JWT for a fresh one.
   * The API accepts tokens expired up to its grace window; beyond that
   * it responds 401 `token_too_old` and the user must re-pair.
   */
  async refreshToken(): Promise<LinkExchangeResponse> {
    if (!this.jwt) {
      throw new CompanionApiError("No JWT configured — pair the companion first.", 401, "not_paired");
    }
    // Fastify rejects an empty body when Content-Type is application/json,
    // so send an empty object even though the route reads nothing from it.
    return this.requestJson<LinkExchangeResponse>("POST", "/api/v1/auth/refresh", {
      body: {},
      authenticated: true,
    });
  }

  /**
   * POST a single run. Returns 201 for new, 200 for dedup.
   *
   * Automatically sets `submitterCharacterName` from members[0],
   * which the WoW addon always populates with the logged-in player.
   * This enables the API to auto-claim the character for the user.
   *
   * `enrichment` is optional combat-log data produced by the companion's
   * combat-log enrichment pass. Omitted when the log wasn't available.
   */
  async submitRun(
    run: ParsedRun,
    enrichment?: RunEnrichmentSubmission,
  ): Promise<RunSubmissionResponse> {
    if (!this.jwt) {
      throw new CompanionApiError("No JWT configured — pair the companion first.", 401, "not_paired");
    }

    // The addon puts the submitting player as members[0].
    // Pass their name so the API can auto-claim the character.
    const submitterCharacterName = run.members[0]?.name;

    return this.requestJson<RunSubmissionResponse>("POST", "/api/v1/runs", {
      body: { ...run, submitterCharacterName, enrichment },
      authenticated: true,
    });
  }

  /**
   * Fetch the payload the addon reads from SavedVariables.
   *
   * Returns null on 204, which the API sends when there is nothing worth
   * sending (no characters yet, no active season) — distinct from an error,
   * because the caller should leave existing inbound data in place rather
   * than overwrite it.
   */
  async fetchInbound(): Promise<Record<string, unknown> | null> {
    if (!this.jwt) throw new CompanionApiError("Missing JWT", 401, "not_paired");
    const response = await fetch(`${this.baseUrl}/api/v1/companion/inbound`, {
      headers: { Authorization: `Bearer ${this.jwt}` },
    });
    if (response.status === 204) return null;
    if (!response.ok) {
      throw new CompanionApiError(`API ${response.status}`, response.status, "inbound_failed");
    }
    return (await response.json()) as Record<string, unknown>;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; authenticated: boolean },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.authenticated) {
      if (!this.jwt) {
        throw new CompanionApiError("Missing JWT", 401, "not_paired");
      }
      headers.Authorization = `Bearer ${this.jwt}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    // Error path — try to read an { error, message } envelope
    let errBody: { error?: string; message?: string } | null = null;
    try {
      errBody = (await response.json()) as { error?: string; message?: string };
    } catch {
      // non-JSON body
    }
    throw new CompanionApiError(
      errBody?.message ?? `API ${response.status}`,
      response.status,
      errBody?.error ?? "unknown_error",
    );
  }
}
