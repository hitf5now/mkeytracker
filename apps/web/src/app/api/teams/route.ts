/**
 * POST /api/teams — server-side proxy for team creation.
 * GET  /api/teams — list teams (public, proxied for consistent auth pattern).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

export async function POST(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await auth() as any;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  const discordId = session.discordId as string;
  if (!discordId) {
    return NextResponse.json({ error: "No Discord ID in session" }, { status: 401 });
  }

  const apiBody = { ...body, discordId };

  const res = await fetch(`${API_BASE}/api/v1/teams`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_SECRET}`,
    },
    body: JSON.stringify(apiBody),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  const res = await fetch(`${API_BASE}/api/v1/teams`, {
    headers: { Accept: "application/json" },
  });

  const data = await res.json();
  return NextResponse.json(data);
}
