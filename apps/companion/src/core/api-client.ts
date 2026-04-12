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
    points: number;
    dungeonId: number;
    keystoneLevel: number;
  };
  deduplicated?: boolean;
  scoring?: {
    total: number;
  };
}

export class CompanionApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly jwt: string | null,
  ) {}

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
   * POST a single run. Returns 201 for new, 200 for dedup.
   */
  async submitRun(run: ParsedRun): Promise<RunSubmissionResponse> {
    if (!this.jwt) {
      throw new CompanionApiError("No JWT configured — pair the companion first.", 401, "not_paired");
    }
    return this.requestJson<RunSubmissionResponse>("POST", "/api/v1/runs", {
      body: run,
      authenticated: true,
    });
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
