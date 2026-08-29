"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { getClassIconUrl } from "@mplus/wow-constants";
import { getClassColor, getClassName } from "@/lib/class-colors";
import { cn } from "@/lib/utils";

/**
 * Class filter.
 *
 * Thirteen text buttons is a paragraph of words; thirteen class icons is a
 * row anyone who plays the game reads instantly. The selected class is
 * marked with its own class colour rather than the site accent, because
 * that colour *is* the class's identity to this audience.
 */

const CLASS_SLUGS = [
  "death-knight",
  "demon-hunter",
  "druid",
  "evoker",
  "hunter",
  "mage",
  "monk",
  "paladin",
  "priest",
  "rogue",
  "shaman",
  "warlock",
  "warrior",
];

interface Props {
  /** Currently selected class slug, or undefined for all classes. */
  value: string | undefined;
}

export function ClassFilter({ value }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function select(slug: string | null) {
    const qs = new URLSearchParams(params.toString());
    if (slug) qs.set("class", slug);
    else qs.delete("class");
    // Champions already shows every class, so narrowing to one means
    // leaving that view.
    qs.delete("view");
    qs.delete("offset");
    router.push(`/leaderboards?${qs.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => select(null)}
        className={cn(
          "rounded px-2.5 py-1 text-xs font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold",
          value === undefined
            ? "bg-gold text-background"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        All
      </button>

      {CLASS_SLUGS.map((slug) => {
        const active = value === slug;
        const color = getClassColor(slug);
        return (
          <button
            key={slug}
            type="button"
            onClick={() => select(active ? null : slug)}
            title={getClassName(slug)}
            aria-label={getClassName(slug)}
            aria-pressed={active}
            style={{
              borderColor: active ? color : "transparent",
              boxShadow: active ? `0 0 0 1px ${color}` : undefined,
            }}
            className={cn(
              "rounded border p-0.5 transition-all",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold",
              active ? "opacity-100" : "opacity-55 hover:opacity-100",
            )}
          >
            <img
              src={getClassIconUrl(slug, "medium")}
              alt=""
              className="h-6 w-6 rounded-sm"
              loading="lazy"
            />
          </button>
        );
      })}
    </div>
  );
}
