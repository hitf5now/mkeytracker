import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { DashboardResult, UserRunsResult, UserRunsRange } from "@/types/api";
import { OverviewStats } from "./_components/overview-stats";
import { JuiceTotals } from "./_components/juice-totals";
import { CharacterCards } from "./_components/character-cards";
import { RoleBreakdown } from "./_components/role-breakdown";
import { DungeonBreakdown } from "./_components/dungeon-breakdown";
import { RunsTab } from "./_components/runs-tab";
import { EndorsementsTab } from "./_components/endorsements-tab";
import { TabNav, parseDashboardTab } from "./_components/tab-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your personal M+ stats and run history.",
};

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function fetchDashboard(userId: number): Promise<DashboardResult | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/users/${userId}/dashboard`, {
      headers: { Authorization: `Bearer ${API_SECRET}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as DashboardResult;
  } catch {
    return null;
  }
}

function toInt(
  v: string | string[] | undefined,
  fallback: number | null = null,
): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function toRange(v: string | string[] | undefined): UserRunsRange {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === "7d" || s === "30d" || s === "season") return s;
  return "all";
}

async function fetchUserRuns(
  userId: number,
  params: Record<string, string | string[] | undefined>,
): Promise<UserRunsResult | null> {
  const qs = new URLSearchParams();
  const characterId = toInt(params.character);
  const dungeonId = toInt(params.dungeon);
  const range = toRange(params.range);
  const offset = Math.max(0, toInt(params.offset, 0) ?? 0);
  if (characterId) qs.set("characterId", String(characterId));
  if (dungeonId) qs.set("dungeonId", String(dungeonId));
  qs.set("range", range);
  qs.set("limit", "25");
  qs.set("offset", String(offset));
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/users/${userId}/runs?${qs.toString()}`,
      {
        headers: { Authorization: `Bearer ${API_SECRET}` },
        next: { revalidate: 30 },
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as UserRunsResult;
  } catch {
    return null;
  }
}

export default async function DashboardPage({ searchParams }: PageProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await auth()) as any;
  if (!session) redirect("/api/auth/signin?callbackUrl=/dashboard");

  const userId = session.userId as number | undefined;
  if (!userId) redirect("/api/auth/signin?callbackUrl=/dashboard");

  const resolvedParams = await searchParams;
  const active = parseDashboardTab(resolvedParams.tab);

  const data = await fetchDashboard(userId);
  if (!data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="mt-4 text-muted-foreground">
          Unable to load dashboard data. The API may be unavailable.
        </p>
      </div>
    );
  }

  // Runs tab has its own data fetch keyed on URL filters — only fetch when
  // the tab is active so other tabs don't pay the cost.
  const runsData = active === "runs" ? await fetchUserRuns(userId, resolvedParams) : null;
  const currentQueryString = new URLSearchParams(
    Object.entries(resolvedParams).flatMap(([k, v]) =>
      v === undefined
        ? []
        : Array.isArray(v)
          ? v.map((vv) => [k, vv] as [string, string])
          : [[k, v] as [string, string]],
    ),
  ).toString();

  const displayName = session.displayName as string | undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {displayName ? `${displayName}'s Dashboard` : "Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.season.name}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <TabNav active={active} />
      </div>

      <div className="mt-6">
        {active === "summary" && <SummaryTab data={data} />}
        {active === "characters" && <CharactersTab data={data} />}
        {active === "runs" && (
          <>
            {runsData ? (
              <RunsTab
                data={runsData}
                activeRange={toRange(resolvedParams.range)}
                activeCharacterId={toInt(resolvedParams.character)}
                activeDungeonId={toInt(resolvedParams.dungeon)}
                currentQueryString={currentQueryString}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load your runs right now.
              </p>
            )}
          </>
        )}
        {active === "endorsements" && (
          <EndorsementsTab
            summary={data.endorsements}
            tokenBalance={data.tokenBalance}
          />
        )}
      </div>
    </div>
  );
}

function SummaryTab({ data }: { data: DashboardResult }) {
  if (data.overview.totalRuns === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No runs recorded this season. Run some keys with the companion app to
        see your stats here!
      </div>
    );
  }
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-lg font-bold">{data.season.name}</h2>
        <OverviewStats overview={data.overview} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Juice Earned</h2>
        <JuiceTotals overview={data.overview} />
      </section>

      {data.roleBreakdown.some((r) => r.totalRuns > 0) && (
        <section>
          <h2 className="mb-3 text-lg font-bold">By Role</h2>
          <RoleBreakdown roles={data.roleBreakdown} />
        </section>
      )}

      {data.dungeonBreakdown.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">By Dungeon</h2>
          <DungeonBreakdown dungeons={data.dungeonBreakdown} />
        </section>
      )}
    </div>
  );
}

function CharactersTab({ data }: { data: DashboardResult }) {
  if (data.characters.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No characters linked to your account yet.
      </div>
    );
  }
  return <CharacterCards characters={data.characters} />;
}
