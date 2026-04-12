/**
 * POST /api/events — server-side proxy for event creation.
 *
 * The browser can't call the API directly (CORS + internal auth).
 * This route handler runs server-side, calls the API with the
 * internal bearer token, and returns the result to the browser.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  // Add the creating user's Discord ID from the session
  const discordId = (session as Record<string, unknown>).discordId as string;
  if (!discordId) {
    return NextResponse.json({ error: "No Discord ID in session" }, { status: 401 });
  }

  const apiBody = {
    ...body,
    createdByDiscordId: discordId,
  };

  const res = await fetch(`${API_BASE}/api/v1/events`, {
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
