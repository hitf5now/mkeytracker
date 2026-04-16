import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/feedback")) {
    const token =
      request.nextUrl.searchParams.get("token") ??
      request.cookies.get("feedback_token")?.value;

    const validTokens = (process.env.FEEDBACK_TOKENS ?? "").split(",").filter(Boolean);

    if (!token || !validTokens.includes(token)) {
      return new NextResponse(null, { status: 404 });
    }

    const response = NextResponse.next();

    if (!request.cookies.get("feedback_token")) {
      response.cookies.set("feedback_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 90,
      });
    }

    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/feedback/:path*"],
};
