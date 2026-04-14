import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { fetchApi } from "@/lib/api";
import type { TeamSummary } from "@/types/api";
import { ClassBadge } from "@/components/class-badge";
import { RoleIcon } from "@/components/role-icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Teams",
  description: "Pre-made M+ teams for competitive events.",
};

export default async function TeamsPage() {
  const session = await auth();
  if (!session) redirect("/");

  const { teams } = await fetchApi<{ teams: TeamSummary[] }>("/api/v1/teams");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pre-made rosters for team-mode events.
          </p>
        </div>
        <Link
          href="/teams/create"
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
        >
          Create Team
        </Link>
      </div>

      {teams.length === 0 ? (
        <div className="mt-10 rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No teams yet. Create one to sign up for team-mode events.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Link
              key={team.id}
              href={`/teams/${team.id}`}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-gold/50"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gold">{team.name}</h3>
                {!team.active && (
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                    Inactive
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {team.season.name}
              </p>
              <ul className="mt-3 space-y-1.5">
                {team.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between text-sm">
                    <ClassBadge
                      name={m.character.name}
                      realm={m.character.realm}
                      region={m.character.region}
                      classSlug={m.character.class}
                    />
                    <RoleIcon role={m.role} />
                  </li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
