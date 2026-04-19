import type {
  RunDetail,
  RunDetailEnrichmentPlayer,
  RunDetailMember,
} from "@/types/api";
import { partyRules, playerRules } from "./definitions";
import type {
  AwardedAchievement,
  EvaluationResult,
  PartyStats,
  PlayerRole,
  RuleContext,
} from "./types";

const normalizeRole = (snapshot: string | null | undefined): PlayerRole => {
  if (!snapshot) return "unknown";
  const s = snapshot.toLowerCase();
  if (s === "tank" || s === "healer" || s === "dps") return s;
  return "unknown";
};

/**
 * Match an enrichment player to a submission member. Prefer characterId when
 * present, otherwise strip realm from "Name-Realm" and match case-insensitive.
 */
const matchMember = (
  player: RunDetailEnrichmentPlayer,
  members: RunDetailMember[],
): RunDetailMember | null => {
  if (player.characterId != null) {
    const byId = members.find(
      (m) => m.character?.id === player.characterId,
    );
    if (byId) return byId;
  }
  const bareName = player.playerName.split("-")[0]?.toLowerCase();
  if (!bareName) return null;
  return (
    members.find((m) => m.character?.name.toLowerCase() === bareName) ?? null
  );
};

const computePartyStats = (
  run: RunDetail,
  players: RunDetailEnrichmentPlayer[],
  rolesByPlayerId: Map<number, PlayerRole>,
): PartyStats => {
  const runDurationSec = Math.max(1, run.completionMs / 1000);
  let totalDamage = 0;
  let totalHealing = 0;
  let totalInterrupts = 0;
  let totalDispels = 0;
  let partyDeaths = 0;
  let maxDeaths = 0;
  let maxInterrupts = 0;
  let topDamagePlayerId: number | null = null;
  let topDamage = 0;
  let tank: PartyStats["tank"] = null;
  let healer: PartyStats["healer"] = null;
  const dps: PartyStats["dps"] = [];

  for (const p of players) {
    const dmg = Number(p.damageDone);
    const heal = Number(p.healingDone);
    totalDamage += dmg;
    totalHealing += heal;
    totalInterrupts += p.interrupts;
    totalDispels += p.dispels;
    partyDeaths += p.deaths;
    if (p.deaths > maxDeaths) maxDeaths = p.deaths;
    if (p.interrupts > maxInterrupts) maxInterrupts = p.interrupts;
    if (dmg > topDamage) {
      topDamage = dmg;
      topDamagePlayerId = p.id;
    }
    const role = rolesByPlayerId.get(p.id) ?? "unknown";
    if (role === "tank" && tank === null) {
      tank = { playerId: p.id, damage: dmg };
    } else if (role === "healer" && healer === null) {
      healer = { playerId: p.id, damage: dmg, healing: heal };
    } else if (role === "dps") {
      dps.push({ playerId: p.id, damage: dmg });
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
    everyoneDied,
    tank,
    healer,
    dps,
    maxInterrupts,
    topDamagePlayerId,
  };
};

export function evaluateRun(run: RunDetail): EvaluationResult {
  const byPlayerId = new Map<number, AwardedAchievement[]>();
  const partyAchievements: AwardedAchievement[] = [];

  const enrichment = run.enrichment;
  if (!enrichment || enrichment.status !== "complete") {
    return { byPlayerId, party: partyAchievements };
  }

  const players = enrichment.players;

  // Pre-resolve role for every enrichment player
  const rolesByPlayerId = new Map<number, PlayerRole>();
  const memberByPlayerId = new Map<number, RunDetailMember | null>();
  for (const p of players) {
    const member = matchMember(p, run.members);
    memberByPlayerId.set(p.id, member);
    rolesByPlayerId.set(p.id, normalizeRole(member?.roleSnapshot));
  }

  const party = computePartyStats(run, players, rolesByPlayerId);

  // Party-level rules — applied once, then broadcast to every player card
  for (const rule of partyRules) {
    const partyCtx = { run, players, party };
    if (rule.matches(partyCtx)) {
      partyAchievements.push({ def: rule.def, reason: rule.describe(partyCtx) });
    }
  }

  // Per-player rules
  for (const player of players) {
    const damageDone = Number(player.damageDone);
    const healingDone = Number(player.healingDone);
    const ctx: RuleContext = {
      run,
      player,
      member: memberByPlayerId.get(player.id) ?? null,
      role: rolesByPlayerId.get(player.id) ?? "unknown",
      damageDone,
      healingDone,
      averageDps: damageDone / party.runDurationSec,
      party,
    };
    const earned: AwardedAchievement[] = [];
    for (const rule of playerRules) {
      if (rule.eligible(ctx) && rule.matches(ctx)) {
        earned.push({ def: rule.def, reason: rule.describe(ctx) });
      }
    }
    // Negatives first (the fun roasts), then positives, then neutrals
    earned.sort(
      (a, b) => severityOrder(a.def.severity) - severityOrder(b.def.severity),
    );
    byPlayerId.set(player.id, earned);
  }

  return { byPlayerId, party: partyAchievements };
}

const severityOrder = (s: AwardedAchievement["def"]["severity"]): number => {
  if (s === "negative") return 0;
  if (s === "positive") return 1;
  return 2;
};

/**
 * Resolve the per-player achievements for a given submission member.
 * Party-level achievements are NOT included — render those at the section
 * level. Returns an empty array if no enrichment row matches.
 */
export function achievementsForMember(
  run: RunDetail,
  member: RunDetailMember,
  result: EvaluationResult,
): AwardedAchievement[] {
  if (!run.enrichment || run.enrichment.status !== "complete") return [];
  const player = run.enrichment.players.find((p) => {
    if (p.characterId != null && member.character?.id === p.characterId) {
      return true;
    }
    const bare = p.playerName.split("-")[0]?.toLowerCase();
    return bare != null && member.character?.name.toLowerCase() === bare;
  });
  return player ? (result.byPlayerId.get(player.id) ?? []) : [];
}
