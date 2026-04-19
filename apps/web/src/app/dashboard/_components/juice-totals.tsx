import type { DashboardOverview } from "@/types/api";
import { formatNumber } from "@/lib/format";

export function JuiceTotals({ overview }: { overview: DashboardOverview }) {
  const cards = [
    {
      label: "Personal Juice",
      value: overview.totalJuice,
      hint: `${formatNumber(overview.weeklyJuice)} this week`,
    },
    {
      label: "Event Juice",
      value: overview.totalEventJuice,
      hint: "From event-linked runs",
    },
    {
      label: "Team Juice",
      value: overview.totalTeamJuice,
      hint: "From runs where the full 5 shared a team",
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {c.label}
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-gold">
            {formatNumber(c.value)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {c.hint}
          </div>
        </div>
      ))}
    </div>
  );
}
