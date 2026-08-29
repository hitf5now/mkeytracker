/**
 * Current-tier armour set art, one per class.
 *
 * Used by the leaderboards' Class Champions wall, where each class is
 * represented by its tier set rather than a generic badge.
 *
 * ## Deriving the class
 *
 * Blizzard's `item-set` endpoint gives a name and its items but no class.
 * The item itself carries no class restriction either — only an armour type.
 * The class is reachable one level deeper, on
 * `item.preview_item.requirements.playable_classes`, which reads
 * "Classes: Warrior". Resolving it this way means no hand-maintained
 * name-to-class table to update every raid tier.
 *
 * ## Cost
 *
 * Three calls per set, scanning newest-first until all classes are covered
 * — roughly forty requests. Far too slow for a page load, so the result is
 * cached in Redis for a week and warmed by the scheduler. Tier sets only
 * change on a content patch, so a stale week is harmless.
 */

import { getAccessToken } from "../lib/blizzard.js";
import { redis } from "../lib/redis.js";
import { CLASS_SLUGS } from "@mplus/wow-constants";

const CACHE_KEY = "tier-sets:current";
const CACHE_TTL_SEC = 7 * 24 * 3600;

/** Give up after this many sets — a safety valve, not an expected limit. */
const MAX_SETS_SCANNED = 40;

export interface TierSet {
  /** Blizzard item-set id. Higher means more recent. */
  setId: number;
  /** Class slug as the rest of the platform spells it, e.g. "death-knight". */
  classSlug: string;
  /** Set name, e.g. "Jade Warlord's Dominion". */
  setName: string;
  /** Publicly hosted icon URL — no auth needed to render it. */
  icon: string;
}

export interface TierSetsResult {
  sets: TierSet[];
  resolvedAt: string;
}

/** "Death Knight" → "death-knight", validated against the platform's list. */
function toClassSlug(name: string): string | null {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  return CLASS_SLUGS.includes(slug) ? slug : null;
}

async function blizzardJson(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Resolve the newest tier set for each class, straight from Blizzard.
 *
 * Scans sets newest-first and stops as soon as every class is covered, so
 * the previous tier's sets are naturally skipped — the newest set for a
 * class is always seen first.
 */
async function resolveTierSets(): Promise<TierSet[]> {
  const token = await getAccessToken();
  const ns = "namespace=static-us&locale=en_US";

  const index = (await blizzardJson(
    `https://us.api.blizzard.com/data/wow/item-set/index?${ns}`,
    token,
  )) as { item_sets?: Array<{ id: number; name: string }> };

  const sets = (index.item_sets ?? []).sort((a, b) => b.id - a.id).slice(0, MAX_SETS_SCANNED);

  const byClass = new Map<string, TierSet>();

  for (const s of sets) {
    if (byClass.size === CLASS_SLUGS.length) break;
    try {
      const detail = (await blizzardJson(
        `https://us.api.blizzard.com/data/wow/item-set/${s.id}?${ns}`,
        token,
      )) as { items?: Array<{ id: number }> };
      const firstItem = detail.items?.[0];
      if (!firstItem) continue;

      const item = (await blizzardJson(
        `https://us.api.blizzard.com/data/wow/item/${firstItem.id}?${ns}`,
        token,
      )) as {
        media?: { key?: { href?: string } };
        preview_item?: {
          requirements?: { playable_classes?: { links?: Array<{ name: string }> } };
        };
      };

      const className = item.preview_item?.requirements?.playable_classes?.links?.[0]?.name;
      if (!className) continue;
      const classSlug = toClassSlug(className);
      // Sets shared by several classes list more than one; those aren't
      // tier sets, so a single unambiguous class is the signal we want.
      if (!classSlug || byClass.has(classSlug)) continue;

      const mediaHref = item.media?.key?.href;
      if (!mediaHref) continue;
      const media = (await blizzardJson(mediaHref, token)) as {
        assets?: Array<{ key: string; value: string }>;
      };
      const icon = media.assets?.find((a) => a.key === "icon")?.value;
      if (!icon) continue;

      byClass.set(classSlug, {
        setId: s.id,
        classSlug,
        setName: typeof s.name === "string" ? s.name : String(s.name),
        icon,
      });
    } catch {
      // One unreadable set shouldn't cost us the other twelve.
      continue;
    }
  }

  return [...byClass.values()].sort((a, b) => a.classSlug.localeCompare(b.classSlug));
}

/**
 * Cached tier sets. Returns an empty list rather than throwing when
 * Battle.net is unreachable or unconfigured — the Champions wall falls back
 * to class icons, which is a smaller page, not a broken one.
 */
export async function getTierSets(opts: { refresh?: boolean } = {}): Promise<TierSetsResult> {
  if (!opts.refresh) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return JSON.parse(cached) as TierSetsResult;
    } catch {
      // Cache read failure just means we resolve fresh.
    }
  }

  let sets: TierSet[] = [];
  try {
    sets = await resolveTierSets();
  } catch {
    return { sets: [], resolvedAt: new Date().toISOString() };
  }

  const result: TierSetsResult = { sets, resolvedAt: new Date().toISOString() };

  // Only cache a full resolve. A partial one (rate limit, transient 5xx)
  // would otherwise stick around for a week.
  if (sets.length === CLASS_SLUGS.length) {
    try {
      await redis.setex(CACHE_KEY, CACHE_TTL_SEC, JSON.stringify(result));
    } catch {
      // Serving uncached is fine.
    }
  }

  return result;
}
