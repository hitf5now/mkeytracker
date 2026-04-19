"use client";

import { useEffect, useState } from "react";

interface Props {
  /** ISO 8601 string (anything `new Date()` accepts). */
  iso: string;
  /**
   * Display variant:
   *  - "datetime" (default) — Apr 19, 5:54 PM
   *  - "date"              — Apr 19, 2026
   */
  format?: "date" | "datetime";
  className?: string;
}

/**
 * Renders a timestamp in the user's BROWSER local timezone.
 *
 * Why not just use Date.toLocaleString() directly in a server component? The
 * Next.js server process has no TZ set, so it defaults to UTC, and since
 * /runs/:id is `force-dynamic` every request is rendered server-side. The
 * HTML sent to the browser shows UTC — a 4-5 hour shift for East Coast
 * users — and nothing re-renders it client-side.
 *
 * This component hydrates with a client effect to format in the user's real
 * timezone. The server-rendered fallback shows the UTC formatted version
 * (with a "UTC" hint baked into the title attribute) so there's something
 * visible while React hydrates — a ~10ms flicker most people won't notice.
 *
 * Uses `suppressHydrationWarning` because the SSR output (UTC) and first
 * client render (local) will differ by design.
 */
export function LocalTime({ iso, format = "datetime", className }: Props) {
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    setLocal(formatDate(iso, format));
  }, [iso, format]);

  const fallback = formatDate(iso, format, "UTC");

  return (
    <time
      dateTime={iso}
      className={className}
      suppressHydrationWarning
      title={local === null ? `${fallback} UTC` : new Date(iso).toISOString()}
    >
      {local ?? fallback}
    </time>
  );
}

function formatDate(
  iso: string,
  variant: "date" | "datetime",
  tz?: string,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const base: Intl.DateTimeFormatOptions =
    variant === "date"
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return d.toLocaleString("en-US", tz ? { ...base, timeZone: tz } : base);
}
