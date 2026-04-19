/**
 * POST /api/endorsements — give an endorsement.
 * GET  /api/endorsements — get current user's token balance.
 *
 * Both require an authenticated session. Server-side proxy to the
 * internal M+ API so the browser never hits the API directly.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.userId as number | undefined;
  if (!session || !userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let payload: {
    receiverUserId?: unknown;
    runId?: unknown;
    category?: unknown;
    note?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Giver identity comes from the session, never from the body.
  const body = {
    giverUserId: userId,
    receiverUserId: payload.receiverUserId,
    runId: payload.runId,
    category: payload.category,
    note: payload.note,
  };

  const res = await fetch(`${API_BASE}/api/v1/endorsements`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_SECRET}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({ error: "api_parse_failed" }));

  // Bust Next.js fetch cache on the surfaces that display this endorsement
  // or the viewer's token balance, so the new state is visible immediately
  // after the modal closes.
  if (res.ok && typeof payload.runId === "number") {
    revalidatePath(`/runs/${payload.runId}`);
    revalidatePath("/dashboard");
  }

  return NextResponse.json(data, { status: res.status });
}

export async function GET(): Promise<Response> {
  const session = await auth();
  const userId = session?.userId as number | undefined;
  if (!session || !userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const res = await fetch(
    `${API_BASE}/api/v1/users/${userId}/tokens/balance`,
    {
      headers: { Authorization: `Bearer ${API_SECRET}` },
      cache: "no-store",
    },
  );
  const data = await res.json().catch(() => ({ error: "api_parse_failed" }));
  return NextResponse.json(data, { status: res.status });
}
