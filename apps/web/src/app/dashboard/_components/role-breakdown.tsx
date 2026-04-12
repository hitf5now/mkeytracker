import type { DashboardRoleBreakdown } from "@/types/api";
import { formatNumber } from "@/lib/format";

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  tank: { label: "Tank", color: "text-blue-400", icon: "🛡" },
  healer: { label: "Healer", color: "text-green-400", icon: "💚" },
  dps: { label: "DPS", color: "text-red-400", icon: "⚔" },
};

export function RoleBreakdown({ roles }: { roles: DashboardRoleBreakdown[] }) {
  if (roles.every((r) => r.totalRuns === 0)) {
    return null;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {roles.map((role) => {
        const config = ROLE_CONFIG[role.role] ?? { label: role.role, color: "text-muted-foreground", icon: "" };
        return (
          <div key={role.role} className="rounded-lg border border-border bg-card p-4">
            <h3 className={`text-sm font-semibold ${config.color}`}>
              {config.icon} {config.label}
            </h3>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Best Key</span>
                <span className="font-medium">{role.bestKey > 0 ? `+${role.bestKey}` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Runs</span>
                <span className="font-medium">{role.totalRuns}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timed</span>
                <span className="font-medium">{role.timedRuns}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Points</span>
                <span className="font-medium">{formatNumber(role.totalPoints)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
