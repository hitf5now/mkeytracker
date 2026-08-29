/**
 * Leaderboards.
 *
 * Every board is one entry in `BOARDS`: a SQL fragment that reduces to
 * `(characterId, value, runCount)` plus how to format the value. The
 * surrounding work — resolving characters, ranking, applying the class and
 * role filters, enforcing minimum-run thresholds — happens once in
 * `runBoard`, so adding a board is a query and a formatter rather than
 * another copy of thirty lines of character-mapping boilerplate.
 *
 * Two axes narrow any board:
 *   - `class`  — "who is the highest-ranked Druid"
 *   - `role`   — some metrics are only meaningful for one role, and those
 *                boards pin it themselves via `roleGate`
 *
 * Boards are always scoped to a single season. Ranking a finished season
 * against a three-week-old one produces a meaningless order.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type BoardGroup =
  | "overall"
  | "combat"
  | "consistency"
  | "achievements"
  | "records"
  | "dungeon";

export type BoardRole = "tank" | "healer" | "dps";

export interface LeaderboardEntry {
  rank: number;
  character: {
    id: number;
    name: string;
    realm: string;
    region: string;
    class: string;
    spec: string;
    claimed: boolean;
  };
  value: number;
  displayValue: string;
  /** Per-entry context — dungeon name, or the class on a champions board. */
  context?: string;
  /** Number of runs behind the value, shown as "over N runs" where useful. */
  runCount?: number;
  /** Extra aggregates for the season-juice board (other boards leave null). */
  personalJuice?: number;
  teamJuice?: number;
  eventJuice?: number;
  endorsementsReceived?: number;
}

export interface LeaderboardResult {
  category: string;
  label: string;
  description: string;
  group: BoardGroup;
  season: { slug: string; name: string };
  /** Class the board was narrowed to, if any. */
  classFilter: string | null;
  /** Role the board is pinned to, either by the board itself or the caller. */
  roleFilter: BoardRole | null;
  /** True when this board reads from combat-log enrichment. */
  needsEnrichment: boolean;
  /** Minimum runs required to appear, when the metric is a rate. */
  minRuns: number | null;
  entries: LeaderboardEntry[];
  updatedAt: string;
}

/** Raw row shape every board query must produce. */
interface BoardRow {
  characterId: number;
  value: number;
  runCount: number;
}

interface BoardContext {
  seasonId: number;
  limit: number;
  classFilter: string | null;
  roleFilter: BoardRole | null;
}

export interface BoardDefinition {
  key: string;
  label: string;
  description: string;
  group: BoardGroup;
  /** Metric only makes sense for this role; the filter is forced. */
  roleGate?: BoardRole;
  /** Reads combat-log enrichment, so coverage depends on the companion. */
  needsEnrichment?: boolean;
  /**
   * Rate metrics need a floor, or one lucky run tops the board forever.
   * Enforced in SQL via HAVING so it also bounds what the limit returns.
   */
  minRuns?: number;
  /** Lower is better (deaths). Default is higher-is-better. */
  ascending?: boolean;
  query: (ctx: BoardContext) => Promise<BoardRow[]>;
  format: (row: BoardRow) => string;
}

// ─── SQL helpers ─────────────────────────────────────────────────────

function classClause(classFilter: string | null): Prisma.Sql {
  return classFilter ? Prisma.sql`AND c.class = ${classFilter}` : Prisma.empty;
}

function roleClause(role: BoardRole | null): Prisma.Sql {
  return role ? Prisma.sql`AND rm.role_snapshot = ${role}` : Prisma.empty;
}

function havingMinRuns(minRuns: number | undefined): Prisma.Sql {
  return minRuns ? Prisma.sql`HAVING COUNT(*) >= ${minRuns}` : Prisma.empty;
}

/**
 * Boards computed straight from runs — no combat log required.
 *
 * `agg` reduces the joined run rows to the board's value; `extraWhere`
 * narrows which runs count at all (e.g. only timed ones).
 */
