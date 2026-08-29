import type { Metadata } from "next";
import { Suspense } from "react";
import { fetchApi } from "@/lib/api";
import type { LeaderboardResult, SeasonsResponse, DungeonsResponse } from "@/types/api";
import { CategorySelector } from "@/components/category-selector";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { SeasonPicker } from "@/components/season-picker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "M+ Tracker leaderboards — season Juice, highest key, most timed runs, and fastest clears.",
};

interface Props {
  searchParams: Promise<{ category?: string; season?: string }>;
}

async function LeaderboardContent({
  category,
  season,
}: {
  category: string;
  season: string | undefined;
}) {
  const qs = new URLSearchParams({ limit: "25" });
  if (season) qs.set("season", season);

  let data: LeaderboardResult;
  try {
    data = await fetchApi<LeaderboardResult>(
      `/api/v1/leaderboards/${category}?${qs.toString()}`,
    );
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

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-muted-foreground">
          {data.season.name}
        </h2>
        <p className="text-xs text-muted-foreground">
          {data.entries.length} entries
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <LeaderboardTable entries={data.entries} category={category} />
      </div>
    </div>
  );
}

export default async function LeaderboardsPage({ searchParams }: Props) {
  const params = await searchParams;
  const category = params.category ?? "season-juice";
  const season = params.season;

  const dungeonQs = season ? `?season=${encodeURIComponent(season)}` : "";
  const [seasons, dungeons] = await Promise.all([
    fetchApi<SeasonsResponse>("/api/v1/seasons"),
    fetchApi<DungeonsResponse>(`/api/v1/dungeons${dungeonQs}`),
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
          <CategorySelector dungeons={dungeons.dungeons} />
        </Suspense>
      </div>

      <Suspense
        key={`${category}:${season ?? "active"}`}
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
        <LeaderboardContent category={category} season={season} />
      </Suspense>
    </div>
  );
}
