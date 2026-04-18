import Link from "next/link";
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
            <tr
              key={`${run.id}-${run.characterName}`}
              className="border-b border-border/50 transition-colors hover:bg-muted/30"
            >
              <td className="px-4 py-3">
                <Link href={`/runs/${run.id}`} className="block w-full">
                  <span
                    style={{ color: getClassColor(run.characterClass) }}
                    className="font-medium hover:underline"
                  >
                    {run.characterName}
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <Link href={`/runs/${run.id}`} className="block w-full hover:underline">
                  {run.dungeonName}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link href={`/runs/${run.id}`} className="block w-full">
                  +{run.level}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link href={`/runs/${run.id}`} className="block w-full">
                  <span className={run.onTime ? "text-green-400" : "text-red-400"}>
                    {formatUpgrades(run.upgrades, run.onTime)}
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <Link href={`/runs/${run.id}`} className="block w-full">
                  {run.deaths}
                </Link>
              </td>
              <td className="px-4 py-3 font-semibold">
                <Link href={`/runs/${run.id}`} className="block w-full">
                  {formatNumber(run.juice)}
                </Link>
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                <Link href={`/runs/${run.id}`} className="block w-full">
                  {formatDate(run.recordedAt)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