function runBoardQuery(opts: {
  agg: Prisma.Sql;
  extraWhere?: Prisma.Sql;
  minRuns?: number;
  ascending?: boolean;
}) {
  return async (ctx: BoardContext): Promise<BoardRow[]> => {
    const direction = opts.ascending ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    return prisma.$queryRaw<BoardRow[]>`
      SELECT rm.character_id AS "characterId",
             ${opts.agg} AS value,
             COUNT(*)::int AS "runCount"
      FROM run_members rm
      JOIN runs r ON r.id = rm.run_id
      JOIN characters c ON c.id = rm.character_id
      WHERE r.season_id = ${ctx.seasonId}
        ${opts.extraWhere ?? Prisma.empty}
        ${classClause(ctx.classFilter)}
        ${roleClause(ctx.roleFilter)}
      GROUP BY rm.character_id
      ${havingMinRuns(opts.minRuns)}
      ORDER BY value ${direction} NULLS LAST
      LIMIT ${ctx.limit}
    `;
  };
}

/**
 * Boards computed from combat-log enrichment.
 *
 * Only `complete` enrichments count — an `unavailable` row carries zeroed
 * columns, and including those would rank someone last for a run the parser
 * simply couldn't read.
 */
function enrichmentBoardQuery(opts: {
  agg: Prisma.Sql;
  minRuns?: number;
  ascending?: boolean;
}) {
  return async (ctx: BoardContext): Promise<BoardRow[]> => {
    const direction = opts.ascending ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    return prisma.$queryRaw<BoardRow[]>`
      SELECT p.character_id AS "characterId",
             ${opts.agg} AS value,
             COUNT(*)::int AS "runCount"
      FROM run_enrichment_players p
      JOIN run_enrichments e ON e.id = p.enrichment_id AND e.status = 'complete'
      JOIN runs r ON r.id = e.run_id
      JOIN characters c ON c.id = p.character_id
      JOIN run_members rm ON rm.run_id = r.id AND rm.character_id = p.character_id
      WHERE r.season_id = ${ctx.seasonId}
        ${classClause(ctx.classFilter)}
        ${roleClause(ctx.roleFilter)}
      GROUP BY p.character_id
      ${havingMinRuns(opts.minRuns)}
      ORDER BY value ${direction} NULLS LAST
      LIMIT ${ctx.limit}
    `;
  };
}

// ─── Formatting ──────────────────────────────────────────────────────

function compactNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// ─── Board catalog ───────────────────────────────────────────────────

