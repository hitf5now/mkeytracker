/**
 * Achievement evaluator.
 *
 * Loads a Run + its enrichment, runs every archetype trigger, picks one
 * flavor per fired archetype (weighted by rarity, with 3-run anti-repeat
 * per character × archetype), caps at 3 per player + 3 party-wide, and
 * persists the result to run_achievements.
 *
 * Idempotent: if the run already has rows, the existing ones are deleted
 * and re-written. The DB unique on (run_id, member_id, archetype_id) is the
 * final guard against double-writes.
 */

import type {
  AchievementFlavor,
  AchievementRarity,
  AchievementSeverity,
  PrismaClient,
  Prisma,
} from "@prisma/client";

import { archetypeRegistry } from "./archetypes.js";
import type {
  PartyArchetype,
  PartyStats,
  PlayerArchetype,
  PlayerRole,
  PlayerRuleContext,
  PlayerStats,
  RunStats,
  SelectedAchievement,
  TriggeredArchetype,
} from "./types.js";

const PER_PLAYER_CAP = 3;
const PARTY_CAP = 3;
const ANTI_REPEAT_RUNS = 3;

/** Rarity → base weight, before per-flavor weight modifier. */
const RARITY_BASE_WEIGHT: Record<AchievementRarity, number> = {
  common: 100,
  uncommon: 60,
  rare: 25,
  epic: 10,
  legendary: 3,
};

/** Rarity → ranking score (higher rarity wins ties when picking top-N). */
const RARITY_SCORE: Record<AchievementRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

const normalizeRole = (snapshot: string | null | undefined): PlayerRole => {
  if (!snapshot) return "unknown";
  const s = snapshot.toLowerCase();
  if (s === "tank" || s === "healer" || s === "dps") return s;
  return "unknown";
};

const num = (b: bigint | number | null | undefined): number => {
  if (b == null) return 0;
  if (typeof b === "number") return b;
  return Number(b);
};

const parseBuckets = (raw: Prisma.JsonValue | null | undefined): number[] | null => {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v === "number") out.push(v);
    else if (typeof v === "string") out.push(Number(v));
    else return null;
  }
  return out;
};

interface EvaluatorInput {
  runId: number;
  prisma: PrismaClient | Prisma.TransactionClient;
}

/**
 * Evaluate one run and persist its achievements. Returns the number of
 * RunAchievement rows written. If enrichment is missing or marked
 * unavailable, only run-level archetypes (party_zero_deaths, plus_three,
 * personal_record, depleted, etc.) can fire — per-player rules are skipped.
 */
