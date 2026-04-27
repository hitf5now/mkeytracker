/**
 * Tiny formatting + math helpers shared across archetype triggers.
 * Kept separate from rule definitions so the rule files read like prose.
 */

export const formatNumber = (n: number): string => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};

export const pctOf = (part: number, whole: number): string => {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
};

export const secToMMSS = (s: number): string => {
  const m = Math.floor(s / 60);
  const r = Math.max(0, Math.round(s % 60));
  return `${m}:${r.toString().padStart(2, "0")}`;
};

/** Sum across all timeline buckets. Returns 0 for null/empty. */
export const sumBuckets = (buckets: number[] | null | undefined): number => {
  if (!buckets || buckets.length === 0) return 0;
  let total = 0;
  for (const v of buckets) total += v;
  return total;
};

/**
 * Average across only the non-zero buckets. A truer "active combat" baseline
 * than a flat mean for players with long idle gaps (trash → boss travel, RP).
 */
export const activeAvgBucket = (
  buckets: number[] | null | undefined,
): number => {
  if (!buckets || buckets.length === 0) return 0;
  let total = 0;
  let count = 0;
  for (const v of buckets) {
    if (v > 0) {
      total += v;
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
};