export const BOARDS: BoardDefinition[] = [
  {
    key: "season-juice",
    label: "Season Juice",
    description: "Personal Juice earned across the season.",
    group: "overall",
    query: runBoardQuery({ agg: Prisma.sql`COALESCE(SUM(r.personal_juice), 0)` }),
    format: (r) => `${r.value.toLocaleString()} Juice`,
  },
  {
    key: "highest-key",
    label: "Highest Key",
    description: "Highest keystone level completed in time.",
    group: "overall",
    query: runBoardQuery({
      agg: Prisma.sql`MAX(r.keystone_level)`,
      extraWhere: Prisma.sql`AND r.on_time = true`,
    }),
    format: (r) => `+${r.value}`,
  },
  {
    key: "most-timed",
    label: "Most Timed",
    description: "Most keys completed within the timer.",
    group: "overall",
    query: runBoardQuery({
      agg: Prisma.sql`COUNT(*)`,
      extraWhere: Prisma.sql`AND r.on_time = true`,
    }),
    format: (r) => `${r.value} timed`,
  },

  // ── Combat (combat-log enrichment) ──
  {
    key: "most-interrupts",
    label: "Most Interrupts",
    description: "Total enemy casts kicked across the season.",
    group: "combat",
    needsEnrichment: true,
    query: enrichmentBoardQuery({ agg: Prisma.sql`SUM(p.interrupts)::int` }),
    format: (r) => `${r.value} kicks`,
  },
  {
    key: "interrupts-per-run",
    label: "Interrupts / Run",
    description: "Average kicks per run. Rewards consistency over volume.",
    group: "combat",
    needsEnrichment: true,
    minRuns: 5,
    query: enrichmentBoardQuery({
      agg: Prisma.sql`ROUND(AVG(p.interrupts)::numeric, 1)::float8`,
      minRuns: 5,
    }),
    format: (r) => `${r.value.toFixed(1)} / run`,
  },
  {
    key: "most-dispels",
    label: "Most Dispels",
    description: "Total harmful effects removed across the season.",
    group: "combat",
    needsEnrichment: true,
    query: enrichmentBoardQuery({ agg: Prisma.sql`SUM(p.dispels)::int` }),
    format: (r) => `${r.value} dispels`,
  },
  {
    key: "best-dps",
    label: "Best DPS",
    description:
      "Damage per second of run time, including pets. Higher keys have more health, so this favours key pushers.",
    group: "combat",
    roleGate: "dps",
    needsEnrichment: true,
    minRuns: 3,
    query: enrichmentBoardQuery({
      agg: Prisma.sql`(SUM(p.damage_done + p.pet_damage_done)::float8 / NULLIF(SUM(r.completion_ms)::float8 / 1000.0, 0))`,
      minRuns: 3,
    }),
    format: (r) => `${compactNumber(r.value)} dps`,
  },
  {
    key: "most-healing",
    label: "Most Healing",
    description: "Effective healing plus absorbs provided, including pets.",
    group: "combat",
    roleGate: "healer",
    needsEnrichment: true,
    query: enrichmentBoardQuery({
      agg: Prisma.sql`SUM(p.healing_done + p.pet_healing_done + p.absorb_provided)::float8`,
    }),
    format: (r) => compactNumber(r.value),
  },
  {
    key: "most-damage-taken",
    label: "Most Damage Soaked",
    description: "Total damage taken and survived — the tank's workload.",
    group: "combat",
    roleGate: "tank",
    needsEnrichment: true,
    query: enrichmentBoardQuery({
      agg: Prisma.sql`SUM(p.damage_taken)::float8`,
    }),
    format: (r) => compactNumber(r.value),
  },

  // ── Consistency ──
  {
    key: "timed-rate",
    label: "Timed Rate",
    description: "Share of runs completed in time. Minimum 10 runs.",
    group: "consistency",
    minRuns: 10,
    query: runBoardQuery({
      agg: Prisma.sql`(COUNT(*) FILTER (WHERE r.on_time)::float8 / COUNT(*)::float8 * 100.0)`,
      minRuns: 10,
    }),
    format: (r) => `${r.value.toFixed(0)}%`,
  },
  {
    key: "fewest-deaths",
    label: "Fewest Deaths",
    description: "Lowest average party deaths per run. Minimum 10 runs.",
    group: "consistency",
    minRuns: 10,
    ascending: true,
    query: runBoardQuery({
      agg: Prisma.sql`ROUND(AVG(r.deaths)::numeric, 2)::float8`,
      minRuns: 10,
      ascending: true,
    }),
    format: (r) => `${r.value.toFixed(2)} / run`,
  },

  // ── Achievements ──
  {
    key: "achievement-points",
    label: "Achievement Points",
    description:
      "Rarity-weighted score: legendary 25, epic 10, rare 5, uncommon 2, common 1.",
    group: "achievements",
    query: async (ctx) => prisma.$queryRaw<BoardRow[]>`
      SELECT ra.character_id AS "characterId",
             SUM(CASE ra.rarity
                   WHEN 'legendary' THEN 25
                   WHEN 'epic' THEN 10
                   WHEN 'rare' THEN 5
                   WHEN 'uncommon' THEN 2
                   ELSE 1 END)::int AS value,
             COUNT(*)::int AS "runCount"
      FROM run_achievements ra
      JOIN runs r ON r.id = ra.run_id
      JOIN characters c ON c.id = ra.character_id
      JOIN run_members rm ON rm.id = ra.member_id
      WHERE r.season_id = ${ctx.seasonId}
        AND ra.character_id IS NOT NULL
        ${classClause(ctx.classFilter)}
        ${roleClause(ctx.roleFilter)}
      GROUP BY ra.character_id
      ORDER BY value DESC
      LIMIT ${ctx.limit}
    `,
    format: (r) => `${r.value} pts`,
  },
  {
    key: "most-achievements",
    label: "Most Achievements",
    description: "Raw count of achievements earned this season.",
    group: "achievements",
    query: async (ctx) => prisma.$queryRaw<BoardRow[]>`
      SELECT ra.character_id AS "characterId",
             COUNT(*)::int AS value,
             COUNT(DISTINCT ra.run_id)::int AS "runCount"
      FROM run_achievements ra
      JOIN runs r ON r.id = ra.run_id
      JOIN characters c ON c.id = ra.character_id
      JOIN run_members rm ON rm.id = ra.member_id
      WHERE r.season_id = ${ctx.seasonId}
        AND ra.character_id IS NOT NULL
        ${classClause(ctx.classFilter)}
        ${roleClause(ctx.roleFilter)}
      GROUP BY ra.character_id
      ORDER BY value DESC
      LIMIT ${ctx.limit}
    `,
    format: (r) => `${r.value} earned`,
  },

  // ── Records ──
  {
    key: "most-plus-threes",
    label: "Most +3s",
    description: "Keys completed with all three chest upgrades.",
    group: "records",
    query: runBoardQuery({
      agg: Prisma.sql`COUNT(*)`,
      extraWhere: Prisma.sql`AND r.upgrades = 3`,
    }),
    format: (r) => `${r.value} × +3`,
  },
  {
    key: "most-records",
    label: "Record Holder",
    description: "Runs that set a personal map or affix record.",
    group: "records",
    query: runBoardQuery({
      agg: Prisma.sql`COUNT(*)`,
      extraWhere: Prisma.sql`AND (r.is_map_record = true OR r.is_affix_record = true)`,
    }),
    format: (r) => `${r.value} records`,
  },
];

