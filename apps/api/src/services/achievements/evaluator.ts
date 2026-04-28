/**
 * Achievement evaluator (two-pass).
 *
 * Pass 1: every base archetype evaluates against raw run/player/party data.
 *         Each fired trigger is tagged with the archetype's severity (read
 *         from a representative flavor row) so pass 2 can filter on it.
 * Pass 2: composite archetypes evaluate against the *list of pass-1 fires*,
 *         producing legendary/epic-tier "consistency" awards.
 *
 * Selection caps:
 *   - Per player: 1 composite + 3 base archetypes (rarity-weighted).
 *   - Party section: 1 composite + 3 base archetypes.
 *   - 1 archetype max per (player, run) — enforced at DB layer.
 *   - 3-run anti-repeat per (character, archetype) at the flavor pick stage.
 *
 * Idempotent: existing rows for the run are wiped and rewritten on every
 * call. The DB unique on (run_id, member_id, archetype_id) is the final
 * guard against double-writes.
 */

import type {
  AchievementFlavor,
  AchievementRarity,
  AchievementSeverity,
  AchievementTier,
  PrismaClient,
  Prisma,
} from "@prisma/client";

import { archetypeRegistry } from "./archetypes.js";
import type {
  PartyStats,
  PlayerCompositeContext,
  PartyCompositeContext,
  PlayerRole,
  PlayerRuleContext,
  PlayerStats,
  RunStats,
  TriggeredArchetype,
} from "./types.js";

const PER_PLAYER_BASE_CAP = 3;
const PER_PLAYER_COMPOSITE_CAP = 1;
const PARTY_BASE_CAP = 3;
const PARTY_COMPOSITE_CAP = 1;
const ANTI_REPEAT_RUNS = 3;

const RARITY_BASE_WEIGHT: Record<AchievementRarity, number> = {
  common: 100,
  uncommon: 60,
  rare: 25,
  epic: 10,
  legendary: 3,
};

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

/** A trigger that fired, with the metadata composites need. */
type RawTrigger = {
  memberId: number | null;
  characterId: number | null;
  archetypeKey: string;
  archetypeTier: AchievementTier;
  category: string;
  severity: AchievementSeverity;
  reason: string;
};

