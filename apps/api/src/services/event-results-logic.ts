/**
 * Pure event results scoring logic — no DB imports.
 *
 * Computes group standings for each event type given run data.
 * Separated from event-results.ts for unit testability.
 */

// ── Types ──────────────────────────────────────────────────────

export interface RunData {
  runId: number;
  groupId: number;
  keystoneLevel: number;
  onTime: boolean;
  upgrades: number;
  completionMs: number;
  deaths: number;
  dungeonId: number;
  eventJuice: number;
  matchedAt: Date;
}

export interface GroupInfo {
  groupId: number;
  groupName: string;
  members: { characterName: string; realm: string; classSlug: string }[];
}

export interface GroupStanding {
  rank: number;
  groupId: number;
  groupName: string;
  score: number;
  displayScore: string;
  runCount: number;
  members: { characterName: string; realm: string; classSlug: string }[];
}

export interface EventResults {
  eventId: number;
  eventType: string;
  standings: GroupStanding[];
  totalRuns: number;
  totalParticipants: number;
}

// ── Time modifier (reused from scoring.ts logic) ───────────────

function timeModifier(upgrades: number, onTime: boolean): number {
  if (!onTime) return 0.5;
  if (upgrades >= 3) return 1.5;
  if (upgrades === 2) return 1.35;
  if (upgrades === 1) return 1.2;
  return 1.0;
}

function baseRunScore(keystoneLevel: number, upgrades: number, onTime: boolean): number {
  if (!onTime) return 0; // Depleted = zero base per approved formulas
  return Math.round(keystoneLevel * 100 * timeModifier(upgrades, onTime));
}

// ── Key Climbing ───────────────────────────────────────────────

export function scoreKeyClimbing(
  runs: RunData[],
  groups: GroupInfo[],
  minKeyLevel: number,
): GroupStanding[] {
  const standings: GroupStanding[] = [];

  for (const group of groups) {
    const groupRuns = runs.filter((r) => r.groupId === group.groupId);
    if (groupRuns.length === 0) {
      standings.push({
        rank: 0, groupId: group.groupId, groupName: group.groupName,
        score: 0, displayScore: "No runs", runCount: 0, members: group.members,
      });
      continue;
    }

    // Find peak run: highest key, prefer timed, then fastest, then fewer deaths
    const sorted = [...groupRuns].sort((a, b) => {
      if (b.keystoneLevel !== a.keystoneLevel) return b.keystoneLevel - a.keystoneLevel;
      if (a.onTime !== b.onTime) return a.onTime ? -1 : 1; // timed first
      if (a.completionMs !== b.completionMs) return a.completionMs - b.completionMs; // faster
      return a.deaths - b.deaths; // fewer deaths
    });
    const peak = sorted[0]!;

    const score =
      peak.keystoneLevel * 200 +
      (peak.onTime ? 500 : 0) +
      (peak.deaths === 0 ? 150 : 0) +
      Math.max(0, peak.keystoneLevel - minKeyLevel) * 50 +
      100; // participation

    const timedLabel = peak.onTime ? "Timed" : "Depleted";
    standings.push({
      rank: 0, groupId: group.groupId, groupName: group.groupName,
      score, displayScore: `+${peak.keystoneLevel} ${timedLabel}`,
      runCount: groupRuns.length, members: group.members,
    });
  }

  // Sort: score DESC (which encodes peak key + timed + bonuses)
  standings.sort((a, b) => b.score - a.score);
  standings.forEach((s, i) => (s.rank = i + 1));
  return standings;
}

// ── Marathon ───────────────────────────────────────────────────

export function scoreMarathon(
  runs: RunData[],
  groups: GroupInfo[],
): GroupStanding[] {
  const standings: GroupStanding[] = [];

  for (const group of groups) {
    const groupRuns = runs
      .filter((r) => r.groupId === group.groupId)
      .sort((a, b) => a.matchedAt.getTime() - b.matchedAt.getTime());

    if (groupRuns.length === 0) {
      standings.push({
        rank: 0, groupId: group.groupId, groupName: group.groupName,
        score: 0, displayScore: "No runs", runCount: 0, members: group.members,
      });
      continue;
    }

    let totalScore = 0;
    let streak = 0;
    const dungeonsSeen = new Set<number>();
    let participationCounted = false;

    for (let i = 0; i < groupRuns.length; i++) {
      const run = groupRuns[i]!;

      if (!run.onTime) {
        // Depleted: participation only (once), streak resets
        if (!participationCounted) {
          totalScore += 100;
          participationCounted = true;
        }
        streak = 0;
        continue;
      }

      // Timed run
      const base = baseRunScore(run.keystoneLevel, run.upgrades, run.onTime);
      streak++;
      const streakBonus = streak * 100;
      const varietyBonus = dungeonsSeen.has(run.dungeonId) ? 0 : 200;
      dungeonsSeen.add(run.dungeonId);
      const enduranceBonus = i >= 5 ? 50 : 0; // per run after 5th (0-indexed: i>=5 means 6th+ run)
      const deathBonus = run.deaths === 0 ? 150 : 0;
      const participation = participationCounted ? 0 : 100;
      if (!participationCounted) participationCounted = true;

      totalScore += base + streakBonus + varietyBonus + enduranceBonus + deathBonus + participation;
    }

    standings.push({
      rank: 0, groupId: group.groupId, groupName: group.groupName,
      score: totalScore, displayScore: `${totalScore.toLocaleString()} Juice (${groupRuns.length} runs)`,
      runCount: groupRuns.length, members: group.members,
    });
  }

  standings.sort((a, b) => b.score - a.score);
  standings.forEach((s, i) => (s.rank = i + 1));
  return standings;
}

