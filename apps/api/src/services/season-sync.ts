/**
 * Automated M+ season rollover.
 *
 * A new season silently breaks run submission: the dungeon pool changes
 * wholesale, so every `POST /runs` 404s with `dungeon_not_found` until the
 * new pool is seeded by hand. That is exactly what happened at the
 * Midnight S1 → S2 rollover (2026-08-18) — three weeks of runs were
 * rejected before anyone noticed. This service removes the manual step.
 *
 * ## Sources
 *
 * Raider.IO `mythic-plus/static-data` is the primary source. It is the only
 * public endpoint that returns a season's *dungeon pool* with keystone
 * timers, and it exposes two fields that make the match unambiguous:
 *   - `is_main_season` — filters out side modes (break-the-meta,
 *     legion-remix, cutoffs) that share a dungeon pool with the real season
 *     and would otherwise look like a rollover.
 *   - `blizzard_season_id` — ties the row to Blizzard's own season number.
 *
 * Blizzard's `mythic-keystone/season/index` is used as a corroborating
 * second opinion on *which* season is current. It carries no dungeon pool,
 * so it cannot drive the sync alone, and it is optional: when Battle.net
 * credentials are absent the sync still runs on Raider.IO alone and simply
 * records that it could not cross-check.
 *
 * ## Safety
 *
 * Activating the wrong season would silently reset every leaderboard, so
 * the rollover is gated (see `evaluateCandidate`): the season must have
 * already started, carry a plausible dungeon pool, and actually differ from
 * what is active. Anything short of that updates data in place without
 * flipping `isActive`, and reports why.
 */

import type { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";
import { upsertSeason, activateSeason } from "./seasons.js";
import {
  deriveSeasonIdentity,
  evaluateCandidate,
  poolKey,
  toSeasonInput,
  type RioSeason,
  type SeasonSyncResult,
} from "./season-sync-rules.js";

export type { SeasonSyncResult } from "./season-sync-rules.js";

/**
 * Expansion ids to probe, relative to `RAIDERIO_EXPANSION_ID`. Probing one
 * ahead means the first season of the *next* expansion is picked up without
 * a code change; an id with no seasons returns an empty list, not an error.
 */
const EXPANSION_PROBE_OFFSETS = [0, 1];

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

/** A main season plus its parsed US start date. */
interface DatedSeason {
  rio: RioSeason;
  startsAt: Date;
}

/** Every main season Raider.IO knows about for the probed expansions. */
async function fetchRaiderIoSeasons(): Promise<DatedSeason[]> {
  const base = env.RAIDERIO_EXPANSION_ID;
  const out: DatedSeason[] = [];

  for (const offset of EXPANSION_PROBE_OFFSETS) {
    const url = `${env.RAIDERIO_BASE_URL}/mythic-plus/static-data?expansion_id=${base + offset}`;
    let payload: { seasons?: RioSeason[] };
    try {
      payload = (await fetchJson(url)) as { seasons?: RioSeason[] };
    } catch {
      // A not-yet-existing expansion is an expected miss, not a failure.
      continue;
    }
    for (const s of payload.seasons ?? []) {
      const startsUs = s.starts?.us;
      if (!s.is_main_season || !Array.isArray(s.dungeons) || !startsUs) continue;
      const startsAt = new Date(startsUs);
      if (Number.isNaN(startsAt.getTime())) continue;
      out.push({ rio: s, startsAt });
    }
  }
  return out;
}

/**
 * Blizzard's view of the current season id. Returns null when Battle.net
 * credentials are unset or the call fails — the sync degrades to
 * Raider.IO-only rather than refusing to run.
 */
async function fetchBlizzardCurrentSeasonId(): Promise<number | null> {
  if (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET) return null;
  try {
    const basic = Buffer.from(
      `${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`,
    ).toString("base64");
    const token = (await fetchJson("https://oauth.battle.net/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    })) as { access_token?: string };
    if (!token.access_token) return null;

    const idx = (await fetchJson(
      "https://us.api.blizzard.com/data/wow/mythic-keystone/season/index?namespace=dynamic-us&locale=en_US",
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    )) as { current_season?: { id?: number } };
    return idx.current_season?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Reconcile the local season tables against upstream.
 *
 * Idempotent and safe to call on a schedule: when nothing has changed it
 * refreshes dungeon metadata in place (catching mid-season par-time
 * corrections) and reports `noop`.
 */
export async function syncSeasons(
  prisma: PrismaClient,
  opts: { autoActivate?: boolean; now?: Date } = {},
): Promise<SeasonSyncResult> {
  const now = opts.now ?? new Date();
  const autoActivate = opts.autoActivate ?? env.SEASON_SYNC_AUTO_ACTIVATE;

  let rioSeasons: DatedSeason[];
  try {
    rioSeasons = await fetchRaiderIoSeasons();
  } catch (err) {
    return {
      action: "failed",
      reason: `Raider.IO static-data unreachable: ${(err as Error).message}`,
    };
  }

  const current = rioSeasons
    .filter((s) => s.startsAt.getTime() <= now.getTime())
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];

  if (!current) {
    return { action: "failed", reason: "Raider.IO returned no started main seasons" };
  }

  const blizzardSeasonId = await fetchBlizzardCurrentSeasonId();
  const crossChecked =
    blizzardSeasonId !== null && current.rio.blizzard_season_id === blizzardSeasonId;

  const active = await prisma.season.findFirst({
    where: { isActive: true },
    include: { dungeons: { select: { challengeModeId: true } } },
  });

  // Preserve a hand-maintained patch string across syncs; we have no
  // upstream source for it, and it is display-only bookkeeping.
  const existing = await prisma.season.findFirst({
    where: {
      OR: [
        { externalSlug: current.rio.slug },
        { slug: deriveSeasonIdentity(current.rio).slug },
      ],
    },
    select: { patch: true },
  });
  const candidate = toSeasonInput(current.rio, current.startsAt, existing?.patch ?? "");

  const decision = evaluateCandidate({
    candidate,
    activeSlug: active?.slug ?? null,
    activePoolKey: active ? poolKey(active) : null,
    now,
  });

  // Always write the season + pool, even when not activating: this is what
  // picks up a mid-season par-time correction from upstream.
  const upserted = await upsertSeason(prisma, candidate);

  const base: SeasonSyncResult = {
    action: "noop",
    reason: decision.reason,
    seasonSlug: candidate.slug,
    previousSeasonSlug: active?.slug,
    blizzardSeasonId,
    crossChecked,
    dungeonsUpserted: upserted.dungeonsUpserted,
    dungeonsRemoved: upserted.dungeonsRemoved,
  };

  if (!decision.activate) {
    return { ...base, action: candidate.slug === active?.slug ? "noop" : "updated" };
  }
  if (!autoActivate) {
    return {
      ...base,
      action: "skipped",
      reason: `${decision.reason}, but SEASON_SYNC_AUTO_ACTIVATE is off — activate it manually`,
    };
  }

  await activateSeason(prisma, upserted.seasonId);
  return { ...base, action: "activated" };
}
