/**
 * Combat-log enrichment pass.
 *
 * Sits between sv-parser (produces a ParsedRun from SavedVariables) and
 * api-client (POSTs the run). For each run, we attempt to locate a matching
 * CHALLENGE_MODE segment in the local WoWCombatLog.txt, parse it, and attach
 * the per-player/per-encounter combat stats to the submission.
 *
 * Design principles (memory: feedback_combat_log_politeness,
 *                           feedback_combat_log_always_attempt):
 *   - Always attempt enrichment when companion is running — no user toggle.
 *   - Log file is opened read-only. Never rename, delete, or truncate.
 *   - All failure modes return { status: "unavailable", statusReason } so the
 *     run still submits with core data. Enrichment is additive, never gating.
 *   - Matching is by challengeModeId + proximity of CHALLENGE_MODE_END time to
 *     run.serverTime. A mismatch is a non-fatal "unavailable" result.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  summarizeAllSegmentsInLogFile,
  type RunSummary,
} from "@mplus/combat-log-parser";
import type {
  EnrichmentStatus,
  RunEnrichmentSubmission,
} from "@mplus/types";
import type { CompanionConfig } from "./config.js";
import type { ParsedRun } from "./sv-parser.js";

/**
 * Version string identifying which parser implementation produced the record.
 * Kept in sync manually with packages/combat-log-parser/package.json — a
 * future refactor could import it from the JSON but that adds a build-time
 * dependency on `resolveJsonModule` / runtime JSON import.
 */
const PARSER_VERSION = "0.1.0";

/**
 * Maximum time skew (ms) we allow between the run's serverTime and the log
 * segment's CHALLENGE_MODE_END timestamp before treating them as unrelated.
 * 5 minutes handles clock drift + event buffering delay without admitting
 * the wrong segment when multiple runs exist in the same file.
 */
const SEGMENT_MATCH_WINDOW_MS = 5 * 60 * 1000;

export interface EnrichmentAttemptResult {
  enrichment: RunEnrichmentSubmission;
  /** Human-readable reason surfaced to UI when status !== "complete" */
  displayReason?: string;
}

/**
 * Derive `<wowInstallPath>/_retail_/Logs`. Returns null when wowInstallPath
 * isn't configured (e.g. user hasn't finished the wizard).
 */
export function resolveCombatLogsDir(config: CompanionConfig): string | null {
  if (!config.wowInstallPath) return null;
  return join(config.wowInstallPath, "_retail_", "Logs");
}

/**
 * Find the combat-log file to read. WoW historically writes `WoWCombatLog.txt`
 * but with most current clients / auto-combatlog addons, it rolls timestamped
 * files like `WoWCombatLog-041826_141359.txt`. We accept either: prefer the
 * most recently modified `WoWCombatLog*.txt` in the Logs dir.
 *
 * The segment-match window in enrichRun (SEGMENT_MATCH_WINDOW_MS) will reject
 * a stale newest-file that doesn't match the current run, so picking the
 * newest file is safe even when older logs linger.
 */
export function findLatestCombatLogFile(logsDir: string): string | null {
  if (!existsSync(logsDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(logsDir);
  } catch {
    return null;
  }
  let best: { path: string; mtimeMs: number } | null = null;
  for (const name of entries) {
    if (!/^WoWCombatLog.*\.txt$/i.test(name)) continue;
    const p = join(logsDir, name);
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      if (best === null || st.mtimeMs > best.mtimeMs) {
        best = { path: p, mtimeMs: st.mtimeMs };
      }
    } catch {
      // Skip unreadable entries — e.g. locked or missing.
    }
  }
  return best?.path ?? null;
}

