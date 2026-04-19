import type { DashboardOverview } from "@/types/api";

/**
 * Six headline stats for the Summary tab.
 * Timed rate sits next to Completed/Timed so the relationship is visible.
 */
export function OverviewStats({ overview }: { overview: DashboardOverview }) {
  const stats = [
    { label: "Total Runs", value: overview.totalRuns },
    { label: "Timed Runs", value: overview.timedRuns },
    { label: "Depleted Runs", value: overview.depletedRuns },
    {
      label: "Highest Key Timed",
      value: overview.highestKeyTimed > 0 ? `+${overview.highestKeyTimed}` : "—",
    },
    {
      label: "Highest Key Completed",
      value:
        overview.highestKeyCompleted > 0
          ? `+${overview.highestKeyCompleted}`
          : "—",
    },
    {
      label: "Timed Rate",
      value: overview.totalRuns > 0 ? `${overview.timedRate}%` : "—",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-lg border border-border bg-card p-4"
        >
          <p className="text-xs text-muted-foreground">{stat.label}</p>
          <p className="mt-1 text-xl font-bold">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