const BOARDS_BY_KEY = new Map(BOARDS.map((b) => [b.key, b]));

/** Catalog for the website's category selector. */
export function listBoards(): Array<
  Pick<
    BoardDefinition,
    "key" | "label" | "description" | "group"
  > & { roleGate: BoardRole | null; needsEnrichment: boolean; minRuns: number | null }
> {
  return BOARDS.map((b) => ({
    key: b.key,
    label: b.label,
    description: b.description,
    group: b.group,
    roleGate: b.roleGate ?? null,
    needsEnrichment: b.needsEnrichment ?? false,
    minRuns: b.minRuns ?? null,
  }));
}

// ─── Execution ───────────────────────────────────────────────────────

interface CharacterRow {
  id: number;
  name: string;
  realm: string;
  region: string;
  class: string;
  spec: string;
  userId: number | null;
}

async function loadCharacters(ids: number[]): Promise<Map<number, CharacterRow>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.character.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      realm: true,
      region: true,
      class: true,
      spec: true,
      userId: true,
    },
  });
  return new Map(rows.map((c) => [c.id, c]));
}

function toEntries(rows: BoardRow[], chars: Map<number, CharacterRow>, board: BoardDefinition) {
  const entries: LeaderboardEntry[] = [];
  for (const row of rows) {
    const c = chars.get(row.characterId);
    // A character can vanish between the aggregate and the lookup (a merge or
    // a delete). Skip rather than emit a half-blank row.
    if (!c) continue;
    entries.push({
      rank: entries.length + 1,
      character: {
        id: c.id,
        name: c.name,
        realm: c.realm,
        region: c.region,
        class: c.class,
        spec: c.spec,
        claimed: c.userId !== null,
      },
      value: Number(row.value),
      displayValue: board.format({ ...row, value: Number(row.value) }),
      runCount: Number(row.runCount),
    });
  }
  return entries;
}

