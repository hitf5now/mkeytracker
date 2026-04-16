import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PrimaryServerPicker } from "@/components/primary-server-picker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discord Settings",
  description: "Manage your Discord connection and publishing preferences.",
};

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

interface BotGuild {
  id: string;
  name: string;
  icon: string | null;
}

interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
}

export default async function DiscordSettingsPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await auth()) as any;
  if (!session) {
    redirect("/api/auth/signin?callbackUrl=/account/discord");
  }

  const discordAccessToken = session.discordAccessToken as string | undefined;
  const discordId = session.discordId as string | undefined;
  const displayName = session.displayName as string | undefined;
  const avatar = session.avatar as string | null;

  // Fetch user's guilds from Discord
  let userGuilds: DiscordGuild[] = [];
  if (discordAccessToken) {
    const discordRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${discordAccessToken}` },
      next: { revalidate: 0 },
    });
    if (discordRes.ok) {
      userGuilds = (await discordRes.json()) as DiscordGuild[];
    }
  }

  // Fetch bot's guilds
  const botRes = await fetch(`${API_BASE}/api/v1/bot/guilds`, {
    headers: { Authorization: `Bearer ${API_SECRET}` },
    next: { revalidate: 0 },
  });
  let botGuilds: BotGuild[] = [];
  if (botRes.ok) {
    const data = (await botRes.json()) as { guilds: BotGuild[] };
    botGuilds = data.guilds;
  }

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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground">Discord Settings</h1>

      <div className="mt-6 rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-4">
          {avatar ? (
            <img src={avatar} alt="" className="h-14 w-14 rounded-full" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-xl font-bold text-muted-foreground">
              ?
            </div>
          )}
          <div>
            <p className="font-medium text-foreground">{displayName ?? "Discord User"}</p>
            <p className="text-sm text-muted-foreground">{discordId ?? ""}</p>
          </div>
          <span className="ml-auto rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
            Connected
          </span>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">
          Publish Personal Runs
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which Discord server your non-event run results are posted to.
          This is opt-in — leave it unset to disable personal run broadcasting.
        </p>

        <PrimaryServerPicker servers={sharedGuilds} />
      </div>
    </div>
  );
}
