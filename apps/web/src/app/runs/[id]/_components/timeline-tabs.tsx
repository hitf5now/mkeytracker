"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TimelineTabId = "damage" | "healing" | "tanking";

interface TabDef {
  id: TimelineTabId;
  label: string;
  /** Optional — suppresses the tab if no data is available for it. */
  available: boolean;
  /** Pre-rendered content for this tab (a ReactNode, not a function). */
  content: ReactNode;
}

interface Props {
  tabs: TabDef[];
  defaultTab?: TimelineTabId;
}

export function TimelineTabs({ tabs, defaultTab = "damage" }: Props) {
  const visibleTabs = tabs.filter((t) => t.available);
  const firstAvailable = visibleTabs[0]?.id ?? defaultTab;
  const [active, setActive] = useState<TimelineTabId>(
    visibleTabs.some((t) => t.id === defaultTab) ? defaultTab : firstAvailable,
  );

  if (visibleTabs.length === 0) return null;

  const activeTab = visibleTabs.find((t) => t.id === active) ?? visibleTabs[0]!;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Timeline metrics"
        className="flex gap-1 border-b border-border"
      >
        {visibleTabs.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(t.id)}
              className={cn(
                "relative px-4 py-2 text-sm font-semibold transition-colors",
                selected
                  ? "text-gold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {selected && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-gold"
                />
              )}
            </button>
          );
        })}
      </div>
      {visibleTabs.map((t) => (
        <div
          key={t.id}
          className="mt-3 rounded-lg border border-border bg-card p-3"
          hidden={t.id !== active}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
