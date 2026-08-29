"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { BoardSummary, BoardGroup } from "@/types/api";

/** Group headings, in the order they should appear. */
const GROUP_LABELS: Array<{ group: BoardGroup; label: string }> = [
  { group: "overall", label: "Overall" },
  { group: "combat", label: "Combat" },
  { group: "consistency", label: "Consistency" },
  { group: "achievements", label: "Achievements" },
  { group: "records", label: "Records" },
];

const CLASS_OPTIONS = [
  { slug: "death-knight", label: "Death Knight" },
  { slug: "demon-hunter", label: "Demon Hunter" },
  { slug: "druid", label: "Druid" },
  { slug: "evoker", label: "Evoker" },
  { slug: "hunter", label: "Hunter" },
  { slug: "mage", label: "Mage" },
  { slug: "monk", label: "Monk" },
  { slug: "paladin", label: "Paladin" },
  { slug: "priest", label: "Priest" },
  { slug: "rogue", label: "Rogue" },
  { slug: "shaman", label: "Shaman" },
  { slug: "warlock", label: "Warlock" },
  { slug: "warrior", label: "Warrior" },
];

interface Props {
  boards: BoardSummary[];
  /** Dungeons in the viewed season — drives the fastest-clear boards. */
  dungeons: Array<{ slug: string; name: string; shortCode: string }>;
}

export function CategorySelector({ boards, dungeons }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("category") ?? "season-juice";
  const currentClass = searchParams.get("class") ?? "";
  const championsMode = searchParams.get("view") === "champions";

  /**
   * Navigate while preserving everything else on the URL — season above all,
   * so switching category doesn't quietly move the reader to a different
   * season than the one they chose.
   */
  function update(changes: Record<string, string | null>) {
    const qs = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") qs.delete(key);
      else qs.set(key, value);
    }
    router.push(`/leaderboards?${qs.toString()}`, { scroll: false });
  }

  const grouped = GROUP_LABELS.map((g) => ({
    ...g,
    boards: boards.filter((b) => b.group === g.group),
  })).filter((g) => g.boards.length > 0);

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.group}>
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.boards.map((b) => (
              <Chip
                key={b.key}
                label={b.label}
                title={b.description}
                active={current === b.key}
                onClick={() => update({ category: b.key })}
              />
            ))}
          </div>
        </div>
      ))}

      {dungeons.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Fastest clear
          </p>
          <div className="flex flex-wrap gap-2">
            {dungeons.map((d) => (
              <Chip
                key={d.slug}
                label={d.shortCode}
                title={d.name}
                active={current === `fastest-clear-${d.slug}`}
                onClick={() => update({ category: `fastest-clear-${d.slug}` })}
              />
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border pt-4">
        <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
          Class
        </p>
        <div className="flex flex-wrap gap-2">
          {/* Champions mode answers "best of every class" in one table, so it
              is mutually exclusive with narrowing to a single class. */}
          <Chip
            label="Champions"
            title="Best player of every class, side by side"
            active={championsMode}
            onClick={() =>
              update({ view: championsMode ? null : "champions", class: null })
            }
          />
          <Chip
            label="All"
            active={!championsMode && currentClass === ""}
            onClick={() => update({ class: null, view: null })}
          />
          {CLASS_OPTIONS.map((c) => (
            <Chip
              key={c.slug}
              label={c.label}
              active={!championsMode && currentClass === c.slug}
              onClick={() => update({ class: c.slug, view: null })}
              classSlug={c.slug}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Chip({
  label,
  title,
  active,
  onClick,
  classSlug,
}: {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
  classSlug?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={
        classSlug && active
          ? { backgroundColor: `var(--class-${classSlug}, var(--gold))` }
          : undefined
      }
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-gold text-background"
          : "bg-secondary text-secondary-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}
