/**
 * PATCH /api/teams/:id — server-side proxy for team actions (inactivate).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await auth() as any;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const discordId = session.discordId as string;
  if (!discordId) {
    return NextResponse.json({ error: "No Discord ID in session" }, { status: 401 });
  }

  const res = await fetch(`${API_BASE}/api/v1/teams/${id}/inactivate`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_SECRET}`,
    },
    body: JSON.stringify({ discordId }),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return NextResponse.json(data);
}
