import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { fetchApi } from "@/lib/api";
import type { EventSummary } from "@/types/api";
import { EventStatusBadge } from "@/components/event-status-badge";
import { EventFilters } from "@/components/event-filters";
import { formatEventType, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
  description: "Active and upcoming M+ competitive events.",
};

async function getUserGuildIds(): Promise<string[]> {
  try {
    // auth() in NextAuth v5 returns the full server-side session including
    // discordAccessToken (set in jwt() callback, exposed in session() callback).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await auth() as any;
    const discordAccessToken = session?.discordAccessToken as string | undefined;
    if (!discordAccessToken) return [];

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

interface Props {
  searchParams: Promise<{ status?: string; type?: string }>;
}

export default async function EventsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session) {
    redirect("/api/auth/signin?callbackUrl=/events");
  }

  const params = await searchParams;
  const guildIds = await getUserGuildIds();

  // Build API query string with all filters
  const apiParams = new URLSearchParams();
  if (guildIds.length > 0) apiParams.set("guildIds", guildIds.join(","));
  if (params.status) apiParams.set("status", params.status);
  if (params.type) apiParams.set("type", params.type);

  const queryString = apiParams.toString();
  const { events } = await fetchApi<{ events: EventSummary[] }>(
    `/api/v1/events${queryString ? `?${queryString}` : ""}`,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Events</h1>
          <p className="mt-2 text-muted-foreground">
            Competitions from your servers.
          </p>
        </div>
        <Link
          href="/events/create"
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
        >
          Create Event
        </Link>
      </div>

      {/* Filters */}
      <div className="mt-6">
        <Suspense fallback={null}>
          <EventFilters />
        </Suspense>
      </div>

      {events.length === 0 ? (
        <p className="mt-12 text-center text-muted-foreground">
          No events match your filters. Try changing the filters or create a new event.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
