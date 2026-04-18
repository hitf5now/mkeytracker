import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

/**
 * Proxy for the user's run-results posting preference.
 * - GET: returns { mode, primaryGuildId, servers[] } for the signed-in user.
 * - PATCH: body { mode, primaryGuildId? } → updates the preference.
 *
 * Verifies the NextAuth session, then forwards to the internal-auth API
 * endpoint with session.userId in the path. The web doesn't issue user
 * JWTs, so the trust boundary is the NextAuth session check on this route.
 */

async function getSessionUserId(): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await auth()) as any;
  const userId = session?.userId;
  return typeof userId === "number" ? userId : null;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const res = await fetch(`${API_BASE}/api/v1/users/${userId}/run-results-preference`, {
    headers: { Authorization: `Bearer ${API_SECRET}` },
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const res = await fetch(`${API_BASE}/api/v1/users/${userId}/run-results-preference`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
