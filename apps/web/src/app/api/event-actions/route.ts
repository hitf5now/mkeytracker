/**
 * POST /api/event-actions — server-side proxy for event admin actions.
 *
 * Query params:
 *   eventId: number
 *   action: "transition" | "assign-groups" | "edit" | "sync-discord"
 *   target: string (for transition action)
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

  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  const action = url.searchParams.get("action");

  if (!eventId || !action) {
    return NextResponse.json({ error: "Missing eventId or action" }, { status: 400 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_SECRET}`,
  };

  let apiUrl: string;
  let body: string;

  switch (action) {
    case "transition": {
      const target = url.searchParams.get("target");
      if (!target) return NextResponse.json({ error: "Missing target" }, { status: 400 });
      apiUrl = `${API_BASE}/api/v1/events/${eventId}/transition`;
      body = JSON.stringify({ targetStatus: target });
      break;
    }
    case "assign-groups":
      apiUrl = `${API_BASE}/api/v1/events/${eventId}/assign-groups`;
      body = "{}";
      break;
    case "edit": {
      const editBody = await request.json();
      apiUrl = `${API_BASE}/api/v1/events/${eventId}`;
      body = JSON.stringify(editBody);
      break;
    }
    case "sync-discord":
      // Publish a notification to refresh the Discord embed
      apiUrl = `${API_BASE}/api/v1/events/${eventId}/sync-discord`;
      body = "{}";
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const method = action === "edit" ? "PATCH" : "POST";
  const res = await fetch(apiUrl, { method, headers, body });
  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return NextResponse.json(data);
}
