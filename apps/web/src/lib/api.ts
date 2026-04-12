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
  options?: { revalidate?: number },
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    next: { revalidate: options?.revalidate ?? 60 },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}
