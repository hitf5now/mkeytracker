"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { UserRunsFilterOption } from "@/types/api";

interface Props {
  characters: UserRunsFilterOption<number>[];
  dungeons: UserRunsFilterOption<number>[];
  activeCharacterId: number | null;
  activeDungeonId: number | null;
  activeRange: "7d" | "30d" | "season" | "all";
}

const RANGE_OPTIONS: Array<{ value: Props["activeRange"]; label: string }> = [
  { value: "all", label: "All time" },
  { value: "season", label: "This season" },
  { value: "30d", label: "Last 30 days" },
  { value: "7d", label: "Last 7 days" },
];

export function RunsFilter({
  characters,
  dungeons,
  activeCharacterId,
  activeDungeonId,
  activeRange,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  /**
   * Build the next URL with the filter change applied. Always resets
   * `offset` to 0 so a filter change doesn't leave the user on a page
   * that no longer exists.
   */
  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "runs");
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    next.delete("offset");
    startTransition(() => {
      router.push(`/dashboard?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <FilterSelect
        label="Character"
        value={activeCharacterId?.toString() ?? ""}
        onChange={(v) => updateParam("character", v || null)}
        options={[
          { value: "", label: "All characters" },
          ...characters.map((c) => ({
            value: String(c.id),
            label: c.label,
          })),
        ]}
      />
      <FilterSelect
        label="Dungeon"
        value={activeDungeonId?.toString() ?? ""}
        onChange={(v) => updateParam("dungeon", v || null)}
        options={[
          { value: "", label: "All dungeons" },
          ...dungeons.map((d) => ({
            value: String(d.id),
            label: d.label,
          })),
        ]}
      />
      <FilterSelect
        label="Date Range"
        value={activeRange}
        onChange={(v) => updateParam("range", v === "all" ? null : v)}
        options={RANGE_OPTIONS.map((r) => ({
          value: r.value,
          label: r.label,
        }))}
      />
      {isPending && (
        <span className="text-xs text-muted-foreground">Loading…</span>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        className="rounded border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
