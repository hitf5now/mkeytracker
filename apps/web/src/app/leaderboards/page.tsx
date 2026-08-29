import type { Metadata } from "next";
import { Suspense } from "react";
import { fetchApi } from "@/lib/api";
import type {
  LeaderboardResult,
  ClassChampionsResult,
  BoardCatalog,
  SeasonsResponse,
  DungeonsResponse,
  TierSetsResult,
} from "@/types/api";
import { BoardRail } from "@/components/board-rail";
import { ClassFilter } from "@/components/class-filter";
import { ChampionsWall } from "@/components/champions-wall";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { SeasonPicker } from "@/components/season-picker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboards",
  description:
    "M+ Tracker leaderboards — Juice, keys, interrupts, dispels, damage, healing, achievements and per-class champions.",
};

interface Props {
  searchParams: Promise<{
    category?: string;
    season?: string;
    class?: string;
    view?: string;
  }>;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

const EMPTY_TIER_SETS: TierSetsResult = { sets: [], resolvedAt: "" };

async function LeaderboardContent({
  category,
  season,
  classFilter,
  champions,
}: {
  category: string;
  season: string | undefined;
  classFilter: string | undefined;
  champions: boolean;
}) {
  const path = champions
    ? `/api/v1/leaderboards/champions/${category}${buildQuery({ season })}`
    : `/api/v1/leaderboards/${category}${buildQuery({
        season,
        class: classFilter,
        limit: "25",
      })}`;

  let data: LeaderboardResult | ClassChampionsResult;
  let tierSets: TierSetsResult = EMPTY_TIER_SETS;
  try {
    [data, tierSets] = await Promise.all([
      fetchApi<LeaderboardResult | ClassChampionsResult>(path),
      champions
        ? fetchApi<TierSetsResult>("/api/v1/tier-sets", { revalidate: 86400 })
        : Promise.resolve(EMPTY_TIER_SETS),
    ]);
  } catch {
    // The dungeon pool changes every season, so a fastest-clear category
    // from another season legitimately doesn't exist here. Say so instead
    // of rendering an empty board that reads as "nobody has run this".
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        This leaderboard isn&apos;t available for the selected season — the
        dungeon pool changes each season. Pick another board or season.
      </div>
    );
  }

  const full = data as LeaderboardResult;

  return (
    <div>
      <header className="mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-2xl uppercase tracking-wide text-foreground">
            {champions ? "Class Champions" : data.label}
          </h2>
          <p className="text-xs tabular-nums text-muted-foreground">
            {data.entries.length} {champions ? "classes" : "ranked"}
          </p>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {champions
            ? `The top ${data.label.toLowerCase()} of every class, shown in this patch's tier set.`
            : data.description}
        </p>
      </header>

      {data.entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyBoard
            needsEnrichment={full.needsEnrichment ?? false}
            minRuns={full.minRuns ?? null}
            classFilter={classFilter}
          />
        </div>
      ) : champions ? (
        <ChampionsWall
          entries={data.entries}
          tierSets={tierSets.sets}
          metricLabel={data.label}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <LeaderboardTable entries={data.entries} category={data.category} />
        </div>
      )}
    </div>
  );
}

/**
 * An empty board almost always has a specific, explainable cause. Naming it
 * turns a dead end into something the reader can act on.
 */
function EmptyBoard({
  needsEnrichment,
  minRuns,
  classFilter,
}: {
  needsEnrichment: boolean;
  minRuns: number | null;
  classFilter: string | undefined;
}) {
  return (
    <div className="space-y-2 px-6 py-12 text-center text-sm text-muted-foreground">
      <p className="text-foreground">No entries on this board yet.</p>
      {needsEnrichment && (
        <p>
          This board is built from combat logs. Runs only carry combat data
          when the companion app can match them to a log file, so a new season
          takes a while to fill in.
        </p>
      )}
      {minRuns !== null && (
        <p>Players need at least {minRuns} runs this season to qualify.</p>
      )}
      {classFilter && <p>Try removing the class filter.</p>}
    </div>
  );
}

export default async function LeaderboardsPage({ searchParams }: Props) {
  const params = await searchParams;
  const category = params.category ?? "season-juice";
  const season = params.season;
  const classFilter = params.class;
  const champions = params.view === "champions";

  const [seasons, dungeons, catalog] = await Promise.all([
    fetchApi<SeasonsResponse>("/api/v1/seasons"),
    fetchApi<DungeonsResponse>(`/api/v1/dungeons${buildQuery({ season })}`),
    fetchApi<BoardCatalog>("/api/v1/leaderboards"),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <div>
          <h1 className="font-display text-4xl uppercase tracking-wide">
            Leaderboards
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every measure we track, ranked within a season.
          </p>
        </div>
        {/* No "All seasons": a board mixing a finished season with a
            three-week-old one ranks nothing meaningful. */}
        <SeasonPicker data={seasons} value={season} allowAll={false} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <BoardRail
            boards={catalog.boards}
            dungeons={dungeons.dungeons}
            current={category}
            champions={champions}
          />
        </aside>

        <section className="min-w-0">
          {/* Champions already shows all thirteen classes, so a class
              filter there would be a control with nothing to do. */}
          {!champions && (
            <div className="mb-5">
              <ClassFilter value={classFilter} />
            </div>
          )}

          <Suspense
            key={`${category}:${season ?? "active"}:${classFilter ?? "all"}:${champions}`}
            fallback={
              <div className="animate-pulse space-y-3">
                <div className="h-8 w-48 rounded bg-muted" />
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-12 rounded bg-muted" />
                ))}
              </div>
            }
          >
            <LeaderboardContent
              category={category}
              season={season}
              classFilter={classFilter}
              champions={champions}
            />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
