import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { DashboardResult } from "@/types/api";
import { OverviewStats } from "./_components/overview-stats";
import { CharacterCards } from "./_components/character-cards";
import { RoleBreakdown } from "./_components/role-breakdown";
import { DungeonBreakdown } from "./_components/dungeon-breakdown";
import { RecentRuns } from "./_components/recent-runs";
import { RunHistoryChart } from "./_components/run-history-chart";
import { KeyProgressionChart } from "./_components/key-progression-chart";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your personal M+ stats and run history.",
};

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

export default async function DashboardPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await auth() as any;
  if (!session) {
    redirect("/api/auth/signin?callbackUrl=/dashboard");
  }

  const userId = session.userId as number | undefined;
  if (!userId) {
    redirect("/api/auth/signin?callbackUrl=/dashboard");
  }

  let data: DashboardResult;
  try {
    const res = await fetch(`${API_BASE}/api/v1/users/${userId}/dashboard`, {
      headers: { Authorization: `Bearer ${API_SECRET}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    data = (await res.json()) as DashboardResult;
  } catch {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="mt-4 text-muted-foreground">
          Unable to load dashboard data. The API may be unavailable.
        </p>
      </div>
    );
  }

  const displayName = sessionData.displayName as string | undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {displayName ? `${displayName}'s Dashboard` : "Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{data.season.name}</p>
        </div>
      </div>

      {/* Overview Stats */}
      <section className="mt-8">
        <OverviewStats overview={data.overview} />
      </section>

      {/* Characters */}
      {data.characters.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Characters</h2>
          <CharacterCards characters={data.characters} />
        </section>
      )}

      {/* Role Breakdown */}
      {data.roleBreakdown.some((r) => r.totalRuns > 0) && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">By Role</h2>
          <RoleBreakdown roles={data.roleBreakdown} />
        </section>
      )}

      {/* Dungeon Breakdown */}
      {data.dungeonBreakdown.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">By Dungeon</h2>
          <DungeonBreakdown dungeons={data.dungeonBreakdown} />
        </section>
      )}

      {/* Charts */}
      {data.chartData.runsPerWeek.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Runs Per Week</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <RunHistoryChart data={data.chartData.runsPerWeek} />
          </div>
        </section>
      )}

      {data.chartData.keyProgression.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold">Key Level Progression</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <KeyProgressionChart data={data.chartData.keyProgression} />
          </div>
        </section>
      )}

      {/* Recent Runs */}
      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold">Recent Runs</h2>
        <RecentRuns runs={data.recentRuns} />
      </section>

      {data.overview.totalRuns === 0 && (
        <div className="mt-12 text-center">
          <p className="text-muted-foreground">
            No runs recorded this season. Run some keys with the companion app to see your stats here!
          </p>
        </div>
      )}
    </div>
  );
}
