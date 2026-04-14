import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { fetchApi } from "@/lib/api";
import type { TeamDetail } from "@/types/api";
import { ClassBadge } from "@/components/class-badge";
import { RoleIcon } from "@/components/role-icon";
import { TeamActions } from "@/components/team-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const { team } = await fetchApi<{ team: TeamDetail }>(`/api/v1/teams/${id}`);
    return { title: team.name };
  } catch {
    return { title: "Team" };
  }
}

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await auth() as any;
  if (!session) redirect("/");

  const { id } = await params;
  let team: TeamDetail;
  try {
    const result = await fetchApi<{ team: TeamDetail }>(`/api/v1/teams/${id}`);
    team = result.team;
  } catch {
    notFound();
  }

  const tanks = team.members.filter((m) => m.role === "tank");
  const healers = team.members.filter((m) => m.role === "healer");
  const dps = team.members.filter((m) => m.role === "dps");

  const isCaptain = session.discordId === team.captain.discordId;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{team.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {team.season.name}
            {!team.active && (
              <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                Inactive
              </span>
            )}
          </p>
        </div>
        {isCaptain && team.active && (
          <TeamActions teamId={team.id} />
        )}
      </div>

      {/* Roster */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Roster</h2>
        <div className="mt-4 space-y-6">
          {[
            { label: "Tank", icon: "🛡", members: tanks },
            { label: "Healer", icon: "💚", members: healers },
            { label: "DPS", icon: "⚔", members: dps },
          ].map(({ label, icon, members }) => (
            <div key={label}>
              <h3 className="text-sm font-medium text-muted-foreground">
                {icon} {label} ({members.length})
              </h3>
              <div className="mt-2 space-y-2">
                {members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-md border border-border/50 bg-card px-4 py-3"
                  >
                    <span className="flex items-center gap-2">
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
                    <span className="text-xs text-muted-foreground">
                      {m.character.realm} · {m.character.rioScore} io
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
