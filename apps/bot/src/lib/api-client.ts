/**
 * Typed client for the M+ API, using the shared internal bearer token.
 *
 * Only used by bot→API server-side calls. Never exposed to users.
 */

import { env } from "../config/env.js";

export interface RegisterRequest {
  discordId: string;
  character: string;
  realm: string;
  region: "us" | "eu" | "kr" | "tw" | "cn";
}

export interface RegisterResponseCharacter {
  id: number;
  name: string;
  realm: string;
  region: string;
  class: string;
  spec: string;
  role: string;
  rioScore: number;
  profileUrl: string;
}

export interface RegisterResponse {
  user: { id: number; discordId: string };
  character: RegisterResponseCharacter;
}

export interface LinkCodeRequest {
  discordId: string;
}

export interface LinkCodeResponse {
  code: string;
  expiresInSeconds: number;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiPost<TBody, TResponse>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const url = `${env.API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.API_INTERNAL_SECRET}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await response.json()) as ApiErrorBody;
    } catch {
      // non-JSON response
    }
    throw new ApiError(
      errBody?.message ?? `API ${response.status}`,
      response.status,
      errBody?.error ?? "unknown_error",
    );
  }

  return (await response.json()) as TResponse;
}

export const apiClient = {
  register: (req: RegisterRequest): Promise<RegisterResponse> =>
    apiPost<RegisterRequest, RegisterResponse>("/api/v1/register", req),

  linkCode: (req: LinkCodeRequest): Promise<LinkCodeResponse> =>
    apiPost<LinkCodeRequest, LinkCodeResponse>("/api/v1/auth/link-code", req),
};