// ── Best Average ──────────────────────────────────────────────

export function scoreBestAverage(
  runs: RunData[],
  groups: GroupInfo[],
  runsToCount: number = 3,
): GroupStanding[] {
  const standings: GroupStanding[] = [];

  for (const group of groups) {
    const groupRuns = runs.filter((r) => r.groupId === group.groupId);

    if (groupRuns.length < runsToCount) {
      standings.push({
        rank: 0, groupId: group.groupId, groupName: group.groupName,
        score: 0, displayScore: `${groupRuns.length}/${runsToCount} runs (DNQ)`,
        runCount: groupRuns.length, members: group.members,
      });
      continue;
    }

    // Score each run
    const scored = groupRuns.map((r) => ({
      ...r,
      runScore: baseRunScore(r.keystoneLevel, r.upgrades, r.onTime) +
        (r.deaths === 0 ? 150 : 0) + 100, // no-death + participation
    }));

    // Take top N
    scored.sort((a, b) => b.runScore - a.runScore);
    const topN = scored.slice(0, runsToCount);
    const sum = topN.reduce((s, r) => s + r.runScore, 0);
    const average = Math.round(sum / runsToCount);

    // Consistency bonus: +300 if all N runs are timed
    const allTimed = topN.every((r) => r.onTime);
    const consistencyBonus = allTimed ? 300 : 0;

    const finalScore = average + consistencyBonus;

    standings.push({
      rank: 0, groupId: group.groupId, groupName: group.groupName,
      score: finalScore,
      displayScore: `${finalScore.toLocaleString()} avg Juice (top ${runsToCount})`,
      runCount: groupRuns.length, members: group.members,
    });
  }

  standings.sort((a, b) => b.score - a.score);
  standings.forEach((s, i) => (s.rank = i + 1));
  return standings;
}

// ── Bracket Tournament (simplified: total juice + placement) ──

export function scoreBracketTournament(
  runs: RunData[],
  groups: GroupInfo[],
): GroupStanding[] {
  const PLACEMENT_BONUSES = [2000, 1200, 800, 800, 400, 400, 400, 400];

  const standings: GroupStanding[] = [];

  for (const group of groups) {
    const groupRuns = runs.filter((r) => r.groupId === group.groupId);
    const totalJuice = groupRuns.reduce((s, r) => s + r.eventJuice, 0);

    standings.push({
      rank: 0, groupId: group.groupId, groupName: group.groupName,
      score: totalJuice, displayScore: `${totalJuice.toLocaleString()} Juice`,
      runCount: groupRuns.length, members: group.members,
    });
  }

  // Sort by juice DESC, then apply placement bonuses
  standings.sort((a, b) => b.score - a.score);
  standings.forEach((s, i) => {
    s.rank = i + 1;
    const bonus = PLACEMENT_BONUSES[i] ?? 0;
    s.score += bonus;
    s.displayScore = `${s.score.toLocaleString()} Juice`;
  });

  return standings;
}

// ── Dispatcher ────────────────────────────────────────────────

export function computeStandings(
  eventType: string,
  runs: RunData[],
  groups: GroupInfo[],
  options: { minKeyLevel?: number; runsToCount?: number } = {},
): GroupStanding[] {
  switch (eventType) {
    case "key_climbing":
      return scoreKeyClimbing(runs, groups, options.minKeyLevel ?? 2);
    case "marathon":
      return scoreMarathon(runs, groups);
    case "best_average":
      return scoreBestAverage(runs, groups, options.runsToCount ?? 3);
    case "bracket_tournament":
      return scoreBracketTournament(runs, groups);
    default:
      // Fallback for other types: rank by total eventJuice
      return scoreBracketTournament(runs, groups);
  }
}
