/**
 * One-off retroactive enrichment script.
 *
 * Usage:
 *   npx tsx apps/companion/scripts/reenrich-run.ts <runId> <challengeModeId>
 *
 * Example:
 *   npx tsx apps/companion/scripts/reenrich-run.ts 48 557
 *
 * What it does:
 *   1. Reads the companion's config.json for JWT, apiBaseUrl, wowInstallPath
 *   2. Scans <wowInstallPath>/_retail_/Logs for WoWCombatLog*.txt files,
 *      sorted newest first
 *   3. For each file, parses the first CHALLENGE_MODE segment. If its
 *      challengeModeId matches the argument, it's our run.
 *   4. Converts the RunSummary to a RunEnrichmentSubmission and POSTs to
 *      the API's POST /runs/:id/enrichment endpoint.
 *
 * Limitation: RunAggregator only returns the first complete segment in a
 * file, so if the matching run was the *second* key in a given log file,
 * this won't find it. For our case (run 48 was the only key of the day
 * after that log started) this is fine. Extending the parser to yield
 * every segment is a separate task.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  summarizeAllSegmentsInLogFile,
  type RunSummary,
} from "@mplus/combat-log-parser";

const PARSER_VERSION = "0.1.0";

interface CompanionConfig {
  jwt: string;
  apiBaseUrl: string;
  wowInstallPath: string;
}

function loadConfig(): CompanionConfig {
  const configPath = join(
    homedir(),
    "AppData",
    "Roaming",
    "mplus-companion",
    "config.json",
  );
  if (!existsSync(configPath)) {
    throw new Error(`Companion config not found at ${configPath}`);
  }
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as Partial<CompanionConfig>;
  if (!raw.jwt || !raw.apiBaseUrl || !raw.wowInstallPath) {
    throw new Error(
      "Companion config is missing jwt, apiBaseUrl, or wowInstallPath — finish the companion setup wizard first.",
    );
  }
  return raw as CompanionConfig;
}

function findCombatLogFiles(logsDir: string): string[] {
  if (!existsSync(logsDir)) return [];
  return readdirSync(logsDir)
    .filter((n) => /^WoWCombatLog.*\.txt$/i.test(n))
    .map((n) => ({ path: join(logsDir, n), mtime: statSync(join(logsDir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((x) => x.path);
}

function summaryToSubmissionBody(summary: RunSummary) {
  return {
    status: "complete" as const,
    parserVersion: PARSER_VERSION,
    totalDamage: summary.totals.damage,
    totalDamageSupport: summary.totals.damageSupport,
    totalPetDamage: summary.totals.petDamage,
    totalHealing: summary.totals.healing,
    totalHealingSupport: summary.totals.healingSupport,
    totalPetHealing: summary.totals.petHealing,
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
      interrupts: p.interrupts,
      dispels: p.dispels,
      deaths: p.deaths,
      damageBuckets: p.damageBuckets,
      peakBucketIndex: p.peakBucketIndex,
      peakDamage: p.peakDamage,
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

async function main() {
  const runIdArg = process.argv[2];
  const cmIdArg = process.argv[3];
  if (!runIdArg || !cmIdArg) {
    console.error("Usage: tsx reenrich-run.ts <runId> <challengeModeId>");
    process.exit(2);
  }
  const runId = Number.parseInt(runIdArg, 10);
  const expectedCmId = Number.parseInt(cmIdArg, 10);
  if (!Number.isInteger(runId) || !Number.isInteger(expectedCmId)) {
    console.error("runId and challengeModeId must be integers");
    process.exit(2);
  }

  const cfg = loadConfig();
  const logsDir = join(cfg.wowInstallPath, "_retail_", "Logs");
  console.log(`[reenrich] logs dir: ${logsDir}`);

  const files = findCombatLogFiles(logsDir);
  if (files.length === 0) {
    console.error(`No WoWCombatLog*.txt files found in ${logsDir}`);
    process.exit(1);
  }
  console.log(`[reenrich] candidate files (newest first):`);
  for (const f of files) console.log(`  - ${f}`);

  let matchedSummary: RunSummary | null = null;
  let matchedPath: string | null = null;
  for (const file of files) {
    console.log(`[reenrich] parsing ${file}...`);
    let segments: RunSummary[];
    try {
      segments = await summarizeAllSegmentsInLogFile(file);
    } catch (err) {
      console.warn(`  parse failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (segments.length === 0) {
      console.log(`  no complete CHALLENGE_MODE segments`);
      continue;
    }
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      console.log(
        `  segment ${i}: challengeModeId=${s.challengeModeId}, key=+${s.keystoneLevel}, zone=${s.zoneName}, players=${s.players.length}, encounters=${s.encounters.length}`,
      );
      if (s.challengeModeId === expectedCmId) {
        matchedSummary = s;
        matchedPath = file;
        break;
      }
    }
    if (matchedSummary) break;
  }

  if (!matchedSummary || !matchedPath) {
    console.error(
      `No WoWCombatLog file contained any segment with challengeModeId=${expectedCmId}.`,
    );
    process.exit(1);
  }

  console.log(`[reenrich] matched log file: ${matchedPath}`);
  const body = summaryToSubmissionBody(matchedSummary);
  console.log(
    `[reenrich] posting enrichment: ${body.players.length} players, ${body.encounters.length} encounters, damage=${body.totalDamage}, healing=${body.totalHealing}`,
  );

  const url = `${cfg.apiBaseUrl}/api/v1/runs/${runId}/enrichment`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.jwt}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[reenrich] API error ${res.status}: ${text}`);
    process.exit(1);
  }
  console.log(`[reenrich] success ${res.status}: ${text}`);
  console.log(`\nOpen ${cfg.apiBaseUrl.replace(/\/api.*/, "").replace("api.", "")}/runs/${runId} to view.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
