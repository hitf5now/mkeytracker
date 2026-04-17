import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { fetchApi, ApiError } from "@/lib/api";
import type { EventDetail, EventSignup, TeamEventSignup, EventTypeConfig } from "@/types/api";
import { EventStatusBadge } from "@/components/event-status-badge";
import { EventAdminPanel } from "@/components/event-admin-panel";
import { ClassBadge } from "@/components/class-badge";
import { RoleIcon } from "@/components/role-icon";
import { formatEventType, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await auth() as any;
  if (!session) {
    redirect(`/api/auth/signin?callbackUrl=/events/${(await params).id}`);
  }

  const { id } = await params;

  let data: { event: EventDetail; typeInfo?: EventTypeConfig | null };
  try {
    data = await fetchApi<{ event: EventDetail; typeInfo?: EventTypeConfig | null }>(`/api/v1/events/${id}`, { revalidate: 0 });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  const { event, typeInfo } = data;

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
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {event.mode === "team" ? "Team Signup" : "Individual Signup"}
        </span>
      </div>

      {/* Admin panel — only visible to event creator */}
      {(() => {
        const userId = session.userId as number | undefined;
        const isCreator = userId && userId === event.createdByUserId;
        if (!isCreator) return null;
        return (
          <div className="mt-4">
            <EventAdminPanel
              eventId={event.id}
              currentStatus={event.status}
              eventName={event.name}
              eventDescription={event.description}
              startsAt={event.startsAt}
              endsAt={event.endsAt}
              minKeyLevel={event.minKeyLevel}
              maxKeyLevel={event.maxKeyLevel}
            />
          </div>
        );
      })()}

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

      {/* Auto-generated Rules & Scoring */}
      {typeInfo && (
        <div className="mt-6 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Rules & Scoring</h2>
            <span className="rounded-full bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
              {typeInfo.label}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{typeInfo.description}</p>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Win Condition</p>
            <p className="mt-1 text-sm text-foreground">{typeInfo.winCondition}</p>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rules</p>
            <ul className="mt-2 space-y-1.5">
              {typeInfo.rules.map((rule, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="text-gold shrink-0">-</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Point System</p>
            <p className="mt-1 text-xs text-muted-foreground">{typeInfo.scoringDescription}</p>
            <div className="mt-2 rounded-md border border-border/50 bg-background">
              {typeInfo.juiceTable.map((row, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between px-3 py-2 text-sm ${i > 0 ? "border-t border-border/30" : ""}`}
                >
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-mono text-xs text-foreground">{row.juice}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Team Signups (team-mode events) */}
      {event.mode === "team" && (
        <section className="mt-10">
          <h2 className="text-xl font-bold">Registered Teams</h2>
          {(!event.teamSignups || event.teamSignups.length === 0) ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No teams have signed up yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {event.teamSignups.map((ts: TeamEventSignup) => (
                <div
                  key={ts.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <h3 className="font-semibold text-gold">{ts.team.name}</h3>
                  {ts.team.members && ts.team.members.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {ts.team.members.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="flex items-center gap-1">
                            <ClassBadge
                              name={m.character.name}
                              realm={m.character.realm}
                              region={m.character.region}
                              classSlug={m.character.class}
                            />
                            {m.character.hasCompanionApp && (
                              <span title="Companion app linked" className="text-gold">⚡</span>
                            )}
                          </span>
                          <RoleIcon role={m.role} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Groups (group-mode events) */}
      {event.mode !== "team" && event.groups.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold">Groups</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {event.groups.map((group) => (
              <div
                key={group.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <h3 className="font-semibold text-gold">{group.name}</h3>
                {group.members && group.members.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {group.members.map((member) => (
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

      {/* Signups — grouped by role (group-mode only) */}
      {event.mode !== "team" && event.signups.length > 0 && (() => {
        const confirmed = event.signups.filter((s: EventSignup) => s.signupStatus !== "declined");
        const tanks = confirmed.filter((s: EventSignup) => s.rolePreference === "tank" && s.signupStatus === "confirmed");
        const healers = confirmed.filter((s: EventSignup) => s.rolePreference === "healer" && s.signupStatus === "confirmed");
        const dps = confirmed.filter((s: EventSignup) => s.rolePreference === "dps" && s.signupStatus === "confirmed");
        const tentative = confirmed.filter((s: EventSignup) => s.signupStatus === "tentative");

        const renderSignup = (signup: EventSignup) => (
          <div key={signup.id} className="flex items-center justify-between rounded-md border border-border/50 bg-background px-3 py-2">
            <span className="inline-flex items-center gap-2">
              <ClassBadge
                name={signup.character.name}
                realm={signup.character.realm}
                region={signup.character.region}
                classSlug={signup.character.class}
              />
              {signup.spec && (
                <span className="text-xs text-muted-foreground">{signup.spec}</span>
              )}
              {signup.character.hasCompanionApp && (
                <span title="Companion app linked" className="text-gold">⚡</span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {signup.character.realm}
              {signup.group && ` · ${signup.group.name}`}
            </span>
          </div>
        );

        return (
          <section className="mt-10">
            <h2 className="text-xl font-bold">
              Roster ({confirmed.length} signed up)
            </h2>
            <div className="mt-4 grid gap-6 sm:grid-cols-3">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-blue-400">Tanks ({tanks.length})</h3>
                <div className="space-y-2">
                  {tanks.length > 0 ? tanks.map(renderSignup) : (
                    <p className="text-xs text-muted-foreground">None yet</p>
                  )}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-green-400">Healers ({healers.length})</h3>
                <div className="space-y-2">
                  {healers.length > 0 ? healers.map(renderSignup) : (
                    <p className="text-xs text-muted-foreground">None yet</p>
                  )}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-red-400">DPS ({dps.length})</h3>
                <div className="space-y-2">
                  {dps.length > 0 ? dps.map(renderSignup) : (
                    <p className="text-xs text-muted-foreground">None yet</p>
                  )}
                </div>
              </div>
            </div>
            {tentative.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold text-yellow-400">Tentative ({tentative.length})</h3>
                <div className="space-y-2">
                  {tentative.map(renderSignup)}
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {event.signups.length === 0 && (
        <p className="mt-12 text-center text-muted-foreground">
          No signups yet. Click Sign Up on the Discord event embed or use the companion app to get started!
        </p>
      )}
    </div>
  );
}
