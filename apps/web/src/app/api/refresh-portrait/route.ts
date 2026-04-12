/**
 * POST /api/refresh-portrait — triggers a portrait refresh for a character.
 * Calls the API which fetches from Blizzard and updates the DB.
 */

import { NextResponse } from "next/server";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

export async function POST(request: Request) {
  const body = await request.json();
  const { region, realm, name } = body as { region?: string; realm?: string; name?: string };

  if (!region || !realm || !name) {
    return NextResponse.json({ error: "Missing region, realm, or name" }, { status: 400 });
  }

  const res = await fetch(
    `${API_BASE}/api/v1/characters/${encodeURIComponent(region)}/${encodeURIComponent(realm)}/${encodeURIComponent(name)}/refresh-portrait`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${API_SECRET}` },
    },
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to refresh" }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
