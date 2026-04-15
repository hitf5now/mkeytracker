import type { DashboardOverview } from "@/types/api";
import { formatNumber } from "@/lib/format";

export function OverviewStats({ overview }: { overview: DashboardOverview }) {
  const stats = [
    { label: "Total Runs", value: overview.totalRuns },
    { label: "Timed", value: overview.timedRuns },
    { label: "Depleted", value: overview.depletedRuns },
    { label: "Deaths", value: overview.totalDeaths },
    { label: "Highest Key", value: overview.highestKeyCompleted > 0 ? `+${overview.highestKeyCompleted}` : "—" },
    { label: "Season Juice", value: formatNumber(overview.totalJuice) },
    { label: "Weekly Juice", value: formatNumber(overview.weeklyJuice) },
    { label: "Timed Rate", value: overview.totalRuns > 0 ? `${overview.timedRate}%` : "—" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">{stat.label}</p>
          <p className="mt-1 text-xl font-bold">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
