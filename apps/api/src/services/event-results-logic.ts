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
  dungeonName?: string;
  dungeonShortCode?: string;
  eventJuice: number;
  matchedAt: Date;
}

export interface GroupInfo {
  groupId: number;
  groupName: string;
  members: { characterName: string; realm: string; classSlug: string }[];
}

export interface RunDetail {
  runId: number;
  keystoneLevel: number;
  onTime: boolean;
  upgrades: number;
  completionMs: number;
  deaths: number;
  dungeonId: number;
  dungeonName: string | null;
  dungeonShortCode: string | null;
  matchedAt: string;
  /** Per-run score contribution (event-type specific). */
  runScore: number;
  /** True if this run is currently counted toward the group's score. */
  counted: boolean;
}

/**
 * Type-specific metadata used to generate "what beats #1" hints.
 * Each scoring function populates the fields that are relevant to it.
 */
export interface StandingMeta {
  // key_climbing
  peakKeystone?: number;
  peakTimed?: boolean;
  peakDeaths?: number;
  peakCompletionMs?: number;
  // best_average
  topNAverage?: number;
  topNAllTimed?: boolean;
  topNRunCount?: number;
  lowestCountedScore?: number;
  // marathon — none specific (gap suffices)
  // bracket_tournament — placement bonuses already baked in
}

export interface GapToFirst {
  scoreGap: number;
  hint: string;
}

