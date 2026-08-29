import type { Metadata } from "next";
import { Suspense } from "react";
import { fetchApi } from "@/lib/api";
import type {
  LeaderboardResult,
  ClassChampionsResult,
  BoardCatalog,
  SeasonsResponse,
  DungeonsResponse,
} from "@/types/api";
import { CategorySelector } from "@/components/category-selector";
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
  try {
    data = await fetchApi<LeaderboardResult | ClassChampionsResult>(path);
  } catch {
    // The dungeon pool changes every season, so a fastest-clear category
    // from another season legitimately doesn't exist here. Say so instead
    // of rendering an empty board that reads as "nobody has run this".
    return (
      <div className="mt-6 rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        This leaderboard isn&apos;t available for the selected season — the
        dungeon pool changes each season. Pick another category or season.
      </div>
    );
  }

  const full = data as LeaderboardResult;

  return (
    <div className="mt-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {champions ? `Class Champions — ${data.label}` : data.label}
        </h2>
        <p className="text-xs text-muted-foreground">
          {data.season.name} · {data.entries.length}{" "}
          {champions ? "classes" : "entries"}
        </p>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{data.description}</p>

      <div className="rounded-lg border border-border bg-card">
        {data.entries.length === 0 ? (
          <EmptyBoard
            needsEnrichment={full.needsEnrichment ?? false}
            minRuns={full.minRuns ?? null}
            classFilter={classFilter}
          />
        ) : (
          <LeaderboardTable
            entries={data.entries}
            category={champions ? "champions" : data.category}
          />
        )}
      </div>
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
      <p>No entries on this board yet.</p>
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Leaderboards</h1>
          <p className="mt-2 text-muted-foreground">
            Rankings across all tracked players.
          </p>
        </div>
        {/* No "All seasons": a board mixing a finished season with a
            three-week-old one ranks nothing meaningful. */}
        <SeasonPicker data={seasons} value={season} allowAll={false} />
      </div>

      <div className="mt-6">
        <Suspense fallback={null}>
          <CategorySelector boards={catalog.boards} dungeons={dungeons.dungeons} />
        </Suspense>
      </div>

      <Suspense
        key={`${category}:${season ?? "active"}:${classFilter ?? "all"}:${champions}`}
        fallback={
          <div className="mt-6 animate-pulse">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-12 rounded bg-muted" />
              ))}
            </div>
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
    </div>
  );
}
