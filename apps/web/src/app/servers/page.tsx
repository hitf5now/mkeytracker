import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Discord Servers",
  description: "Manage your Discord servers connected to M+ Tracker.",
};

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  permissions: string;
  owner: boolean;
}

interface BotGuild {
  id: string;
  name: string;
  icon: string | null;
}

export default async function ServersPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await auth()) as any;
  if (!session) {
    redirect("/api/auth/signin?callbackUrl=/servers");
  }

  const discordAccessToken = session.discordAccessToken as string | undefined;
  if (!discordAccessToken) {
    redirect("/api/auth/signin?callbackUrl=/servers");
  }

  // Fetch user's guilds from Discord
  const discordRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bearer ${discordAccessToken}` },
    next: { revalidate: 0 },
  });

  let userGuilds: DiscordGuild[] = [];
  if (discordRes.ok) {
    userGuilds = (await discordRes.json()) as DiscordGuild[];
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

  // MANAGE_GUILD = 0x20
  const adminGuilds = userGuilds.filter(
    (g) => g.owner || (BigInt(g.permissions) & BigInt(0x20)) !== BigInt(0),
  );

  const connectedServers = adminGuilds.filter((g) => botGuildIds.has(g.id));
  const availableServers = adminGuilds.filter((g) => !botGuildIds.has(g.id));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">My Discord Servers</h1>
        <Link
          href="/servers/install"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Add Bot to Server
        </Link>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        Servers where you have Manage Server permission and the M+ Tracker bot is installed.
      </p>

      {connectedServers.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border p-8 text-center">
          <p className="text-muted-foreground">
            No connected servers yet.{" "}
            <Link href="/servers/install" className="text-indigo-400 hover:underline">
              Add the bot to a server
            </Link>{" "}
            to get started.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {connectedServers.map((g) => (
            <Link
              key={g.id}
              href={`/servers/${g.id}`}
              className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-indigo-500/50"
            >
              {g.icon ? (
                <img
                  src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`}
                  alt=""
                  className="h-12 w-12 rounded-full"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-bold text-muted-foreground">
                  {g.name.charAt(0)}
                </div>
              )}
              <div>
                <p className="font-medium text-foreground">{g.name}</p>
                <p className="text-xs text-muted-foreground">
                  {g.owner ? "Owner" : "Admin"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {availableServers.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-foreground">
            Servers without the bot
          </h2>
          <p className="text-sm text-muted-foreground">
            You're an admin of these servers but the bot isn't installed yet.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {availableServers.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card/50 p-4"
              >
                <div className="flex items-center gap-3">
                  {g.icon ? (
                    <img
                      src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`}
                      alt=""
                      className="h-10 w-10 rounded-full"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                      {g.name.charAt(0)}
                    </div>
                  )}
                  <p className="font-medium text-muted-foreground">{g.name}</p>
                </div>
                <Link
                  href="/servers/install"
                  className="text-xs text-indigo-400 hover:underline"
                >
                  Install
                </Link>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
