import Link from "next/link";
import type { EventResults, EventGroupStanding, EventRunDetail } from "@/types/api";
import { ClassBadge } from "@/components/class-badge";
import { formatDuration, formatNumber, formatUpgrades } from "@/lib/format";

interface Props {
  results: EventResults;
  /**
   * If false, suppresses the gap-to-#1 messaging (e.g. for completed events
   * where the chase no longer matters).
   */
  showGapHints?: boolean;
}

const RANK_BORDER: Record<number, string> = {
  1: "border-yellow-500/60 bg-yellow-500/5",
  2: "border-gray-400/60 bg-gray-400/5",
  3: "border-amber-700/60 bg-amber-700/5",
};

const RANK_EMOJI: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function EventLeaderboard({ results, showGapHints = true }: Props) {
  if (results.standings.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No groups have submitted runs yet.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {results.standings.map((standing) => (
        <StandingCard
          key={standing.groupId}
          standing={standing}
          showGapHint={showGapHints && standing.rank > 1}
        />
      ))}
    </div>
  );
}

function StandingCard({
  standing,
  showGapHint,
}: {
  standing: EventGroupStanding;
  showGapHint: boolean;
}) {
  const border = RANK_BORDER[standing.rank] ?? "border-border bg-card";
  const emoji = RANK_EMOJI[standing.rank];
  const hasRuns = (standing.runs?.length ?? 0) > 0;

  return (
    <details className={`group rounded-lg border-2 ${border} open:bg-opacity-100`}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <span className="w-8 shrink-0 text-center text-lg font-bold tabular-nums">
            {emoji ?? `#${standing.rank}`}
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-foreground">
              {standing.groupName}
            </h3>
            <p className="text-xs text-muted-foreground">
              {standing.runCount} run{standing.runCount !== 1 ? "s" : ""}
              {hasRuns && (
                <span className="ml-2 text-muted-foreground/60">
                  · click to expand
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-base text-gold tabular-nums">
            {standing.displayScore}
          </p>
          {showGapHint && standing.gapToFirst && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              −{formatNumber(standing.gapToFirst.scoreGap)} from #1
            </p>
          )}
        </div>
      </summary>

      {/* Members + runs (revealed on expand) */}
      <div className="space-y-3 border-t border-border/40 px-4 py-3">
        {/* Members row */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Roster
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {standing.members.map((m, i) => (
              <li key={`${m.realm}-${m.characterName}-${i}`}>
                <ClassBadge
                  name={m.characterName}
                  realm={m.realm}
                  region="us"
                  classSlug={m.classSlug}
                />
              </li>
            ))}
          </ul>
        </div>

        {/* Runs table */}
        {hasRuns ? (
          <RunsTable runs={standing.runs!} />
        ) : (
          <p className="text-xs text-muted-foreground">No runs yet.</p>
        )}

        {/* Gap hint */}
        {showGapHint && standing.gapToFirst && (
          <div className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gold">
              How to take #1
            </p>
            <p className="mt-1 text-sm text-foreground">
              {standing.gapToFirst.hint}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

function RunsTable({ runs }: { runs: EventRunDetail[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Runs
      </p>
      <div className="overflow-hidden rounded-md border border-border/40">
        <table className="w-full text-sm">
          <thead className="bg-background/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Dungeon</th>
              <th className="px-2 py-1.5 text-right font-medium">Key</th>
              <th className="px-2 py-1.5 text-right font-medium">Result</th>
              <th className="px-2 py-1.5 text-right font-medium">Time</th>
              <th className="px-2 py-1.5 text-right font-medium">Deaths</th>
              <th className="px-2 py-1.5 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.runId}
                className={`border-t border-border/30 transition-colors hover:bg-muted/30 ${r.counted ? "" : "text-muted-foreground/70"}`}
              >
                <td className="px-2 py-1.5">
                  <Link href={`/runs/${r.runId}`} className="block w-full hover:underline">
                    {r.dungeonShortCode ?? r.dungeonName ?? `#${r.dungeonId}`}
                    {!r.counted && (
                      <span
                        className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/60"
                        title="Not counted toward this group's leaderboard score"
                      >
                        (not counted)
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  <Link href={`/runs/${r.runId}`} className="block w-full">
                    +{r.keystoneLevel}
                  </Link>
                </td>
                <td
                  className={`px-2 py-1.5 text-right font-medium ${r.onTime ? "text-green-400" : "text-red-400"}`}
                >
                  <Link href={`/runs/${r.runId}`} className="block w-full">
                    {formatUpgrades(r.upgrades, r.onTime)}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  <Link href={`/runs/${r.runId}`} className="block w-full">
                    {formatDuration(r.completionMs)}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  <Link href={`/runs/${r.runId}`} className="block w-full">
                    {r.deaths}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-gold">
                  <Link href={`/runs/${r.runId}`} className="block w-full">
                    {formatNumber(r.runScore)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
