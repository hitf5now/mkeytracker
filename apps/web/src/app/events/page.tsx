import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { fetchApi } from "@/lib/api";
import type { EventSummary } from "@/types/api";
import { EventStatusBadge } from "@/components/event-status-badge";
import { formatEventType, formatDateTime } from "@/lib/format";
import { getToken } from "next-auth/jwt";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
  description: "Active and upcoming M+ competitive events.",
};

async function getUserGuildIds(): Promise<string[]> {
  try {
    // Read the JWT to get the Discord access token
    const cookieStore = await cookies();
    const sessionToken =
      cookieStore.get("__Secure-authjs.session-token")?.value ??
      cookieStore.get("authjs.session-token")?.value;

    if (!sessionToken) return [];

    const token = await getToken({
      req: { headers: { cookie: `authjs.session-token=${sessionToken}` } } as never,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    const discordAccessToken = token?.discordAccessToken as string | undefined;
    if (!discordAccessToken) return [];

    // Fetch user's guilds from Discord
    const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${discordAccessToken}` },
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];

    const guilds = (await res.json()) as Array<{ id: string }>;
    return guilds.map((g) => g.id);
  } catch {
    return [];
  }
}

export default async function EventsPage() {
  const session = await auth();
  if (!session) {
    redirect("/api/auth/signin?callbackUrl=/events");
  }

  const guildIds = await getUserGuildIds();
  const guildFilter = guildIds.length > 0 ? `?guildIds=${guildIds.join(",")}` : "";

  const { events } = await fetchApi<{ events: EventSummary[] }>(
    `/api/v1/events${guildFilter}`,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Events</h1>
          <p className="mt-2 text-muted-foreground">
            Active and upcoming competitions from your servers.
          </p>
        </div>
        <Link
          href="/events/create"
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
        >
          Create Event
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="mt-12 text-center text-muted-foreground">
          No active events in your servers. Create one to get started!
        </p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className="group rounded-lg border border-border bg-card p-5 transition-colors hover:border-gold/50"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold group-hover:text-gold">
                  {event.name}
                </h3>
                <EventStatusBadge status={event.status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatEventType(event.type)}
                {event.dungeon && ` — ${event.dungeon.name}`}
              </p>
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatDateTime(event.startsAt)}</span>
                <span>
                  {event._count.signups} signup{event._count.signups !== 1 ? "s" : ""}
                  {event._count.teams > 0 && ` / ${event._count.teams} teams`}
                </span>
              </div>
              {event.minKeyLevel > 2 || event.maxKeyLevel < 40 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Key range: +{event.minKeyLevel} to +{event.maxKeyLevel}
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
