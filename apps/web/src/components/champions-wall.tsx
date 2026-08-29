import Link from "next/link";
import { getClassIconUrl } from "@mplus/wow-constants";
import { getClassColor, getClassName } from "@/lib/class-colors";
import type { LeaderboardEntry, TierSet } from "@/types/api";

/**
 * The best player of each class, shown as their class's current tier set.
 *
 * A ranked list answers "who is first"; this answers "who is the best
 * Druid", which is a different question and the one people actually ask
 * about their own class. Each card is keyed by the class colour and the
 * tier set the class is wearing this patch, so the wall reads as a row of
 * armour rather than a table of names.
 *
 * Tier art is a nicety, not a dependency: when Battle.net is unreachable
 * the card falls back to the class icon and loses nothing structural.
 */
interface Props {
  entries: LeaderboardEntry[];
  tierSets: TierSet[];
  /** What the number on each card measures, e.g. "Highest Key". */
  metricLabel: string;
}

export function ChampionsWall({ entries, tierSets, metricLabel }: Props) {
  const tierByClass = new Map(tierSets.map((t) => [t.classSlug, t]));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {entries.map((entry) => {
        const slug = entry.context ?? entry.character.class;
        const color = getClassColor(slug);
        const tier = tierByClass.get(slug);
        return (
          <Link
            key={entry.character.id}
            href={`/players/${entry.character.region}/${entry.character.realm}/${entry.character.name}`}
            className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-[color:var(--edge)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold"
            style={{ ["--edge" as string]: color }}
          >
            {/* Class colour is the card's identity, so it gets the top edge. */}
            <span aria-hidden className="h-1 w-full" style={{ backgroundColor: color }} />

            <div className="flex items-start gap-3 p-3">
              <img
                src={tier?.icon ?? getClassIconUrl(slug, "large")}
                alt=""
                className="h-14 w-14 shrink-0 rounded border border-border object-cover"
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[11px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color }}
                >
                  {getClassName(slug)}
                </p>
                <p className="truncate text-sm font-semibold text-foreground">
                  {entry.character.name}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {entry.character.realm}
                </p>
              </div>
            </div>

            <div className="mt-auto flex items-baseline justify-between border-t border-border/60 px-3 py-2">
              <span className="font-display text-xl leading-none tabular-nums text-foreground">
                {entry.displayValue}
              </span>
              {entry.runCount !== undefined && (
                <span className="text-[11px] text-muted-foreground">
                  {entry.runCount} runs
                </span>
              )}
            </div>

            {tier && (
              <p
                className="truncate px-3 pb-2 text-[10px] italic text-muted-foreground/70"
                title={`${tier.setName} — current tier set`}
              >
                {tier.setName}
              </p>
            )}
            <span className="sr-only">
              {metricLabel}: {entry.displayValue}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
