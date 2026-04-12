"use client";

import { useRouter, useSearchParams } from "next/navigation";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "open", label: "Signups Open" },
  { value: "signups_closed", label: "Group Assignments" },
  { value: "in_progress", label: "Active Event" },
  { value: "completed", label: "Completed" },
];

const TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "fastest_clear_race", label: "Fastest Clear Race" },
  { value: "speed_sprint", label: "Speed Sprint" },
  { value: "random_draft", label: "Random Draft" },
];

export function EventFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentStatus = searchParams.get("status") ?? "";
  const currentType = searchParams.get("type") ?? "";

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/events?${params.toString()}`);
  }

  const selectClass =
    "rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground";

  return (
    <div className="flex flex-wrap gap-3">
      <select
        value={currentStatus}
        onChange={(e) => updateFilter("status", e.target.value)}
        className={selectClass}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        value={currentType}
        onChange={(e) => updateFilter("type", e.target.value)}
        className={selectClass}
      >
        {TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
