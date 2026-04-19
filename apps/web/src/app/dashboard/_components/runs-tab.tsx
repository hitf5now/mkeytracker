import Link from "next/link";
import type { UserRunsResult } from "@/types/api";
import { getClassColor } from "@/lib/class-colors";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatUpgrades,
} from "@/lib/format";
import { RunsFilter } from "./runs-filter";

interface Props {
  data: UserRunsResult;
  activeRange: "7d" | "30d" | "season" | "all";
  activeCharacterId: number | null;
  activeDungeonId: number | null;
  currentQueryString: string;
}

const PAGE_SIZE = 25;

export function RunsTab({
  data,
  activeRange,
  activeCharacterId,
  activeDungeonId,
  currentQueryString,
}: Props) {
  const page = Math.floor(data.offset / data.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
  const hasPrev = data.offset > 0;
  const hasNext = data.offset + data.limit < data.total;

  return (
    <div className="space-y-4">
      <RunsFilter
        characters={data.filterCharacters}
        dungeons={data.filterDungeons}
        activeCharacterId={activeCharacterId}
        activeDungeonId={activeDungeonId}
        activeRange={activeRange}
      />

      <div className="text-xs text-muted-foreground">
        {data.total.toLocaleString()} run{data.total === 1 ? "" : "s"} match
        {" "}
        {data.total === 1 ? "es" : ""} your filters.
      </div>

      {data.runs.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No runs match your current filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Dungeon</th>
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Character</th>
                <th className="px-4 py-2 text-right font-medium">Juice</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => {
                const color = getClassColor(r.characterClass);
                return (
                  <tr
                    key={`${r.id}-${r.characterId}`}
                    className="border-b border-border/50 hover:bg-background/40"
                  >
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDateTime(r.recordedAt)}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/runs/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.dungeonName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono">+{r.keystoneLevel}</td>
                    <td
                      className={`px-4 py-2 text-xs font-semibold ${r.onTime ? "text-green-400" : "text-red-400"}`}
                    >
                      {formatUpgrades(r.upgrades, r.onTime)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {formatDuration(r.completionMs)}
                    </td>
                    <td className="px-4 py-2 text-sm" style={{ color }}>
                      {r.characterName}{" "}
                      <span className="text-[10px] capitalize text-muted-foreground">
                        {r.roleSnapshot}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-gold">
                      {formatNumber(r.juice)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <PageLink
              enabled={hasPrev}
              href={pageHref(currentQueryString, data.offset - PAGE_SIZE)}
              label="← Previous"
            />
            <PageLink
              enabled={hasNext}
              href={pageHref(currentQueryString, data.offset + PAGE_SIZE)}
              label="Next →"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function pageHref(currentQs: string, nextOffset: number): string {
  const p = new URLSearchParams(currentQs);
  p.set("tab", "runs");
  if (nextOffset <= 0) p.delete("offset");
  else p.set("offset", String(nextOffset));
  return `/dashboard?${p.toString()}`;
}

function PageLink({
  enabled,
  href,
  label,
}: {
  enabled: boolean;
  href: string;
  label: string;
}) {
  if (!enabled) {
    return (
      <span className="cursor-not-allowed rounded border border-border bg-background/40 px-3 py-1 text-xs text-muted-foreground">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      className="rounded border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground hover:bg-background/40"
    >
      {label}
    </Link>
  );
}
