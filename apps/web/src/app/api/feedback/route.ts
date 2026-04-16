import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("feedback_token")?.value ?? "";

  const body = await request.json();

  const res = await fetch(`${API_BASE}/api/v1/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Feedback-Token": token,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);
  return NextResponse.json(data ?? {}, { status: res.status });
}
