import { cn } from "@/lib/utils";

const ROLE_CONFIG = {
  tank: { label: "Tank", color: "text-blue-400" },
  healer: { label: "Healer", color: "text-green-400" },
  dps: { label: "DPS", color: "text-red-400" },
} as const;

interface RoleIconProps {
  role: string;
  className?: string;
  showLabel?: boolean;
}

export function RoleIcon({ role, className, showLabel = false }: RoleIconProps) {
  const config = ROLE_CONFIG[role as keyof typeof ROLE_CONFIG] ?? {
    label: role,
    color: "text-muted-foreground",
  };

  return (
    <span className={cn("inline-flex items-center gap-1", config.color, className)}>
      <span className="text-xs font-semibold uppercase">{config.label}</span>
    </span>
  );
}
