import type { DashboardRecentRun } from "@/types/api";
import { getClassColor } from "@/lib/class-colors";
import { formatNumber, formatUpgrades, formatDate } from "@/lib/format";

export function RecentRuns({ runs }: { runs: DashboardRecentRun[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No runs recorded yet this season.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Character</th>
            <th className="px-4 py-3 font-medium">Dungeon</th>
            <th className="px-4 py-3 font-medium">Level</th>
            <th className="px-4 py-3 font-medium">Result</th>
            <th className="px-4 py-3 font-medium">Deaths</th>
            <th className="px-4 py-3 font-medium">Juice</th>
            <th className="px-4 py-3 text-right font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={`${run.id}-${run.characterName}`} className="border-b border-border/50">
              <td className="px-4 py-3">
                <span style={{ color: getClassColor(run.characterClass) }} className="font-medium">
                  {run.characterName}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{run.dungeonName}</td>
              <td className="px-4 py-3">+{run.level}</td>
              <td className="px-4 py-3">
                <span className={run.onTime ? "text-green-400" : "text-red-400"}>
                  {formatUpgrades(run.upgrades, run.onTime)}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{run.deaths}</td>
              <td className="px-4 py-3 font-semibold">{formatNumber(run.juice)}</td>
              <td className="px-4 py-3 text-right text-muted-foreground">{formatDate(run.recordedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
