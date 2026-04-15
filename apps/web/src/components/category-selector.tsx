"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "season-juice", label: "Season Juice" },
  { value: "highest-key", label: "Highest Key" },
  { value: "most-timed", label: "Most Timed" },
];

export function CategorySelector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("category") ?? "season-juice";

  function selectCategory(category: string) {
    router.push(`/leaderboards?category=${category}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.value}
          type="button"
          onClick={() => selectCategory(cat.value)}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-medium transition-colors",
            current === cat.value
              ? "bg-gold text-background"
              : "bg-secondary text-secondary-foreground hover:bg-accent",
          )}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
