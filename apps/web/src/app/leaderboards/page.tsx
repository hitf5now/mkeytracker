import type { Metadata } from "next";
import { Suspense } from "react";
import { fetchApi } from "@/lib/api";
import type { LeaderboardResult } from "@/types/api";
import { CategorySelector } from "@/components/category-selector";
import { LeaderboardTable } from "@/components/leaderboard-table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboards",
  description: "M+ Tracker leaderboards — season Juice, highest key, most timed runs, and fastest clears.",
};

interface Props {
  searchParams: Promise<{ category?: string }>;
}

async function LeaderboardContent({
  category,
}: {
  category: string;
}) {
  const data = await fetchApi<LeaderboardResult>(
    `/api/v1/leaderboards/${category}?limit=25`,
  );

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
        <LeaderboardTable entries={data.entries} />
      </div>
    </div>
  );
}

export default async function LeaderboardsPage({ searchParams }: Props) {
  const params = await searchParams;
  const category = params.category ?? "season-juice";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-bold">Leaderboards</h1>
      <p className="mt-2 text-muted-foreground">
        Rankings across all tracked players.
      </p>

      <div className="mt-6">
        <Suspense fallback={null}>
          <CategorySelector />
        </Suspense>
      </div>

      <Suspense
        key={category}
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
        <LeaderboardContent category={category} />
      </Suspense>
    </div>
  );
}
