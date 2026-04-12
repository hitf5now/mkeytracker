import type { LeaderboardEntry } from "@/types/api";
import { ClassBadge } from "./class-badge";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
}

export function LeaderboardTable({ entries }: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <p className="py-12 text-center text-muted-foreground">
        No entries yet. Be the first to submit a run!
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="w-16 px-4 py-3 font-medium">Rank</th>
            <th className="px-4 py-3 font-medium">Player</th>
            <th className="px-4 py-3 font-medium">Realm</th>
            <th className="px-4 py-3 font-medium">Spec</th>
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
              <td className="px-4 py-3 text-muted-foreground">
                {entry.character.realm}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {entry.character.spec}
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
