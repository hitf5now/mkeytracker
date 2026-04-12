import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchApi, ApiError } from "@/lib/api";
import type { EventDetail } from "@/types/api";
import { EventStatusBadge } from "@/components/event-status-badge";
import { ClassBadge } from "@/components/class-badge";
import { RoleIcon } from "@/components/role-icon";
import { formatEventType, formatDateTime } from "@/lib/format";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const { event } = await fetchApi<{ event: EventDetail }>(
      `/api/v1/events/${id}`,
    );
    return { title: event.name, description: `M+ event: ${event.name}` };
  } catch {
    return { title: "Event" };
  }
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params;

  let data: { event: EventDetail };
  try {
    data = await fetchApi<{ event: EventDetail }>(`/api/v1/events/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  const { event } = data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Event header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{event.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {formatEventType(event.type)}
            {event.dungeon && ` — ${event.dungeon.name}`}
          </p>
        </div>
        <EventStatusBadge status={event.status} />
      </div>

      {/* Details */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Starts</p>
          <p className="mt-1 font-medium">{formatDateTime(event.startsAt)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Ends</p>
          <p className="mt-1 font-medium">{formatDateTime(event.endsAt)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Key Range</p>
          <p className="mt-1 font-medium">
            +{event.minKeyLevel} to +{event.maxKeyLevel}
          </p>
        </div>
      </div>

      {event.description && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{event.description}</p>
        </div>
      )}

      {/* Teams */}
      {event.teams.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold">Teams</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {event.teams.map((team) => (
              <div
                key={team.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <h3 className="font-semibold text-gold">{team.name}</h3>
                {team.members && team.members.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {team.members.map((member) => (
                      <li
                        key={member.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="flex items-center gap-1">
                          <ClassBadge
                            name={member.character.name}
                            realm={member.character.realm}
                            region={member.character.region}
                            classSlug={member.character.class}
                          />
                          {member.character.hasCompanionApp && (
                            <span title="Companion app linked — runs auto-tracked" className="text-gold">⚡</span>
                          )}
                        </span>
                        <RoleIcon role={member.rolePreference} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Signups */}
      {event.signups.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold">
            Signups ({event.signups.length})
          </h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium">Realm</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Team</th>
                </tr>
              </thead>
              <tbody>
                {event.signups.map((signup) => (
                  <tr
                    key={signup.id}
                    className="border-b border-border/50"
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        <ClassBadge
                          name={signup.character.name}
                          realm={signup.character.realm}
                          region={signup.character.region}
                          classSlug={signup.character.class}
                        />
                        {signup.character.hasCompanionApp && (
                          <span title="Companion app linked" className="text-gold">⚡</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {signup.character.realm}
                    </td>
                    <td className="px-4 py-3">
                      <RoleIcon role={signup.rolePreference} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {signup.team?.name ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {event.signups.length === 0 && (
        <p className="mt-12 text-center text-muted-foreground">
          No signups yet. Use <code>/signup</code> in Discord to join!
        </p>
      )}
    </div>
  );
}
