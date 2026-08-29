import Link from "next/link";
import { getClassIconUrl } from "@mplus/wow-constants";
import { getClassColor, getClassName } from "@/lib/class-colors";
import type { LeaderboardEntry } from "@/types/api";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  /** "season-juice" gets the Juice breakdown; everything else is ranked rows. */
  category?: string;
}

/**
 * Ranked leaderboard rows.
 *
 * Each row carries a rail in the player's class colour, so scanning the
 * board shows the class spread at a glance — which is how this audience
 * reads a ladder. Only rank 1 takes the site's gold; every other colour on
 * the page comes from the data rather than a decorative palette.
 *
 * Values are set in the condensed display face with tabular figures, so the
 * score column stays aligned whatever the digit widths.
 */
export function LeaderboardTable({
  entries,
  category = "season-juice",
}: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <p className="py-12 text-center text-muted-foreground">
        No entries yet. Be the first to submit a run!
      </p>
    );
  }

  if (category === "season-juice") {
    return <SeasonJuiceTable entries={entries} />;
  }
  return <RankedRows entries={entries} />;
}

function RankedRows({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <ol className="divide-y divide-border/60">
      {entries.map((entry) => {
        const color = getClassColor(entry.character.class);
        const isLead = entry.rank === 1;
        return (
          <li key={`${entry.character.id}-${entry.rank}`}>
            <Link
              href={`/players/${entry.character.region}/${entry.character.realm}/${entry.character.name}`}
              className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold sm:px-4"
            >
              <span
                aria-hidden
                className="h-8 w-[3px] shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />

              <span
                className={
                  "w-7 shrink-0 font-display text-lg leading-none tabular-nums " +
                  (isLead ? "text-gold" : "text-muted-foreground")
                }
              >
                {entry.rank}
              </span>

              <img
                src={getClassIconUrl(entry.character.class, "medium")}
                alt=""
                title={getClassName(entry.character.class)}
                className="hidden h-7 w-7 shrink-0 rounded-sm sm:block"
                loading="lazy"
              />

              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" style={{ color }}>
                  {entry.character.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {entry.character.realm}
                  {entry.context ? ` · ${entry.context}` : ""}
                </span>
              </span>

              <span className="shrink-0 text-right">
                <span className="block font-display text-lg leading-none tabular-nums text-foreground">
                  {entry.displayValue}
                </span>
                {entry.runCount !== undefined && (
                  <span className="block text-[11px] text-muted-foreground">
                    {entry.runCount} runs
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function SeasonJuiceTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="w-12 px-3 py-3 font-medium sm:px-4">#</th>
            <th className="px-3 py-3 font-medium sm:px-4">Player</th>
            <th className="px-3 py-3 text-right font-medium sm:px-4">Personal</th>
            <th className="hidden px-4 py-3 text-right font-medium md:table-cell">Team</th>
            <th className="hidden px-4 py-3 text-right font-medium md:table-cell">Event</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Runs</th>
            <th className="hidden px-4 py-3 text-right font-medium lg:table-cell">Endorsed</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const color = getClassColor(entry.character.class);
            return (
              <tr
                key={`${entry.character.id}-${entry.rank}`}
                className="border-b border-border/50 transition-colors hover:bg-accent/40"
              >
                <td className="px-3 py-2.5 sm:px-4">
                  <span
                    className={
                      "font-display text-lg leading-none tabular-nums " +
                      (entry.rank === 1 ? "text-gold" : "text-muted-foreground")
                    }
                  >
                    {entry.rank}
                  </span>
                </td>
                <td className="px-3 py-2.5 sm:px-4">
                  <Link
                    href={`/players/${entry.character.region}/${entry.character.realm}/${entry.character.name}`}
                    className="inline-flex items-center gap-2 hover:underline"
                  >
                    <img
                      src={getClassIconUrl(entry.character.class, "medium")}
                      alt=""
                      title={getClassName(entry.character.class)}
                      className="h-6 w-6 rounded-sm"
                      loading="lazy"
                    />
                    <span className="font-medium" style={{ color }}>
                      {entry.character.name}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right font-display text-base tabular-nums sm:px-4">
                  {formatAggregate(entry.personalJuice ?? entry.value)}
                </td>
                <td className="hidden px-4 py-2.5 text-right tabular-nums text-muted-foreground md:table-cell">
                  {formatAggregate(entry.teamJuice)}
                </td>
                <td className="hidden px-4 py-2.5 text-right tabular-nums text-muted-foreground md:table-cell">
                  {formatAggregate(entry.eventJuice)}
                </td>
                <td className="hidden px-4 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">
                  {entry.runCount ?? "—"}
                </td>
                <td className="hidden px-4 py-2.5 text-right tabular-nums text-muted-foreground lg:table-cell">
                  {entry.endorsementsReceived ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatAggregate(value: number | undefined): string {
  if (value === undefined || value === null) return "—";
  return value.toLocaleString();
}
