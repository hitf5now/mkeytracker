import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { ServerConfigForm } from "@/components/server-config-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Server Settings",
  description: "Configure your Discord server's M+ Tracker settings.",
};

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

interface ServerDetail {
  id: number;
  discordGuildId: string;
  guildName: string | null;
  guildIconUrl: string | null;
  botActive: boolean;
  eventsChannelId: string | null;
  resultsChannelId: string | null;
  announcementsChannelId: string | null;
  resultsWebhookUrl: string | null;
  allowPublicEvents: boolean;
  timezone: string | null;
  _count: { events: number; admins: number; members: number };
}

interface TextChannel {
  id: string;
  name: string;
  parentId: string | null;
}

interface Props {
  params: Promise<{ guildId: string }>;
}

export default async function ServerDashboardPage({ params }: Props) {
  const { guildId } = await params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await auth()) as any;
  if (!session) {
    redirect(`/api/auth/signin?callbackUrl=/servers/${guildId}`);
  }

  // Fetch server detail
  const serverRes = await fetch(`${API_BASE}/api/v1/servers/${guildId}/config`, {
    headers: { Authorization: `Bearer ${API_SECRET}` },
    next: { revalidate: 0 },
  });

  if (!serverRes.ok) {
    notFound();
  }

  const serverData = (await serverRes.json()) as { config: ServerDetail | null };
  if (!serverData.config) {
    notFound();
  }

  const server = serverData.config;

  // Fetch text channels
  let channels: TextChannel[] = [];
  const channelsRes = await fetch(`${API_BASE}/api/v1/servers/${guildId}/channels`, {
    headers: { Authorization: `Bearer ${API_SECRET}` },
    next: { revalidate: 0 },
  });
  if (channelsRes.ok) {
    const data = (await channelsRes.json()) as { channels: TextChannel[] };
    channels = data.channels;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center gap-4">
        {server.guildIconUrl ? (
          <img src={server.guildIconUrl} alt="" className="h-14 w-14 rounded-full" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-xl font-bold text-muted-foreground">
            {(server.guildName ?? "?").charAt(0)}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {server.guildName ?? "Discord Server"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Server settings and channel configuration
          </p>
        </div>
        <span
          className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${
            server.botActive !== false
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {server.botActive !== false ? "Bot Active" : "Bot Inactive"}
        </span>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{server._count?.events ?? 0}</p>
          <p className="text-sm text-muted-foreground">Events</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{server._count?.admins ?? 0}</p>
          <p className="text-sm text-muted-foreground">Admins</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{server._count?.members ?? 0}</p>
          <p className="text-sm text-muted-foreground">Members</p>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-foreground">Channel Configuration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which channels the bot uses for events and run results.
        </p>

        <ServerConfigForm
          guildId={guildId}
          eventsChannelId={server.eventsChannelId}
          resultsChannelId={server.resultsChannelId}
          channels={channels}
        />
      </div>
    </div>
  );
}
