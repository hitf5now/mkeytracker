import { cn } from "@/lib/utils";
import type { EventStatus } from "@/types/api";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-green-500/20 text-green-400",
  signups_closed: "bg-yellow-500/20 text-yellow-400",
  in_progress: "bg-blue-500/20 text-blue-400",
  completed: "bg-muted text-muted-foreground",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-red-500/20 text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  signups_closed: "Signups Closed",
  in_progress: "In Progress",
  completed: "Completed",
  draft: "Draft",
  cancelled: "Cancelled",
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