export async function evaluateAndPersist({
  runId,
  prisma,
}: EvaluatorInput): Promise<number> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      dungeon: { select: { slug: true } },
      members: { select: { id: true, characterId: true, classSnapshot: true, roleSnapshot: true } },
      enrichment: {
        include: {
          players: true,
        },
      },
    },
  });
  if (!run) throw new Error(`evaluator: run ${runId} not found`);

  const runStats: RunStats = {
    id: run.id,
    keystoneLevel: run.keystoneLevel,
    completionMs: run.completionMs,
    parMs: run.parMs,
    onTime: run.onTime,
    upgrades: run.upgrades,
    deaths: run.deaths,
    timeLostSec: run.timeLostSec,
    isMapRecord: run.isMapRecord,
    isAffixRecord: run.isAffixRecord,
    dungeonSlug: run.dungeon.slug,
  };

  // ── Build per-player snapshots from enrichment, if available ─────────
  const enrichment = run.enrichment;
  const enrichmentReady =
    enrichment != null && enrichment.status === "complete";

  const players: PlayerStats[] = enrichmentReady
    ? enrichment!.players.map((p) => ({
        id: p.id,
        characterId: p.characterId,
        playerName: p.playerName,
        damageDone: num(p.damageDone),
        healingDone: num(p.healingDone),
        overhealing: num(p.overhealing),
        interrupts: p.interrupts,
        dispels: p.dispels,
        deaths: p.deaths,
        peakDamage: p.peakDamage == null ? null : num(p.peakDamage),
        damageBuckets: parseBuckets(p.damageBuckets),
      }))
    : [];

  // Match enrichment players to run_members so we can resolve role + class.
  const memberByPlayerId = new Map<number, (typeof run.members)[number] | null>();
  for (const p of enrichmentReady ? enrichment!.players : []) {
    let matched: (typeof run.members)[number] | null = null;
    if (p.characterId != null) {
      matched = run.members.find((m) => m.characterId === p.characterId) ?? null;
    }
    if (!matched) {
      const bare = p.playerName.split("-")[0]?.toLowerCase();
      if (bare) {
        // Members don't have name on the include; need to fetch character if we
        // care about name fallback. For now, characterId is the only path.
        matched = null;
      }
    }
    memberByPlayerId.set(p.id, matched);
  }

  const rolesByPlayerId = new Map<number, PlayerRole>();
  const classByPlayerId = new Map<number, string | null>();
  for (const p of players) {
    const member = memberByPlayerId.get(p.id) ?? null;
    rolesByPlayerId.set(p.id, normalizeRole(member?.roleSnapshot));
    classByPlayerId.set(p.id, member?.classSnapshot ?? null);
  }

  const party = computePartyStats(runStats, players, rolesByPlayerId);

  // ── Run archetype triggers ─────────────────────────────────────────
  // We collect (memberId, archetypeKey, reason) tuples, then resolve to
  // flavors + persist. memberId = null means party-wide.
  type Triggered = {
    memberId: number | null;
    characterId: number | null;
    archetypeKey: string;
    reason: string;
  };
  const triggered: Triggered[] = [];

  // Party-wide rules — fire off run-level data even without enrichment.
  for (const arche of archetypeRegistry.party) {
    const result = arche.match({ run: runStats, players, party });
    if (result === false) continue;
    triggered.push({
      memberId: null,
      characterId: null,
      archetypeKey: arche.key,
      reason: result.reason,
    });
  }

  // Per-player rules — only when we have enrichment.
  if (enrichmentReady) {
    for (const player of players) {
      const member = memberByPlayerId.get(player.id) ?? null;
      const role = rolesByPlayerId.get(player.id) ?? "unknown";
      const characterClass = classByPlayerId.get(player.id) ?? null;
      const damageDone = player.damageDone;
      const healingDone = player.healingDone;
      const ctx: PlayerRuleContext = {
        run: runStats,
        player,
        allPlayers: players,
        role,
        damageDone,
        healingDone,
        averageDps: Math.round(damageDone / party.runDurationSec),
        party,
        characterClass: characterClass?.toLowerCase() ?? null,
      };

      for (const arche of archetypeRegistry.player) {
        if (arche.roleGate && arche.roleGate !== role) continue;
        const result = arche.match(ctx);
        if (result === false) continue;
        triggered.push({
          memberId: member?.id ?? null,
          characterId: player.characterId,
          archetypeKey: arche.key,
          reason: result.reason,
        });
      }
    }
  }

  if (triggered.length === 0) {
    // Wipe any stale rows so re-evaluation is idempotent.
    await prisma.runAchievement.deleteMany({ where: { runId } });
    return 0;
  }

  // ── Resolve archetype keys → DB IDs and load flavor pools ──────────
  const archetypeKeys = Array.from(new Set(triggered.map((t) => t.archetypeKey)));
  const archetypeRows = await prisma.achievementArchetype.findMany({
    where: { key: { in: archetypeKeys }, isActive: true },
    include: {
      flavors: { where: { isActive: true } },
    },
  });
  const archetypeByKey = new Map(archetypeRows.map((a) => [a.key, a]));

  // ── Anti-repeat: which flavor keys has this character earned in their
  //    last 3 runs? Computed per-character (party rows have null character,
  //    so we skip them — anti-repeat only applies to per-player awards).
  const characterIds = Array.from(
    new Set(triggered.filter((t) => t.characterId != null).map((t) => t.characterId!)),
  );
  const recentByCharacter = new Map<number, Set<string>>();
  if (characterIds.length > 0) {
    // Fetch the last N distinct runIds the character participated in by
    // joining via run_members; then find the achievements they got there.
    const runs = await prisma.runMember.findMany({
      where: { characterId: { in: characterIds } },
      orderBy: { run: { recordedAt: "desc" } },
      take: ANTI_REPEAT_RUNS * characterIds.length * 2,
      select: {
        characterId: true,
        runId: true,
        run: { select: { recordedAt: true } },
      },
    });

    // Group by characterId and take their last 3 runs.
    const lastRunsByChar = new Map<number, number[]>();
    for (const r of runs) {
      const arr = lastRunsByChar.get(r.characterId) ?? [];
      if (arr.length >= ANTI_REPEAT_RUNS) continue;
      arr.push(r.runId);
      lastRunsByChar.set(r.characterId, arr);
    }

    for (const [cid, runIds] of lastRunsByChar) {
      if (runIds.length === 0) continue;
      const recent = await prisma.runAchievement.findMany({
        where: { runId: { in: runIds }, characterId: cid },
        select: { flavor: { select: { key: true } } },
      });
      recentByCharacter.set(
        cid,
        new Set(recent.map((r) => r.flavor.key)),
      );
    }
  }

  // ── Pick a flavor per (memberId, archetypeKey) tuple ───────────────
  const selections: Array<
    Triggered & {
      flavor: AchievementFlavor;
      score: number;
    }
  > = [];

  for (const t of triggered) {
    const archetype = archetypeByKey.get(t.archetypeKey);
    if (!archetype || archetype.flavors.length === 0) continue;

    const characterClass = t.memberId != null
      ? (run.members.find((m) => m.id === t.memberId)?.classSnapshot ?? null)?.toLowerCase() ?? null
      : null;

    const candidates = archetype.flavors.filter((f) => {
      if (f.classFilter && f.classFilter !== characterClass) return false;
      if (f.dungeonFilter && f.dungeonFilter !== runStats.dungeonSlug) return false;
      return true;
    });
    if (candidates.length === 0) continue;

    // Anti-repeat: drop flavors the character earned in their last 3 runs.
    const recentSet = t.characterId != null ? recentByCharacter.get(t.characterId) : undefined;
    let pool = candidates;
    if (recentSet && recentSet.size > 0) {
      const filtered = candidates.filter((f) => !recentSet.has(f.key));
      if (filtered.length > 0) pool = filtered;
      // If filter empties the pool, fall back to full pool — never silently skip.
    }

    const chosen = weightedPick(pool, runStats.dungeonSlug, characterClass);
    if (!chosen) continue;

    selections.push({
      ...t,
      flavor: chosen,
      score:
        RARITY_SCORE[chosen.rarity] * 100 +
        chosen.weight / 10,
    });
  }

  // ── Apply caps: top 3 per memberId (incl. null = party) ────────────
  const groupKey = (s: typeof selections[number]) =>
    s.memberId == null ? "party" : `m:${s.memberId}`;

  const grouped = new Map<string, typeof selections>();
  for (const s of selections) {
    const k = groupKey(s);
    const arr = grouped.get(k) ?? [];
    arr.push(s);
    grouped.set(k, arr);
  }

  const finalRows: SelectedAchievement[] & {
    runId: number;
    memberId: number | null;
    characterId: number | null;
    archetypeId: number;
    flavorId: number;
  }[] = [] as never;

  const persistRows: Array<{
    runId: number;
    memberId: number | null;
    characterId: number | null;
    archetypeId: number;
    flavorId: number;
    rarity: AchievementRarity;
    severity: AchievementSeverity;
    reason: string;
  }> = [];

  for (const [key, list] of grouped) {
    const cap = key === "party" ? PARTY_CAP : PER_PLAYER_CAP;
    const top = [...list].sort((a, b) => b.score - a.score).slice(0, cap);
    for (const s of top) {
      const archetype = archetypeByKey.get(s.archetypeKey)!;
      persistRows.push({
        runId,
        memberId: s.memberId,
        characterId: s.characterId,
        archetypeId: archetype.id,
        flavorId: s.flavor.id,
        rarity: s.flavor.rarity,
        severity: s.flavor.severity,
        reason: s.reason,
      });
    }
  }

  // ── Persist (idempotent: wipe then re-insert) ──────────────────────
  await prisma.runAchievement.deleteMany({ where: { runId } });
  if (persistRows.length === 0) return 0;
  await prisma.runAchievement.createMany({
    data: persistRows,
    skipDuplicates: true,
  });

  return persistRows.length;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function computePartyStats(
  run: RunStats,
  players: PlayerStats[],
  rolesByPlayerId: Map<number, PlayerRole>,
): PartyStats {
  const runDurationSec = Math.max(1, run.completionMs / 1000);
  let totalDamage = 0;
  let totalHealing = 0;
  let totalInterrupts = 0;
  let totalDispels = 0;
  let partyDeaths = 0;
  let maxDeaths = 0;
  let maxInterrupts = 0;
  let maxDispels = 0;
  let topDamagePlayerId: number | null = null;
  let topDamage = 0;
  let tank: PartyStats["tank"] = null;
  let healer: PartyStats["healer"] = null;
  const dps: PartyStats["dps"] = [];

  for (const p of players) {
    totalDamage += p.damageDone;
    totalHealing += p.healingDone;
    totalInterrupts += p.interrupts;
    totalDispels += p.dispels;
    partyDeaths += p.deaths;
    if (p.deaths > maxDeaths) maxDeaths = p.deaths;
    if (p.interrupts > maxInterrupts) maxInterrupts = p.interrupts;
    if (p.dispels > maxDispels) maxDispels = p.dispels;
    if (p.damageDone > topDamage) {
      topDamage = p.damageDone;
      topDamagePlayerId = p.id;
    }
    const role = rolesByPlayerId.get(p.id) ?? "unknown";
    if (role === "tank" && tank === null) {
      tank = { playerId: p.id, damage: p.damageDone };
    } else if (role === "healer" && healer === null) {
      healer = { playerId: p.id, damage: p.damageDone, healing: p.healingDone };
    } else if (role === "dps") {
      dps.push({ playerId: p.id, damage: p.damageDone });
    }
  }

  const everyoneDied = players.length > 0 && players.every((p) => p.deaths >= 1);

  return {
    runDurationSec,
    totalDamage,
    totalHealing,
    totalInterrupts,
    totalDispels,
    partyDeaths,
    maxDeaths,
    maxInterrupts,
    maxDispels,
    everyoneDied,
    topDamagePlayerId,
    tank,
    healer,
    dps,
  };
}

/**
 * Pick one flavor from the pool using rarity-weighted random. A flavor's
 * effective weight is RARITY_BASE_WEIGHT[rarity] × (perFlavor.weight / 100),
 * with a +20% bonus when the flavor matches the run's class or dungeon
 * (themed cards surface preferentially).
 */
function weightedPick(
  pool: AchievementFlavor[],
  dungeonSlug: string,
  characterClass: string | null,
): AchievementFlavor | null {
  if (pool.length === 0) return null;
  const weights = pool.map((f) => {
    let w = RARITY_BASE_WEIGHT[f.rarity] * (f.weight / 100);
    if (f.classFilter && f.classFilter === characterClass) w *= 1.2;
    if (f.dungeonFilter && f.dungeonFilter === dungeonSlug) w *= 1.2;
    return Math.max(0.0001, w);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}
