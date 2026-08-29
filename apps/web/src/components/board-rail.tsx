"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { BoardSummary, BoardGroup } from "@/types/api";

/**
 * Board navigation.
 *
 * There are fifteen boards plus one per dungeon in the season. As wrapped
 * chips that was a wall of thirty-odd buttons with no hierarchy; as a
 * grouped vertical list the group headings do the sorting and any single
 * board is one glance away. On mobile the same list collapses to a native
 * select, which beats a scrolling chip field on a small screen.
 */

const GROUP_LABELS: Array<{ group: BoardGroup; label: string }> = [
  { group: "overall", label: "Overall" },
  { group: "combat", label: "Combat" },
  { group: "consistency", label: "Consistency" },
  { group: "achievements", label: "Achievements" },
  { group: "records", label: "Records" },
];

const ROLE_MARK: Record<string, string> = {
  tank: "Tank",
  healer: "Healer",
  dps: "DPS",
};

interface Props {
  boards: BoardSummary[];
  dungeons: Array<{ slug: string; name: string; shortCode: string }>;
  current: string;
  champions: boolean;
}

export function BoardRail({ boards, dungeons, current, champions }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function go(changes: Record<string, string | null>) {
    const qs = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") qs.delete(k);
      else qs.set(k, v);
    }
    router.push(`/leaderboards?${qs.toString()}`, { scroll: false });
  }

  const groups = GROUP_LABELS.map((g) => ({
    ...g,
    items: boards.filter((b) => b.group === g.group),
  })).filter((g) => g.items.length > 0);

  const allOptions = [
    ...boards.map((b) => ({ value: b.key, label: b.label })),
    ...dungeons.map((d) => ({
      value: `fastest-clear-${d.slug}`,
      label: `Fastest — ${d.name}`,
    })),
  ];

  return (
    <>
      {/* Mobile: one select instead of a scrolling field of buttons. */}
      <div className="lg:hidden">
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wider text-muted-foreground">Board</span>
          <select
            className="rounded border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
            value={current}
            onChange={(e) => go({ category: e.target.value })}
          >
            {groups.map((g) => (
              <optgroup key={g.group} label={g.label}>
                {g.items.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {dungeons.length > 0 && (
              <optgroup label="Fastest clear">
                {allOptions
                  .filter((o) => o.value.startsWith("fastest-clear-"))
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </label>
      </div>

      <nav className="hidden lg:block" aria-label="Leaderboard categories">
        <RailButton
          label="Class Champions"
          hint="Best of every class"
          active={champions}
          onClick={() => go({ view: "champions", class: null })}
          feature
        />

        {groups.map((g) => (
          <div key={g.group} className="mt-5">
            <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {g.label}
            </p>
            {g.items.map((b) => (
              <RailButton
                key={b.key}
                label={b.label}
                hint={b.roleGate ? ROLE_MARK[b.roleGate] : undefined}
                active={!champions && current === b.key}
                onClick={() => go({ category: b.key, view: null })}
              />
            ))}
          </div>
        ))}

        {dungeons.length > 0 && (
          <div className="mt-5">
            <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Fastest clear
            </p>
            {dungeons.map((d) => (
              <RailButton
                key={d.slug}
                label={d.name}
                hint={d.shortCode}
                active={!champions && current === `fastest-clear-${d.slug}`}
                onClick={() => go({ category: `fastest-clear-${d.slug}`, view: null })}
              />
            ))}
          </div>
        )}
      </nav>
    </>
  );
}

function RailButton({
  label,
  hint,
  active,
  onClick,
  feature = false,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
  feature?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold",
        active
          ? "bg-gold/10 font-semibold text-gold"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        feature && !active && "font-medium text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      {hint && (
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {hint}
        </span>
      )}
    </button>
  );
}
