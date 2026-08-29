"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import type { SeasonsResponse } from "@/types/api";

/**
 * Shared expansion + season selector.
 *
 * One grouped `<select>` rather than two cascading dropdowns: the expansion
 * is the `<optgroup>` heading, so both levels are visible at once and there
 * is no invalid in-between state where the chosen expansion and season
 * disagree. Every season-scoped page uses this, so the control reads the
 * same everywhere.
 *
 * Writes `?season=<slug>` (or `all`) and resets `offset`, because a season
 * change almost always shortens the list and would otherwise strand the
 * reader on a page that no longer exists.
 */
interface Props {
  data: SeasonsResponse;
  /** Current `?season=` value; undefined means the active season. */
  value: string | undefined;
  /**
   * Offer an "All seasons" option. Off for leaderboards, where ranking a
   * finished season against a three-week-old one is meaningless.
   */
  allowAll?: boolean;
  /** Extra params to preserve on navigation, e.g. the dashboard's tab. */
  label?: string;
}

export function SeasonPicker({ data, value, allowAll = true, label = "Season" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // An absent param means "active season" — show that season as selected
  // rather than a blank control.
  const current = value ?? data.activeSlug ?? "";

  function onChange(next: string) {
    const qs = new URLSearchParams(params.toString());
    // The active season is the default, so keep it out of the URL: shared
    // links then follow the current season rather than pinning to whichever
    // one happened to be live when the link was copied.
    if (next === data.activeSlug) qs.delete("season");
    else qs.set("season", next);
    qs.delete("offset");
    const query = qs.toString();
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <select
          className="rounded border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Select expansion and season"
        >
          {allowAll && <option value="all">All seasons</option>}
          {data.groups.map((group) => (
            <optgroup key={group.expansion} label={group.expansion}>
              {group.seasons.map((season) => (
                <option key={season.slug} value={season.slug}>
                  {season.shortLabel}
                  {season.isActive ? " (current)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {isPending && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>
    </label>
  );
}
