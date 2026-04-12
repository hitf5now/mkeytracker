/**
 * GET /api/guilds — returns Discord servers where both the user
 * and the bot are members (the intersection).
 *
 * Used by the event creation form to populate the server selector.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
}

export async function GET() {
  // auth() in NextAuth v5 App Router returns the full server-side token fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await auth() as any;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // discordAccessToken is set in the jwt() callback and exposed via the
  // session() callback on the server side only (not sent to the client).
  const discordAccessToken = session.discordAccessToken as string | undefined;

  if (!discordAccessToken) {
    return NextResponse.json(
      { error: "No Discord access token. Please sign out and sign in again." },
      { status: 401 },
    );
  }

  // Fetch user's guilds from Discord API
  const discordRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bearer ${discordAccessToken}` },
  });

  if (!discordRes.ok) {
    return NextResponse.json(
      { error: "Failed to fetch guilds from Discord" },
      { status: 502 },
    );
  }

  const userGuilds = (await discordRes.json()) as DiscordGuild[];

  // Fetch bot's guilds from our API (cached in Redis)
  const botRes = await fetch(`${API_BASE}/api/v1/bot/guilds`, {
    headers: { Authorization: `Bearer ${API_SECRET}` },
  });

  let botGuilds: DiscordGuild[] = [];
  if (botRes.ok) {
    const data = (await botRes.json()) as { guilds: DiscordGuild[] };
    botGuilds = data.guilds;
  }

  // Compute intersection
  const botGuildIds = new Set(botGuilds.map((g) => g.id));
  const sharedGuilds = userGuilds
    .filter((g) => botGuildIds.has(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon
        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
        : null,
    }));

  return NextResponse.json({ guilds: sharedGuilds });
}
