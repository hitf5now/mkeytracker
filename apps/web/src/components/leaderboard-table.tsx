import type { LeaderboardEntry } from "@/types/api";
import { ClassBadge } from "./class-badge";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  /** When "season-juice", show the rich column set. Others get the compact view. */
  category?: string;
}

/**
 * Public leaderboard table.
 *
 * Season-juice view (the default at /leaderboards) shows the rich column
 * set: Rank, Player, Personal Juice, Team Juice, Event Juice, Run Count,
 * Endorsements. Realm + Spec were removed in the Phase 4 overhaul —
 * players vary characters across seasons and specs, so those columns
 * were visual clutter more than useful context.
 *
 * Other category views (highest-key, most-timed, fastest-clear-*) still
 * use the compact 3-column fallback since their shape doesn't carry the
 * per-run aggregates.
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
  return <CompactTable entries={entries} />;
}

function SeasonJuiceTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="w-16 px-4 py-3 font-medium">Rank</th>
            <th className="px-4 py-3 font-medium">Player</th>
            <th className="px-4 py-3 text-right font-medium">Personal Juice</th>
            <th className="px-4 py-3 text-right font-medium">Team Juice</th>
            <th className="px-4 py-3 text-right font-medium">Event Juice</th>
            <th className="px-4 py-3 text-right font-medium">Runs</th>
            <th className="px-4 py-3 text-right font-medium">Endorsements</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={`${entry.character.id}-${entry.rank}`}
              className="border-b border-border/50 transition-colors hover:bg-accent/50"
            >
              <td className="px-4 py-3 font-mono text-muted-foreground">
                {entry.rank <= 3 ? (
                  <span className="font-bold text-gold">#{entry.rank}</span>
                ) : (
                  `#${entry.rank}`
                )}
              </td>
              <td className="px-4 py-3">
                <ClassBadge
                  name={entry.character.name}
                  realm={entry.character.realm}
                  region={entry.character.region}
                  classSlug={entry.character.class}
                />
              </td>
              <td className="px-4 py-3 text-right font-semibold">
                {(entry.personalJuice ?? entry.value).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {formatAggregate(entry.teamJuice)}
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {formatAggregate(entry.eventJuice)}
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {entry.runCount ?? "—"}
              </td>
              <td className="px-4 py-3 text-right">
                {entry.endorsementsReceived != null &&
                entry.endorsementsReceived > 0 ? (
                  <span className="font-medium text-gold">
                    {entry.endorsementsReceived}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompactTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="w-16 px-4 py-3 font-medium">Rank</th>
            <th className="px-4 py-3 font-medium">Player</th>
            <th className="px-4 py-3 text-right font-medium">Score</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={`${entry.character.id}-${entry.rank}`}
              className="border-b border-border/50 transition-colors hover:bg-accent/50"
            >
              <td className="px-4 py-3 font-mono text-muted-foreground">
                {entry.rank <= 3 ? (
                  <span className="font-bold text-gold">#{entry.rank}</span>
                ) : (
                  `#${entry.rank}`
                )}
              </td>
              <td className="px-4 py-3">
                <ClassBadge
                  name={entry.character.name}
                  realm={entry.character.realm}
                  region={entry.character.region}
                  classSlug={entry.character.class}
                />
              </td>
              <td className="px-4 py-3 text-right font-semibold">
                {entry.displayValue}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatAggregate(value: number | undefined): string {
  if (value == null || value === 0) return "—";
  return value.toLocaleString();
}
