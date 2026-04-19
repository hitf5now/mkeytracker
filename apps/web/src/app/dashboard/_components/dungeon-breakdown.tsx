import type { DashboardDungeonBreakdown } from "@/types/api";
import { getClassColor } from "@/lib/class-colors";
import { formatDuration, formatNumber } from "@/lib/format";

function KeyCell({
  pick,
}: {
  pick: DashboardDungeonBreakdown["bestKeyCompleted"];
}) {
  if (!pick) return <span className="text-muted-foreground">—</span>;
  const color = getClassColor(pick.characterClass);
  return (
    <div className="leading-tight">
      <div className="font-mono font-semibold text-gold">+{pick.level}</div>
      <div className="text-[11px]" style={{ color }}>
        {pick.characterName}
      </div>
    </div>
  );
}

export function DungeonBreakdown({
  dungeons,
}: {
  dungeons: DashboardDungeonBreakdown[];
}) {
  if (dungeons.length === 0) {
    return <p className="text-sm text-muted-foreground">No dungeon data yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Dungeon</th>
            <th className="px-4 py-3 font-medium">Best Completed</th>
            <th className="px-4 py-3 font-medium">Best Timed</th>
            <th className="px-4 py-3 font-medium">Fastest</th>
            <th className="px-4 py-3 text-right font-medium">Timed</th>
            <th className="px-4 py-3 text-right font-medium">Juice</th>
          </tr>
        </thead>
        <tbody>
          {dungeons.map((d) => (
            <tr key={d.dungeonSlug} className="border-b border-border/50">
              <td className="px-4 py-3 font-medium" title={d.dungeonName}>
                {d.dungeonName}
              </td>
              <td className="px-4 py-3">
                <KeyCell pick={d.bestKeyCompleted} />
              </td>
              <td className="px-4 py-3">
                <KeyCell pick={d.bestKeyTimed} />
              </td>
              <td className="px-4 py-3 font-mono">
                {d.fastestClearMs ? formatDuration(d.fastestClearMs) : "—"}
              </td>
              <td className="px-4 py-3 text-right">{d.timedCount}</td>
              <td className="px-4 py-3 text-right font-semibold text-gold">
                {formatNumber(d.totalJuice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
