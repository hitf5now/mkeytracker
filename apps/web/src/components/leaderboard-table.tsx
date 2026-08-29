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
 * The champions view swaps the rank column for the class, since "best of
 * every class" is read down the class column rather than by position.
 *
 * Every other board uses the compact view: rank, player, value, and the run
 * count behind it — a 20-kicks-per-run average over 5 runs and over 40 is
 * not the same claim, so the sample size belongs next to the number.
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
  if (category === "champions") {
    return <ChampionsTable entries={entries} />;
  }
  return <CompactTable entries={entries} />;
}

/**
 * One row per class, best player first. The class is the primary column
 * because the question this answers is "who is the top Druid", not "who is
 * eleventh overall".
 */
function ChampionsTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Class</th>
            <th className="px-4 py-3 font-medium">Champion</th>
            <th className="px-4 py-3 text-right font-medium">Score</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
              Runs
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.character.id}
              className="border-b border-border/50 transition-colors hover:bg-accent/50"
            >
              <td className="px-4 py-3 font-medium capitalize">
                {(entry.context ?? entry.character.class).replace("-", " ")}
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
              <td className="hidden px-4 py-3 text-right text-muted-foreground sm:table-cell">
                {entry.runCount ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
              Runs
            </th>
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
              <td className="hidden px-4 py-3 text-right text-muted-foreground sm:table-cell">
                {entry.runCount ?? "—"}
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