export interface GroupStanding {
  rank: number;
  groupId: number;
  groupName: string;
  score: number;
  displayScore: string;
  runCount: number;
  members: { characterName: string; realm: string; classSlug: string }[];
  runs?: RunDetail[];
  meta?: StandingMeta;
  gapToFirst?: GapToFirst;
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

function toRunDetail(r: RunData, runScore: number, counted: boolean): RunDetail {
  return {
    runId: r.runId,
    keystoneLevel: r.keystoneLevel,
    onTime: r.onTime,
    upgrades: r.upgrades,
    completionMs: r.completionMs,
    deaths: r.deaths,
    dungeonId: r.dungeonId,
    dungeonName: r.dungeonName ?? null,
    dungeonShortCode: r.dungeonShortCode ?? null,
    matchedAt: r.matchedAt.toISOString(),
    runScore,
    counted,
  };
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

    const runDetails = groupRuns.map((r) => {
      const isPeak = r.runId === peak.runId;
      const runScore = isPeak ? score : 0;
      return toRunDetail(r, runScore, isPeak);
    });

    standings.push({
      rank: 0, groupId: group.groupId, groupName: group.groupName,
      score, displayScore: `+${peak.keystoneLevel} ${timedLabel}`,
      runCount: groupRuns.length, members: group.members,
      runs: runDetails,
      meta: {
        peakKeystone: peak.keystoneLevel,
        peakTimed: peak.onTime,
        peakDeaths: peak.deaths,
        peakCompletionMs: peak.completionMs,
      },
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
    const runDetails: RunDetail[] = [];

    for (let i = 0; i < groupRuns.length; i++) {
      const run = groupRuns[i]!;

      if (!run.onTime) {
        // Depleted: participation only (once), streak resets
        let runScore = 0;
        if (!participationCounted) {
          totalScore += 100;
          runScore = 100;
          participationCounted = true;
        }
        streak = 0;
        runDetails.push(toRunDetail(run, runScore, runScore > 0));
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

      const runScore = base + streakBonus + varietyBonus + enduranceBonus + deathBonus + participation;
      totalScore += runScore;
      runDetails.push(toRunDetail(run, runScore, true));
    }

    standings.push({
      rank: 0, groupId: group.groupId, groupName: group.groupName,
      score: totalScore, displayScore: `${totalScore.toLocaleString()} Juice (${groupRuns.length} runs)`,
      runCount: groupRuns.length, members: group.members,
      runs: runDetails,
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

    // Score each run (whether qualified or not — for display)
    const scored = groupRuns.map((r) => ({
      run: r,
      runScore:
        baseRunScore(r.keystoneLevel, r.upgrades, r.onTime) +
        (r.deaths === 0 ? 150 : 0) + 100, // no-death + participation
    }));

    if (groupRuns.length < runsToCount) {
      const runDetails = scored.map((s) => toRunDetail(s.run, s.runScore, false));
      standings.push({
        rank: 0, groupId: group.groupId, groupName: group.groupName,
        score: 0, displayScore: `${groupRuns.length}/${runsToCount} runs (DNQ)`,
        runCount: groupRuns.length, members: group.members,
        runs: runDetails,
      });
      continue;
    }

    // Take top N
    const sortedByScore = [...scored].sort((a, b) => b.runScore - a.runScore);
    const topN = sortedByScore.slice(0, runsToCount);
    const topNRunIds = new Set(topN.map((s) => s.run.runId));
    const sum = topN.reduce((s, r) => s + r.runScore, 0);
    const average = Math.round(sum / runsToCount);

    // Consistency bonus: +300 if all N runs are timed
    const allTimed = topN.every((s) => s.run.onTime);
    const consistencyBonus = allTimed ? 300 : 0;

    const finalScore = average + consistencyBonus;
    const lowestCountedScore = topN[topN.length - 1]?.runScore ?? 0;

    const runDetails = scored.map((s) => toRunDetail(s.run, s.runScore, topNRunIds.has(s.run.runId)));

    standings.push({
      rank: 0, groupId: group.groupId, groupName: group.groupName,
      score: finalScore,
      displayScore: `${finalScore.toLocaleString()} avg Juice (top ${runsToCount})`,
      runCount: groupRuns.length, members: group.members,
      runs: runDetails,
      meta: {
        topNAverage: average,
        topNAllTimed: allTimed,
        topNRunCount: runsToCount,
        lowestCountedScore,
      },
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
    const runDetails = groupRuns.map((r) => toRunDetail(r, r.eventJuice, true));

    standings.push({
      rank: 0, groupId: group.groupId, groupName: group.groupName,
      score: totalJuice, displayScore: `${totalJuice.toLocaleString()} Juice`,
      runCount: groupRuns.length, members: group.members,
      runs: runDetails,
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

// ── Gap-to-#1 hints ───────────────────────────────────────────

/**
 * Generate a hint string telling rank 2+ groups what they need to do
 * to overtake the leader. Mutates standings to populate `gapToFirst`.
 *
 * Skips standings that have no runs at all (showing a "catch up" hint
 * to a group that hasn't started would be noise).
 */
export function computeGapHints(
  eventType: string,
  standings: GroupStanding[],
): void {
  if (standings.length < 2) return;
  const leader = standings[0]!;
  if (leader.score === 0 && leader.runCount === 0) return;

  for (let i = 1; i < standings.length; i++) {
    const s = standings[i]!;
    const scoreGap = Math.max(0, leader.score - s.score);
    s.gapToFirst = {
      scoreGap,
      hint: buildHint(eventType, leader, s, scoreGap),
    };
  }
}

function buildHint(
  eventType: string,
  leader: GroupStanding,
  candidate: GroupStanding,
  scoreGap: number,
): string {
  if (scoreGap === 0) {
    return "Tied with #1 on score — break the tie with another counted run.";
  }

  switch (eventType) {
    case "key_climbing": {
      const peak = leader.meta?.peakKeystone;
      const peakTimed = leader.meta?.peakTimed ?? false;
      const peakDeaths = leader.meta?.peakDeaths ?? 0;
      const candPeak = candidate.meta?.peakKeystone ?? 0;
      const candTimed = candidate.meta?.peakTimed ?? false;
      const candDeaths = candidate.meta?.peakDeaths ?? 0;
      if (peak == null) return `Score ${scoreGap.toLocaleString()} more Juice to take #1.`;

      if (candPeak < peak) {
        return `Time a +${peak} or higher to take #1.`;
      }
      if (candPeak === peak && peakTimed && !candTimed) {
        return `Time your +${peak} (currently depleted) to take #1.`;
      }
      if (candPeak === peak && peakTimed && candTimed && candDeaths > peakDeaths) {
        const target = peakDeaths === 0 ? "with zero deaths" : `with ≤${peakDeaths} deaths`;
        return `Match the +${peak} timed ${target} to take #1.`;
      }
      // Same peak + better, but lower score (e.g. progression bonus mismatch — rare)
      return `Push a higher key — +${peak + 1} or above — to take #1.`;
    }

    case "marathon": {
      // A timed +K run yields ~K*100 + ~100 streak + bonuses ≈ K*100 + 250.
      // Rough estimate of how many timed runs at the current bar would close the gap.
      const sampleRun = candidate.runs?.find((r) => r.counted && r.onTime);
      const perRun = sampleRun ? sampleRun.runScore : 800;
      const runsNeeded = Math.max(1, Math.ceil(scoreGap / Math.max(perRun, 1)));
      return `Score ${scoreGap.toLocaleString()} more Juice (~${runsNeeded} more timed run${runsNeeded === 1 ? "" : "s"}) to take #1.`;
    }

    case "best_average": {
      const n = leader.meta?.topNRunCount ?? 3;
      const lowest = candidate.meta?.lowestCountedScore;
      if (candidate.runCount < n) {
        const remaining = n - candidate.runCount;
        return `Complete ${remaining} more run${remaining === 1 ? "" : "s"} to qualify, then beat the leader's ${leader.score.toLocaleString()} avg.`;
      }
      // Score gap on best_average = average gap × N (since score = average + bonus)
      const avgGapPerRun = Math.ceil(scoreGap);
      if (lowest != null) {
        const target = lowest + avgGapPerRun * n;
        return `Replace your lowest counted run (${lowest.toLocaleString()}) with one scoring ≥${target.toLocaleString()} to take #1.`;
      }
      return `Raise your top-${n} average by ${avgGapPerRun.toLocaleString()} Juice to take #1.`;
    }

    case "bracket_tournament":
    default:
      return `Score ${scoreGap.toLocaleString()} more Juice to take #1.`;
  }
}

// ── Dispatcher ────────────────────────────────────────────────

export function computeStandings(
  eventType: string,
  runs: RunData[],
  groups: GroupInfo[],
  options: { minKeyLevel?: number; runsToCount?: number } = {},
): GroupStanding[] {
  let standings: GroupStanding[];
  switch (eventType) {
    case "key_climbing":
      standings = scoreKeyClimbing(runs, groups, options.minKeyLevel ?? 2);
      break;
    case "marathon":
      standings = scoreMarathon(runs, groups);
      break;
    case "best_average":
      standings = scoreBestAverage(runs, groups, options.runsToCount ?? 3);
      break;
    case "bracket_tournament":
      standings = scoreBracketTournament(runs, groups);
      break;
    default:
      // Fallback for other types: rank by total eventJuice
      standings = scoreBracketTournament(runs, groups);
  }
  computeGapHints(eventType, standings);
  return standings;
}
