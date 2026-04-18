/**
 * Run submission queue manager.
 *
 * Orchestrates the parse → dedup → POST flow. When the watcher fires an
 * "updated" event, we:
 *   1. Re-parse the entire SavedVariables file
 *   2. Filter out runs whose client hash is in `postedRunHashes`
 *   3. POST the remaining runs in order
 *   4. On 201 or 200-deduplicated, add the hash to `postedRunHashes`
 *   5. On 5xx, leave the run in place and retry next tick
 *   6. On 400/403/404, mark as "poisoned" and don't retry (surface to UI)
 *
 * Retry strategy for 5xx: the next SV file write will re-trigger us.
 * We don't implement in-process exponential backoff — simpler, and
 * matches the reality that the server either works or is down.
 */

import { CompanionApiClient, CompanionApiError } from "./api-client.js";
import { enrichRun } from "./combat-log.js";
import { addPostedHash, loadConfig } from "./config.js";
import { computeClientRunHash } from "./run-hash.js";
import { parseSavedVariablesFile, removeSubmittedRuns, type ParsedRun } from "./sv-parser.js";

export interface QueueResult {
  newRuns: number;
  submitted: number;
  deduplicated: number;
  skipped: number;
  /** How many submissions included successful combat-log enrichment */
  enrichedComplete: number;
  /** How many attempted enrichment but fell back to core-only */
  enrichedUnavailable: number;
  errors: QueueError[];
}

export interface QueueError {
  runHash: string;
  error: string;
  code: string;
  status: number;
}

/** Minimal logger shape — compatible with console and pino. */
interface LoggerLike {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export class RunQueue {
  constructor(
    private readonly apiClient: CompanionApiClient,
    private readonly log: LoggerLike = console,
  ) {}

  /**
   * Read the SavedVariables file, POST anything new, update config.
   */
  async processSavedVariables(savedVariablesPath: string): Promise<QueueResult> {
    const parse = parseSavedVariablesFile(savedVariablesPath);
    const result: QueueResult = {
      newRuns: 0,
      submitted: 0,
      deduplicated: 0,
      skipped: 0,
      enrichedComplete: 0,
      enrichedUnavailable: 0,
      errors: [],
    };

    if (parse.rejected > 0) {
      for (const e of parse.errors) {
        this.log.warn(`[queue] rejected run #${e.index}: ${e.message}`);
      }
    }

    if (parse.runs.length === 0) {
      return result;
    }

    const cfg = loadConfig();
    const postedSet = new Set(cfg.postedRunHashes);

    for (const run of parse.runs) {
      const hash = computeClientRunHash(run);
      if (postedSet.has(hash)) {
        result.skipped++;
        continue;
      }
      result.newRuns++;

      // Attempt combat-log enrichment. Always tries — falls back silently to
      // a core-only submission if the log isn't available or doesn't match.
      // See core/combat-log.ts for the policy.
      const attempt = await enrichRun(run, cfg, this.log);
      if (attempt.enrichment.status === "complete") {
        result.enrichedComplete++;
      } else {
        result.enrichedUnavailable++;
        this.log.log(
          `[queue] enrichment unavailable for ${hash.slice(0, 12)}: ${attempt.enrichment.statusReason}` +
            (attempt.displayReason ? ` (${attempt.displayReason})` : ""),
        );
      }

      try {
        const submitted = await this.submitRun(run, hash, attempt.enrichment);
        if (submitted === "deduplicated") {
          result.deduplicated++;
        } else {
          result.submitted++;
        }
        addPostedHash(hash);
      } catch (err) {
        if (err instanceof CompanionApiError) {
          result.errors.push({
            runHash: hash,
            error: err.message,
            code: err.code,
            status: err.status,
          });
          this.log.error(
            `[queue] failed to submit run ${hash.slice(0, 12)}: ${err.code} (${err.status}): ${err.message}`,
          );
          // Non-retryable client errors → mark as posted so we don't spin.
          if (
            err.status === 400 ||
            err.status === 403 ||
            (err.status === 404 && err.code !== "dungeon_not_found")
          ) {
            addPostedHash(hash);
          }
        } else {
          throw err;
        }
      }
    }

    // Clean up submitted runs from the SavedVariables file so it
    // doesn't grow forever. Only remove runs we successfully posted.
    if (result.submitted > 0 || result.deduplicated > 0) {
      try {
        const allPosted = new Set(loadConfig().postedRunHashes);
        const cleanup = removeSubmittedRuns(
          savedVariablesPath,
          allPosted,
          computeClientRunHash,
        );
        if (cleanup.removed > 0) {
          this.log.log(
            `[queue] cleaned ${cleanup.removed} submitted run(s) from SavedVariables (${cleanup.remaining} remaining)`,
          );
        }
      } catch (err) {
        // Non-fatal — the file cleanup is best-effort. The dedup
        // hashes prevent re-submission even if cleanup fails.
        this.log.warn(`[queue] failed to clean SavedVariables: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return result;
  }

  private async submitRun(
    run: ParsedRun,
    hash: string,
    enrichment?: import("@mplus/types").RunEnrichmentSubmission,
  ): Promise<"new" | "deduplicated"> {
    const response = await this.apiClient.submitRun(run, enrichment);
    if (response.deduplicated) {
      this.log.log(
        `[queue] dedup hit for ${hash.slice(0, 12)} (server run id ${response.run.id}, ${response.run.juice} Juice)`,
      );
      return "deduplicated";
    }
    this.log.log(
      `[queue] submitted run ${hash.slice(0, 12)} → server id ${response.run.id} (${response.run.juice} Juice)`,
    );
    return "new";
  }
}