export interface GetLeaderboardArgs {
  category: string;
  seasonId: number;
  seasonSlug: string;
  seasonName: string;
  limit: number;
  classFilter?: string | null;
  roleFilter?: BoardRole | null;
}

/**
 * Run one board.
 *
 * Returns `null` when the category names no known board — including a
 * `fastest-clear-<slug>` for a dungeon outside the requested season, since
 * the pool changes each season and an empty board would read as "nobody has
 * run this" rather than "wrong season".
 */
export async function getLeaderboard(
  args: GetLeaderboardArgs,
): Promise<LeaderboardResult | null> {
  const now = new Date().toISOString();
  const season = { slug: args.seasonSlug, name: args.seasonName };

  if (args.category.startsWith("fastest-clear-")) {
    return fastestClearBoard(args, season, now);
  }

  const board = BOARDS_BY_KEY.get(args.category);
  if (!board) return null;

  // A board that pins its own role wins over whatever the caller asked for —
  // "Best DPS" filtered to healers is not a board anyone wants.
  const roleFilter = board.roleGate ?? args.roleFilter ?? null;
  const classFilter = args.classFilter ?? null;

  const rows = await board.query({
    seasonId: args.seasonId,
    limit: args.limit,
    classFilter,
    roleFilter,
  });
  const chars = await loadCharacters(rows.map((r) => r.characterId));
  let entries = toEntries(rows, chars, board);

  // The Juice board carries a breakdown the others don't have. Fetched here
  // rather than in the query so the generic path stays one shape.
  if (board.key === "season-juice") {
    entries = await decorateJuiceEntries(entries, args.seasonId);
  }

  return {
    category: board.key,
    label: board.label,
    description: board.description,
    group: board.group,
    season,
    classFilter,
    roleFilter,
    needsEnrichment: board.needsEnrichment ?? false,
    minRuns: board.minRuns ?? null,
    entries,
    updatedAt: now,
  };
}

/**
 * Add the Juice breakdown and endorsement counts to season-juice entries.
 *
 * Endorsements are counted per *character*, not per user — a player's
 * warrior and mage each earn their own.
 */
async function decorateJuiceEntries(
  entries: LeaderboardEntry[],
  seasonId: number,
): Promise<LeaderboardEntry[]> {
  if (entries.length === 0) return entries;
  const characterIds = entries.map((e) => e.character.id);

  const [breakdown, endorsements] = await Promise.all([
    prisma.$queryRaw<
      Array<{ characterId: number; personalJuice: bigint; teamJuice: bigint; eventJuice: bigint }>
    >`
      SELECT rm.character_id                    AS "characterId",
             COALESCE(SUM(r.personal_juice), 0) AS "personalJuice",
             COALESCE(SUM(r.team_juice), 0)     AS "teamJuice",
             COALESCE(SUM(r.event_juice), 0)    AS "eventJuice"
      FROM run_members rm
      JOIN runs r ON r.id = rm.run_id
      WHERE r.season_id = ${seasonId}
        AND rm.character_id IN (${Prisma.join(characterIds)})
      GROUP BY rm.character_id
    `,
    prisma.endorsement.groupBy({
      by: ["receiverCharacterId"],
      where: { receiverCharacterId: { in: characterIds } },
      _count: { receiverCharacterId: true },
    }),
  ]);

  const byId = new Map(breakdown.map((b) => [b.characterId, b]));
  const endorsementCounts = new Map(
    endorsements.map((e) => [e.receiverCharacterId, e._count.receiverCharacterId]),
  );

  return entries.map((e) => {
    const b = byId.get(e.character.id);
    return {
      ...e,
      personalJuice: b ? Number(b.personalJuice) : e.value,
      teamJuice: b ? Number(b.teamJuice) : 0,
      eventJuice: b ? Number(b.eventJuice) : 0,
      endorsementsReceived: endorsementCounts.get(e.character.id) ?? 0,
    };
  });
}