export async function evaluateAndPersist({
  runId,
  prisma,
}: EvaluatorInput): Promise<number> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      dungeon: { select: { slug: true } },
      members: { select: { id: true, characterId: true, classSnapshot: true, roleSnapshot: true } },
      enrichment: { include: { players: true } },
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

  const memberByPlayerId = new Map<number, (typeof run.members)[number] | null>();
  for (const p of enrichmentReady ? enrichment!.players : []) {
    let matched: (typeof run.members)[number] | null = null;
    if (p.characterId != null) {
      matched = run.members.find((m) => m.characterId === p.characterId) ?? null;
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

  // ── Pre-load all archetypes + flavors so we know each archetype's
  //    representative severity/category before triggers fire. Composites
  //    need this inside pass 1 to filter the trigger list in pass 2.
  const allArchetypes = await prisma.achievementArchetype.findMany({
    where: { isActive: true },
    include: { flavors: { where: { isActive: true } } },
  });
  const archetypeByKey = new Map(allArchetypes.map((a) => [a.key, a]));
  const archetypeMeta = new Map<
    string,
    { severity: AchievementSeverity; category: string; tier: AchievementTier }
  >();
  for (const a of allArchetypes) {
    const sev: AchievementSeverity = a.flavors[0]?.severity ?? "neutral";
    archetypeMeta.set(a.key, {
      severity: sev,
      category: a.category,
      tier: a.tier,
    });
  }

  const tagTrigger = (
    archetypeKey: string,
    memberId: number | null,
    characterId: number | null,
    reason: string,
  ): RawTrigger | null => {
    const meta = archetypeMeta.get(archetypeKey);
    if (!meta) {
      // Archetype defined in code but not yet seeded — skip rather than crash.
      return null;
    }
    return {
      memberId,
      characterId,
      archetypeKey,
      archetypeTier: meta.tier,
      category: meta.category,
      severity: meta.severity,
      reason,
    };
  };

  const triggered: RawTrigger[] = [];

  // ── Pass 1a: party-wide BASE rules ──────────────────────────────────
  for (const arche of archetypeRegistry.party) {
    const result = arche.match({ run: runStats, players, party });
    if (result === false) continue;
    const t = tagTrigger(arche.key, null, null, result.reason);
    if (t) triggered.push(t);
  }

  // ── Pass 1b: per-player BASE rules — enrichment-gated ───────────────
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
        const t = tagTrigger(
          arche.key,
          member?.id ?? null,
          player.characterId,
          result.reason,
        );
        if (t) triggered.push(t);
      }
    }
  }

  // ── Pass 2: composite archetypes — read pass-1 results ──────────────
  // Build per-player + party trigger lists from base fires.
  const triggeredByPlayer = new Map<number, TriggeredArchetype[]>();
  const triggeredForParty: TriggeredArchetype[] = [];
  for (const t of triggered) {
    const slim: TriggeredArchetype = {
      archetypeKey: t.archetypeKey,
      reason: t.reason,
      severity: t.severity,
      category: t.category,
    };
    if (t.memberId == null) {
      triggeredForParty.push(slim);
    } else {
      // Find the player.id corresponding to this memberId for the map key.
      // memberByPlayerId is playerId -> member, invert.
      let playerId: number | null = null;
      for (const [pid, m] of memberByPlayerId) {
        if (m?.id === t.memberId) {
          playerId = pid;
          break;
        }
      }
      if (playerId != null) {
        const arr = triggeredByPlayer.get(playerId) ?? [];
        arr.push(slim);
        triggeredByPlayer.set(playerId, arr);
      }
    }
  }

  // Player composites
  if (enrichmentReady) {
    for (const player of players) {
      const member = memberByPlayerId.get(player.id) ?? null;
      const role = rolesByPlayerId.get(player.id) ?? "unknown";
      const ctx: PlayerCompositeContext = {
        run: runStats,
        player,
        party,
        role,
        triggeredForPlayer: triggeredByPlayer.get(player.id) ?? [],
        triggeredForParty,
      };
      for (const arche of archetypeRegistry.playerComposite) {
        if (arche.roleGate && arche.roleGate !== role) continue;
        const result = arche.match(ctx);
        if (result === false) continue;
        const t = tagTrigger(
          arche.key,
          member?.id ?? null,
          player.characterId,
          result.reason,
        );
        if (t) triggered.push(t);
      }
    }
  }

  // Party composites
  for (const arche of archetypeRegistry.partyComposite) {
    const ctx: PartyCompositeContext = {
      run: runStats,
      players,
      party,
      triggeredByPlayer,
      triggeredForParty,
    };
    const result = arche.match(ctx);
    if (result === false) continue;
    const t = tagTrigger(arche.key, null, null, result.reason);
    if (t) triggered.push(t);
  }

  if (triggered.length === 0) {
    await prisma.runAchievement.deleteMany({ where: { runId } });
    return 0;
  }

  // ── Anti-repeat: which flavor keys did this character earn in their
  //    last 3 runs? Applied per-character × archetype during flavor pick.
  const characterIds = Array.from(
    new Set(triggered.filter((t) => t.characterId != null).map((t) => t.characterId!)),
  );
  const recentByCharacter = new Map<number, Set<string>>();
  if (characterIds.length > 0) {
    const runsOfChars = await prisma.runMember.findMany({
      where: { characterId: { in: characterIds } },
      orderBy: { run: { recordedAt: "desc" } },
      take: ANTI_REPEAT_RUNS * characterIds.length * 2,
      select: {
        characterId: true,
        runId: true,
        run: { select: { recordedAt: true } },
      },
    });
    const lastRunsByChar = new Map<number, number[]>();
    for (const r of runsOfChars) {
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
      recentByCharacter.set(cid, new Set(recent.map((r) => r.flavor.key)));
    }
  }

  // ── Pick a flavor per (memberId, archetypeKey) tuple ───────────────
  type Selection = RawTrigger & {
    flavor: AchievementFlavor;
    score: number;
  };
  const selections: Selection[] = [];

  for (const t of triggered) {
    const archetype = archetypeByKey.get(t.archetypeKey);
    if (!archetype || archetype.flavors.length === 0) continue;

    const characterClass =
      t.memberId != null
        ? (run.members.find((m) => m.id === t.memberId)?.classSnapshot ?? null)?.toLowerCase() ?? null
        : null;

    const candidates = archetype.flavors.filter((f) => {
      if (f.classFilter && f.classFilter !== characterClass) return false;
      if (f.dungeonFilter && f.dungeonFilter !== runStats.dungeonSlug) return false;
      return true;
    });
    if (candidates.length === 0) continue;

    const recentSet = t.characterId != null ? recentByCharacter.get(t.characterId) : undefined;
    let pool = candidates;
    if (recentSet && recentSet.size > 0) {
      const filtered = candidates.filter((f) => !recentSet.has(f.key));
      if (filtered.length > 0) pool = filtered;
    }

    const chosen = weightedPick(pool, runStats.dungeonSlug, characterClass);
    if (!chosen) continue;

    selections.push({
      ...t,
      flavor: chosen,
      score: RARITY_SCORE[chosen.rarity] * 100 + chosen.weight / 10,
    });
  }

  // ── Apply caps per (group, tier) ────────────────────────────────────
  // Group: party (memberId=null) vs each member (memberId=N).
  // Tier: composite (capped 1) vs base (capped 3).
  const groupKey = (s: Selection) =>
    s.memberId == null ? "party" : `m:${s.memberId}`;

  type Bucket = { composite: Selection[]; base: Selection[] };
  const buckets = new Map<string, Bucket>();
  for (const s of selections) {
    const k = groupKey(s);
    let b = buckets.get(k);
    if (!b) {
      b = { composite: [], base: [] };
      buckets.set(k, b);
    }
    if (s.archetypeTier === "composite") {
      b.composite.push(s);
    } else {
      b.base.push(s);
    }
  }

  const persistRows: Array<{
    runId: number;
    memberId: number | null;
    characterId: number | null;
    archetypeId: number;
    flavorId: number;
    rarity: AchievementRarity;
    reason: string;
  }> = [];

  for (const [key, b] of buckets) {
    const compCap = key === "party" ? PARTY_COMPOSITE_CAP : PER_PLAYER_COMPOSITE_CAP;
    const baseCap = key === "party" ? PARTY_BASE_CAP : PER_PLAYER_BASE_CAP;
    const topComp = [...b.composite].sort((a, b) => b.score - a.score).slice(0, compCap);
    const topBase = [...b.base].sort((a, b) => b.score - a.score).slice(0, baseCap);
    for (const s of [...topComp, ...topBase]) {
      const archetype = archetypeByKey.get(s.archetypeKey)!;
      persistRows.push({
        runId,
        memberId: s.memberId,
        characterId: s.characterId,
        archetypeId: archetype.id,
        flavorId: s.flavor.id,
        rarity: s.flavor.rarity,
        reason: s.reason,
      });
    }
  }

  await prisma.runAchievement.deleteMany({ where: { runId } });
  if (persistRows.length === 0) return 0;
  await prisma.runAchievement.createMany({
    data: persistRows,
    skipDuplicates: true,
  });

  return persistRows.length;
}

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
