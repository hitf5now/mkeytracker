/**
 * Server-side API fetch wrapper.
 *
 * Uses `API_INTERNAL_URL` (server-only, not NEXT_PUBLIC_) so RSC calls
 * go container-to-container in production (no public round-trip).
 */

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
    this.name = "ApiError";
  }
}

export async function fetchApi<T>(
  path: string,
  options?: { revalidate?: number; cache?: RequestCache },
): Promise<T> {
  // Default to no-store: most data on this site is volatile (runs, signups,
  // juice, configs). Pages that want light caching for static-ish data
  // (dungeons list, GitHub release info) opt in via { revalidate: N }.
  const url = `${API_BASE}${path}`;
  const init: RequestInit & { next?: { revalidate?: number } } = {};
  if (options?.revalidate !== undefined) {
    init.next = { revalidate: options.revalidate };
  } else if (options?.cache !== undefined) {
    init.cache = options.cache;
  } else {
    init.cache = "no-store";
  }

  const res = await fetch(url, init);

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}