async function fastestClearBoard(
  args: GetLeaderboardArgs,
  season: { slug: string; name: string },
  now: string,
): Promise<LeaderboardResult | null> {
  const dungeonSlug = args.category.substring("fastest-clear-".length);
  const dungeon = await prisma.dungeon.findFirst({
    where: { seasonId: args.seasonId, slug: dungeonSlug },
  });
  if (!dungeon) return null;

  const classFilter = args.classFilter ?? null;
  const roleFilter = args.roleFilter ?? null;

  const rows = await prisma.$queryRaw<BoardRow[]>`
    SELECT rm.character_id AS "characterId",
           MIN(r.completion_ms)::int AS value,
           COUNT(*)::int AS "runCount"
    FROM run_members rm
    JOIN runs r ON r.id = rm.run_id
    JOIN characters c ON c.id = rm.character_id
    WHERE r.season_id = ${args.seasonId}
      AND r.dungeon_id = ${dungeon.id}
      AND r.on_time = true
      ${classClause(classFilter)}
      ${roleClause(roleFilter)}
    GROUP BY rm.character_id
    ORDER BY value ASC
    LIMIT ${args.limit}
  `;

  const chars = await loadCharacters(rows.map((r) => r.characterId));
  const board: BoardDefinition = {
    key: args.category,
    label: `Fastest ${dungeon.name}`,
    description: `Quickest timed clear of ${dungeon.name}.`,
    group: "dungeon",
    query: async () => [],
    format: (r) => formatDuration(r.value),
  };

  const entries = toEntries(rows, chars, board).map((e) => ({
    ...e,
    context: dungeon.name,
  }));

  return {
    category: board.key,
    label: board.label,
    description: board.description,
    group: "dungeon",
    season,
    classFilter,
    roleFilter,
    needsEnrichment: false,
    minRuns: null,
    entries,
    updatedAt: now,
  };
}

// ─── Class champions ─────────────────────────────────────────────────

export interface ClassChampionsResult {
  category: string;
  label: string;
  description: string;
  season: { slug: string; name: string };
  /** One entry per class that has any qualifying run, best first. */
  entries: LeaderboardEntry[];
  updatedAt: string;
}

/**
 * The best player of every class on one board.
 *
 * Answers "who is the top Druid" without making anyone click through
 * thirteen class filters. Implemented by pulling a deep slice of the
 * underlying board and keeping the first row per class — the board is
 * already ordered, so the first occurrence of a class is its champion.
 */
const CHAMPION_SCAN_LIMIT = 500;

export async function getClassChampions(args: {
  category: string;
  seasonId: number;
  seasonSlug: string;
  seasonName: string;
  roleFilter?: BoardRole | null;
}): Promise<ClassChampionsResult | null> {
  const result = await getLeaderboard({
    category: args.category,
    seasonId: args.seasonId,
    seasonSlug: args.seasonSlug,
    seasonName: args.seasonName,
    limit: CHAMPION_SCAN_LIMIT,
    classFilter: null,
    roleFilter: args.roleFilter ?? null,
  });
  if (!result) return null;

  const seen = new Set<string>();
  const entries: LeaderboardEntry[] = [];
  for (const entry of result.entries) {
    if (seen.has(entry.character.class)) continue;
    seen.add(entry.character.class);
    entries.push({ ...entry, rank: entries.length + 1, context: entry.character.class });
  }

  return {
    category: result.category,
    label: result.label,
    description: result.description,
    season: result.season,
    entries,
    updatedAt: result.updatedAt,
  };
}
