import Link from "next/link";
import { cn } from "@/lib/utils";

export type DashboardTabId =
  | "summary"
  | "characters"
  | "runs"
  | "endorsements";

interface TabDef {
  id: DashboardTabId;
  label: string;
}

const TABS: TabDef[] = [
  { id: "summary", label: "Summary" },
  { id: "characters", label: "Characters" },
  { id: "runs", label: "Runs" },
  { id: "endorsements", label: "Endorsements" },
];

export function parseDashboardTab(raw: string | undefined | string[]): DashboardTabId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "characters" || v === "runs" || v === "endorsements"
    ? v
    : "summary";
}

export function TabNav({ active }: { active: DashboardTabId }) {
  return (
    <nav
      role="tablist"
      aria-label="Dashboard sections"
      className="flex flex-wrap gap-1 border-b border-border"
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            role="tab"
            aria-selected={isActive}
            // Tab switches reset any sub-view query params (e.g. Runs filters)
            // so that leaving-and-returning-to a tab starts fresh.
            href={`/dashboard?tab=${t.id}`}
            scroll={false}
            className={cn(
              "relative px-4 py-2 text-sm font-semibold transition-colors",
              isActive
                ? "text-gold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-0.5 bg-gold"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
