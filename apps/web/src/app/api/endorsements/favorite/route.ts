/**
 * PUT /api/endorsements/favorite — set or clear the viewer's favorite
 * endorsement. Body: { endorsementId: number | null }.
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

export async function PUT(request: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.userId as number | undefined;
  if (!session || !userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let payload: { endorsementId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const res = await fetch(
    `${API_BASE}/api/v1/users/${userId}/favorite-endorsement`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_SECRET}`,
      },
      body: JSON.stringify({ endorsementId: payload.endorsementId ?? null }),
    },
  );
  const data = await res.json().catch(() => ({ error: "api_parse_failed" }));

  if (res.ok) {
    revalidatePath("/dashboard");
  }

  return NextResponse.json(data, { status: res.status });
}
