"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "season-juice", label: "Season Juice" },
  { value: "highest-key", label: "Highest Key" },
  { value: "most-timed", label: "Most Timed" },
];

interface Props {
  /**
   * Dungeons in the season being viewed. Drives the per-dungeon
   * fastest-clear boards — the API has always served these, but the UI
   * never offered a way to reach them.
   */
  dungeons: Array<{ slug: string; name: string; shortCode: string }>;
}

export function CategorySelector({ dungeons }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("category") ?? "season-juice";

  function selectCategory(category: string) {
    // Keep the season on the URL — switching category shouldn't silently
    // move the reader back to the current season.
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("category", category);
    router.push(`/leaderboards?${qs.toString()}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <CategoryButton
            key={cat.value}
            label={cat.label}
            active={current === cat.value}
            onClick={() => selectCategory(cat.value)}
          />
        ))}
      </div>

      {dungeons.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Fastest clear
          </p>
          <div className="flex flex-wrap gap-2">
            {dungeons.map((d) => {
              const value = `fastest-clear-${d.slug}`;
              return (
                <CategoryButton
                  key={d.slug}
                  label={d.shortCode}
                  title={d.name}
                  active={current === value}
                  onClick={() => selectCategory(value)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-md px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-gold text-background"
          : "bg-secondary text-secondary-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}
