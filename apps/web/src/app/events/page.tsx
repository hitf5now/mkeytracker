import type { Metadata } from "next";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import type { EventSummary } from "@/types/api";
import { EventStatusBadge } from "@/components/event-status-badge";
import { formatEventType, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
  description: "Active and upcoming M+ competitive events.",
};

export default async function EventsPage() {
  const { events } = await fetchApi<{ events: EventSummary[] }>(
    "/api/v1/events",
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-bold">Events</h1>
      <p className="mt-2 text-muted-foreground">
        Active and upcoming competitions.
      </p>

      {events.length === 0 ? (
        <p className="mt-12 text-center text-muted-foreground">
          No active events right now. Check back soon or create one via Discord!
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
