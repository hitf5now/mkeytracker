/**
 * The companion-to-addon payload.
 *
 * Everything the addon needs to show a player their own standing in-game,
 * assembled server-side and handed to the companion, which writes it into
 * `MKeyTrackerDB.inbound`. The addon is a sensor with no network access, so
 * this is the only way data travels back into the game.
 *
 * Kept to one round trip and one blob deliberately. The write window is
 * narrow — SavedVariables are only read at load — so there is no value in
 * fetching these pieces separately.
 *
 * Shape is versioned: the addon ignores an `inbound` table whose version it
 * doesn't recognise, so a payload change can't break an older addon.
 */

import { prisma } from "../lib/prisma.js";
import { resolveSeasonParam } from "./seasons.js";

export const INBOUND_VERSION = 1;

/**
 * How many characters ride along for party scouting. Everyone the player has
 * actually grouped with, then the season's top players to cover pugs. The
 * whole thing is serialised into a Lua file the game parses at load, so it
 * stays bounded.
 */
const ROSTER_LIMIT = 400;

export interface InboundRosterEntry {
  class: string;
  juice: number;
  bestKey: number;
  timedPct: number;
  runs: number;
  /** Runs this character has done with the requesting player. */
  togetherRuns: number;
  togetherTimed: number;
}

export interface InboundPayload {
  version: number;
  generatedAt: number;
  season: { slug: string; name: string };
  player: {
    juice: number;
    runs: number;
    timedPct: number;
    avgDeaths: number;
    bestKey: number;
  };
  /** Personal bests keyed by challenge_mode_id, as a string for Lua. */
  records: Record<string, { bestLevel: number; bestTimeMs: number; runs: number; timedRuns: number }>;
  /** Known characters keyed "name-realm", lowercased. */
  roster: Record<string, InboundRosterEntry>;
}

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

/**
 * Build the payload for one user.
 *
 * Returns null when the user has no characters or there's no season to
 * report on — the companion then leaves `inbound` alone rather than writing
 * an empty table over usable data.
 */
export async function buildInboundPayload(
  userId: number,
  seasonParam?: string,
): Promise<InboundPayload | null> {
  const resolved = await resolveSeasonParam(prisma, seasonParam);
  if (!resolved?.season) return null;
  const season = resolved.season;

  const characters = await prisma.character.findMany({
    where: { userId },
    select: { id: true },
  });
  if (characters.length === 0) return null;
  const ownIds = characters.map((c) => c.id);

  const [ownRuns, records, together, roster] = await Promise.all([
    // Headline numbers for the player across all their characters.
    prisma.$queryRaw<
      Array<{ juice: bigint; runs: bigint; timed: bigint; deaths: bigint; bestKey: number | null }>
    >`
      SELECT COALESCE(SUM(r.personal_juice), 0)          AS juice,
             COUNT(DISTINCT r.id)                        AS runs,
             COUNT(DISTINCT r.id) FILTER (WHERE r.on_time) AS timed,
             COALESCE(SUM(r.deaths), 0)                  AS deaths,
             MAX(r.keystone_level) FILTER (WHERE r.on_time) AS "bestKey"
      FROM run_members rm
      JOIN runs r ON r.id = rm.run_id
      WHERE r.season_id = ${season.id} AND rm.character_id = ANY(${ownIds})
    `,

    // Personal best per dungeon — drives the keystone briefing and the
    // "is this a record" line on the post-run scorecard.
    prisma.$queryRaw<
      Array<{ cmid: number; bestLevel: number; bestTimeMs: number; runs: bigint; timedRuns: bigint }>
    >`
      SELECT d.challenge_mode_id                            AS cmid,
             MAX(r.keystone_level) FILTER (WHERE r.on_time) AS "bestLevel",
             MIN(r.completion_ms) FILTER (WHERE r.on_time)  AS "bestTimeMs",
             COUNT(DISTINCT r.id)                           AS runs,
             COUNT(DISTINCT r.id) FILTER (WHERE r.on_time)  AS "timedRuns"
      FROM run_members rm
      JOIN runs r ON r.id = rm.run_id
      JOIN dungeons d ON d.id = r.dungeon_id
      WHERE r.season_id = ${season.id}
        AND rm.character_id = ANY(${ownIds})
      GROUP BY d.challenge_mode_id
    `,

    // Shared history — the thing no other addon can show.
    prisma.$queryRaw<Array<{ characterId: number; runs: bigint; timed: bigint }>>`
      SELECT other.character_id                            AS "characterId",
             COUNT(DISTINCT r.id)                          AS runs,
             COUNT(DISTINCT r.id) FILTER (WHERE r.on_time) AS timed
      FROM run_members mine
      JOIN runs r ON r.id = mine.run_id
      JOIN run_members other ON other.run_id = r.id AND other.character_id <> mine.character_id
      WHERE mine.character_id = ANY(${ownIds})
      GROUP BY other.character_id
    `,

    // Everyone worth knowing about: season regulars, capped.
    prisma.$queryRaw<
      Array<{
        characterId: number;
        name: string;
        realm: string;
        class: string;
        juice: bigint;
        runs: bigint;
        timed: bigint;
        bestKey: number | null;
      }>
    >`
      SELECT c.id                                          AS "characterId",
             c.name, c.realm, c.class,
             COALESCE(SUM(r.personal_juice), 0)            AS juice,
             COUNT(DISTINCT r.id)                          AS runs,
             COUNT(DISTINCT r.id) FILTER (WHERE r.on_time) AS timed,
             MAX(r.keystone_level) FILTER (WHERE r.on_time) AS "bestKey"
      FROM run_members rm
      JOIN runs r ON r.id = rm.run_id
      JOIN characters c ON c.id = rm.character_id
      WHERE r.season_id = ${season.id}
      GROUP BY c.id, c.name, c.realm, c.class
      ORDER BY juice DESC
      LIMIT ${ROSTER_LIMIT}
    `,
  ]);

  const own = ownRuns[0];
  const totalRuns = own ? Number(own.runs) : 0;

  const togetherById = new Map(
    together.map((t) => [t.characterId, { runs: Number(t.runs), timed: Number(t.timed) }]),
  );

  const rosterOut: Record<string, InboundRosterEntry> = {};
  for (const row of roster) {
    const runs = Number(row.runs);
    const shared = togetherById.get(row.characterId);
    rosterOut[`${row.name}-${row.realm}`.toLowerCase()] = {
      class: row.class,
      juice: Number(row.juice),
      bestKey: row.bestKey ?? 0,
      timedPct: pct(Number(row.timed), runs),
      runs,
      togetherRuns: shared?.runs ?? 0,
      togetherTimed: shared?.timed ?? 0,
    };
  }

  const recordsOut: InboundPayload["records"] = {};
  for (const r of records) {
    recordsOut[String(r.cmid)] = {
      bestLevel: r.bestLevel ?? 0,
      bestTimeMs: r.bestTimeMs ?? 0,
      runs: Number(r.runs),
      timedRuns: Number(r.timedRuns),
    };
  }

  return {
    version: INBOUND_VERSION,
    generatedAt: Math.floor(Date.now() / 1000),
    season: { slug: season.slug, name: season.name },
    player: {
      juice: own ? Number(own.juice) : 0,
      runs: totalRuns,
      timedPct: own ? pct(Number(own.timed), totalRuns) : 0,
      avgDeaths:
        own && totalRuns > 0
          ? Math.round((Number(own.deaths) / totalRuns) * 100) / 100
          : 0,
      bestKey: own?.bestKey ?? 0,
    },
    records: recordsOut,
    roster: rosterOut,
  };
}
