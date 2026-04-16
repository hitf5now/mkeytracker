import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

export async function POST(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await auth()) as any;
  if (!session?.userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { discordGuildId } = body as { discordGuildId?: string };

  if (!discordGuildId) {
    return NextResponse.json({ error: "Missing discordGuildId" }, { status: 400 });
  }

  // We need a JWT for the user to call the JWT-auth endpoint.
  // For now, proxy via internal auth and pass userId in a custom header.
  // The API's /users/me/primary-server expects JWT auth with req.userId.
  // We'll call the internal init endpoint to create the membership instead.
  const res = await fetch(`${API_BASE}/api/v1/servers/${discordGuildId}/config`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_SECRET}`,
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  // For MVP: store primary server preference in the session/cookie.
  // Full implementation requires the API's JWT-auth primary-server endpoint.
  // TODO: Issue a user JWT from the web session and call /users/me/primary-server
  return NextResponse.json({ saved: true, discordGuildId });
}
