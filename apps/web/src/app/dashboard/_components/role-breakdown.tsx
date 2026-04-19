import type { BestRunRef, DashboardRoleBreakdown } from "@/types/api";
import { formatNumber } from "@/lib/format";
import { getClassColor } from "@/lib/class-colors";

const ROLE_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  tank: { label: "Tank", color: "text-blue-400" },
  healer: { label: "Healer", color: "text-green-400" },
  dps: { label: "DPS", color: "text-red-400" },
};

function BestRunCell({ pick, label }: { pick: BestRunRef | null; label: string }) {
  if (!pick) {
    return (
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-muted-foreground">—</span>
      </div>
    );
  }
  const color = getClassColor(pick.characterClass);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold text-gold">
          +{pick.level}
        </span>
      </div>
      <div className="text-right text-[11px] text-muted-foreground">
        {pick.dungeonShortCode} ·{" "}
        <span style={{ color }}>{pick.characterName}</span>
      </div>
    </div>
  );
}

export function RoleBreakdown({ roles }: { roles: DashboardRoleBreakdown[] }) {
  if (roles.every((r) => r.totalRuns === 0)) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {roles.map((role) => {
        const config = ROLE_CONFIG[role.role] ?? {
          label: role.role,
          color: "text-muted-foreground",
        };
        return (
          <div
            key={role.role}
            className="rounded-lg border border-border bg-card p-4"
          >
            <h3 className={`text-sm font-semibold uppercase tracking-wide ${config.color}`}>
              {config.label}
            </h3>
            <div className="mt-3 space-y-2 text-sm">
              <BestRunCell pick={role.bestKeyCompleted} label="Best Completed" />
              <BestRunCell pick={role.bestKeyTimed} label="Best Timed" />
              <div className="flex justify-between border-t border-border/50 pt-2">
                <span className="text-muted-foreground">Runs</span>
                <span className="font-medium">{role.totalRuns}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timed</span>
                <span className="font-medium">{role.timedRuns}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Juice</span>
                <span className="font-medium text-gold">
                  {formatNumber(role.totalJuice)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