export async function enrichRun(
  run: ParsedRun,
  config: CompanionConfig,
  log: { warn: (...a: unknown[]) => void; log: (...a: unknown[]) => void } = console,
): Promise<EnrichmentAttemptResult> {
  log.log(
    `[combat-log] enrichRun called: wowInstallPath=${config.wowInstallPath ?? "(unset)"}, runChallengeModeId=${run.challengeModeId}, runServerTime=${run.serverTime}`,
  );

  const logsDir = resolveCombatLogsDir(config);
  if (!logsDir) {
    log.warn(`[combat-log] no logs dir resolved — wowInstallPath is not set`);
    return unavailable(
      "log_path_unresolvable",
      "WoW install path not configured — finish the setup wizard",
    );
  }
  log.log(`[combat-log] scanning logs dir: ${logsDir} (exists=${existsSync(logsDir)})`);

  // List every candidate for debugging — tells us what files the
  // companion can see and which one we picked.
  if (existsSync(logsDir)) {
    try {
      const all = readdirSync(logsDir)
        .filter((n) => /^WoWCombatLog.*\.txt$/i.test(n))
        .map((n) => {
          const p = join(logsDir, n);
          const st = statSync(p);
          return { name: n, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      log.log(
        `[combat-log] found ${all.length} WoWCombatLog*.txt file(s):` +
          (all.length === 0
            ? " (none)"
            : "\n" +
              all
                .map(
                  (f) =>
                    `    - ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB, mtime ${new Date(f.mtime).toISOString()})`,
                )
                .join("\n")),
      );
    } catch (err) {
      log.warn(`[combat-log] couldn't list logs dir: ${err instanceof Error ? err.message : err}`);
    }
  }

  const logPath = findLatestCombatLogFile(logsDir);
  if (!logPath) {
    return unavailable(
      "log_not_found",
      `No WoWCombatLog*.txt found in ${logsDir} — ensure /combatlog is active in-game`,
    );
  }
  log.log(`[combat-log] picked ${logPath}`);

  // Scan ALL complete segments — a single WoWCombatLog can contain many
  // back-to-back keys. Pick the one that matches this run by
  // challengeModeId first, then by time proximity.
  let segments: RunSummary[];
  try {
    segments = await summarizeAllSegmentsInLogFile(logPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[combat-log] parse failed for ${logPath}: ${msg}`);
    return unavailable("parse_failed", msg);
  }

  if (segments.length === 0) {
    return unavailable(
      "no_matching_segment",
      "No completed CHALLENGE_MODE segment found in log",
    );
  }

  log.log(
    `[combat-log] ${segments.length} segment(s) in file; looking for challengeModeId=${run.challengeModeId}`,
  );

  const runTimeMs = run.serverTime * 1000;
  const dungeonMatches = segments.filter(
    (s) => s.challengeModeId === run.challengeModeId,
  );

  if (dungeonMatches.length === 0) {
    const seen = segments
      .map((s) => `cmId=${s.challengeModeId} @ ${s.endedAt.toISOString()}`)
      .join("; ");
    log.warn(
      `[combat-log] no segment matched challengeModeId=${run.challengeModeId}. Segments in file: ${seen}`,
    );
    return unavailable(
      "segment_mismatch",
      `No log segment with challengeModeId=${run.challengeModeId}`,
    );
  }

  // Closest-in-time among matching segments wins. Handles the case where
  // someone played the same dungeon twice in one logging session.
  let best: RunSummary | null = null;
  let bestSkew = Number.POSITIVE_INFINITY;
  for (const s of dungeonMatches) {
    const skew = Math.abs(runTimeMs - s.endedAt.getTime());
    if (skew < bestSkew) {
      bestSkew = skew;
      best = s;
    }
  }

  if (!best) {
    return unavailable("segment_mismatch", "No matching segment picked");
  }
  const summary = best;
  const skewMs = bestSkew;
  if (skewMs > SEGMENT_MATCH_WINDOW_MS) {
    log.warn(
      `[combat-log] closest segment still out of window: run=${new Date(runTimeMs).toISOString()}, ` +
        `segmentEnd=${summary.endedAt.toISOString()}, skew=${Math.round(skewMs / 1000)}s`,
    );
    return unavailable(
      "segment_mismatch",
      `Closest matching segment differs from run by ${Math.round(skewMs / 1000)}s (over ${SEGMENT_MATCH_WINDOW_MS / 1000}s window)`,
    );
  }

  log.log(
    `[combat-log] matched segment: ${summary.zoneName} +${summary.keystoneLevel}, ${summary.players.length} players, ${summary.encounters.length} encounters, ${summary.totals.damage.toLocaleString()} damage, skew=${Math.round(skewMs / 1000)}s`,
  );

  return {
    enrichment: summaryToSubmission(summary, "complete"),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function unavailable(
  reason: string,
  displayReason?: string,
): EnrichmentAttemptResult {
  return {
    enrichment: emptyEnrichment("unavailable", reason),
    displayReason,
  };
}

function emptyEnrichment(
  status: EnrichmentStatus,
  statusReason?: string,
): RunEnrichmentSubmission {
  return {
    status,
    statusReason,
    parserVersion: PARSER_VERSION,
    totalDamage: 0,
    totalDamageSupport: 0,
    totalPetDamage: 0,
    totalHealing: 0,
    totalHealingSupport: 0,
    totalPetHealing: 0,
    totalOverhealing: 0,
    totalAbsorbProvided: 0,
    totalDamageTaken: 0,
    totalInterrupts: 0,
    totalDispels: 0,
    partyDeaths: 0,
    endTrailingFields: [],
    players: [],
    encounters: [],
  };
}

export function summaryToSubmission(
  summary: RunSummary,
  status: EnrichmentStatus,
): RunEnrichmentSubmission {
  return {
    status,
    parserVersion: PARSER_VERSION,
    totalDamage: summary.totals.damage,
    totalDamageSupport: summary.totals.damageSupport,
    totalPetDamage: summary.totals.petDamage,
    totalHealing: summary.totals.healing,
    totalHealingSupport: summary.totals.healingSupport,
    totalPetHealing: summary.totals.petHealing,
    totalOverhealing: summary.totals.overhealing,
    totalAbsorbProvided: summary.totals.absorbProvided,
    totalDamageTaken: summary.totals.damageTaken,
    totalInterrupts: summary.totals.interrupts,
    totalDispels: summary.totals.dispels,
    partyDeaths: summary.totals.deaths,
    endTrailingFields: summary.endingTrailingFields,
    eventCountsRaw: summary.eventCounts,
    bucketSizeMs: summary.bucketSizeMs,
    segmentStartedAt: summary.startedAt.getTime(),
    players: summary.players.map((p) => ({
      playerGuid: p.guid,
      playerName: p.name,
      specId: p.specId ?? null,
      damageDone: p.damageDone,
      damageDoneSupport: p.damageDoneSupport,
      petDamageDone: p.petDamageDone,
      healingDone: p.healingDone,
      healingDoneSupport: p.healingDoneSupport,
      petHealingDone: p.petHealingDone,
      overhealing: p.overhealing,
      absorbProvided: p.absorbProvided,
      damageTaken: p.damageTaken,
      damageIncoming: p.damageIncoming,
      selfHealing: p.selfHealing,
      parries: p.parries,
      dodges: p.dodges,
      misses: p.misses,
      interrupts: p.interrupts,
      dispels: p.dispels,
      deaths: p.deaths,
      damageBuckets: p.damageBuckets,
      peakBucketIndex: p.peakBucketIndex,
      peakDamage: p.peakDamage,
      healingBuckets: p.healingBuckets,
      absorbProvidedBuckets: p.absorbProvidedBuckets,
      damageTakenBuckets: p.damageTakenBuckets,
      damageIncomingBuckets: p.damageIncomingBuckets,
      selfHealingBuckets: p.selfHealingBuckets,
      castEvents: p.castEvents,
      // combatantInfoRaw: not yet emitted by the parser (Phase A only extracts
      // specId); populate when the parser learns to surface the full blob.
    })),
    encounters: summary.encounters.map((e, i) => ({
      encounterId: e.encounterId,
      encounterName: e.encounterName,
      success: e.success,
      fightTimeMs: e.fightTimeMs,
      difficultyId: e.difficultyId,
      groupSize: e.groupSize,
      startedAt: e.startedAt.getTime(),
      sequenceIndex: i,
    })),
  };
}
