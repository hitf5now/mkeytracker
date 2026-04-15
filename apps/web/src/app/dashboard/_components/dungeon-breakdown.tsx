import type { DashboardDungeonBreakdown } from "@/types/api";
import { getClassColor } from "@/lib/class-colors";
import { formatDuration, formatNumber } from "@/lib/format";

export function DungeonBreakdown({ dungeons }: { dungeons: DashboardDungeonBreakdown[] }) {
  if (dungeons.length === 0) {
    return <p className="text-sm text-muted-foreground">No dungeon data yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Dungeon</th>
            <th className="px-4 py-3 font-medium">Best Key</th>
            <th className="px-4 py-3 font-medium">Fastest</th>
            <th className="px-4 py-3 font-medium">Timed</th>
            <th className="px-4 py-3 font-medium">Juice</th>
            <th className="px-4 py-3 font-medium">Best With</th>
          </tr>
        </thead>
        <tbody>
          {dungeons.map((d) => (
            <tr key={d.dungeonSlug} className="border-b border-border/50">
              <td className="px-4 py-3 font-medium" title={d.dungeonName}>
                {d.dungeonShortCode}
              </td>
              <td className="px-4 py-3">
                {d.bestKeyLevel > 0 ? `+${d.bestKeyLevel}` : "—"}
              </td>
              <td className="px-4 py-3 font-mono">
                {d.fastestClearMs ? formatDuration(d.fastestClearMs) : "—"}
              </td>
              <td className="px-4 py-3">{d.timedCount}</td>
              <td className="px-4 py-3 font-semibold">{formatNumber(d.totalJuice)}</td>
              <td className="px-4 py-3">
                <span style={{ color: getClassColor(d.bestCharacterClass) }}>
                  {d.bestCharacterName}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
