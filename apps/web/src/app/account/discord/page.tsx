import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { RunResultsPreference } from "@/components/run-results-preference";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discord Settings",
  description: "Manage your Discord connection and publishing preferences.",
};

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
}

type Mode = "all_my_servers" | "none" | "primary";

interface PreferenceResponse {
  mode: Mode;
  primaryGuildId: string | null;
  servers: Array<{
    discordGuildId: string;
    guildName: string | null;
    guildIconUrl: string | null;
    hasResultsChannel: boolean;
    isPrimary: boolean;
  }>;
}

export default async function DiscordSettingsPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await auth()) as any;
  if (!session) {
    redirect("/api/auth/signin?callbackUrl=/account/discord");
  }

  const userId = session.userId as number | undefined;
  const discordAccessToken = session.discordAccessToken as string | undefined;
  const discordId = session.discordId as string | undefined;
  const displayName = session.displayName as string | undefined;
  const avatar = session.avatar as string | null;

  // 1. Fetch the user's Discord guild list (OAuth-scoped) and sync any
  //    bot-installed guilds into our DiscordServerMember table. This makes
  //    "all my servers" mean what users intuitively expect.
  if (userId && discordAccessToken) {
    try {
      const discordRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
        headers: { Authorization: `Bearer ${discordAccessToken}` },
        next: { revalidate: 0 },
      });
      if (discordRes.ok) {
        const guilds = (await discordRes.json()) as DiscordGuild[];
        const guildIds = guilds.map((g) => g.id);
        if (guildIds.length > 0) {
          await fetch(`${API_BASE}/api/v1/users/${userId}/sync-server-memberships`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${API_SECRET}`,
            },
            body: JSON.stringify({ guildIds }),
            cache: "no-store",
          });
        }
      }
    } catch (err) {
      console.error("Failed to sync Discord memberships:", err);
    }
  }

  // 2. Read the user's current preference + joined-server list.
  let preference: PreferenceResponse = {
    mode: "all_my_servers",
    primaryGuildId: null,
    servers: [],
  };
  if (userId) {
    const prefRes = await fetch(`${API_BASE}/api/v1/users/${userId}/run-results-preference`, {
      headers: { Authorization: `Bearer ${API_SECRET}` },
      cache: "no-store",
    });
    if (prefRes.ok) {
      preference = (await prefRes.json()) as PreferenceResponse;
    }
  }

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
          Where to post my completed runs
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick which Discord server(s) the bot should announce your run results to.
          This only changes Discord posting — every run is still logged on the
          website and counts toward any matching events.
        </p>

        {preference.servers.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            You don&apos;t share any servers with the M+ Tracker bot yet. Install
            the bot in a Discord server you&apos;re a member of, then refresh this
            page.
          </p>
        ) : (
          <RunResultsPreference
            initialMode={preference.mode}
            initialPrimaryGuildId={preference.primaryGuildId}
            servers={preference.servers}
          />
        )}
      </div>
    </div>
  );
}
