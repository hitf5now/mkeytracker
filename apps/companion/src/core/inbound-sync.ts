/**
 * Pushing platform data back into the game.
 *
 * The addon can't reach the network, so the companion is the only route for
 * a player's Juice, personal bests and group history to reach the WoW UI.
 * It fetches a payload from the API and writes it into
 * `MKeyTrackerDB.inbound`, which the addon reads when SavedVariables load.
 *
 * ## Why this only runs with WoW closed
 *
 * WoW reads SavedVariables at load and writes them at logout or `/reload` —
 * and a `/reload` *writes before it reads*, from the copy in memory. So
 * anything written to that file while the game is running is discarded, not
 * picked up. Writing is therefore gated on the game being closed, which
 * makes inbound data "as of the last time you started WoW". That is the
 * right cadence for what it carries: standings and records you read at the
 * start of a session, not live state.
 */

import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeInbound } from "./sv-parser.js";
import type { CompanionConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface InboundSyncResult {
  status: "written" | "skipped" | "unavailable" | "failed";
  reason?: string;
  rosterCount?: number;
  recordCount?: number;
}

interface Logger {
  log: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
}

/**
 * Is WoW running right now?
 *
 * Only Windows is checked, because that is what the companion ships for.
 * Anywhere else this returns false — the worst case is a wasted write that
 * the game overwrites, not corruption.
 */
export async function isWowRunning(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", "IMAGENAME eq Wow.exe", "/NH"],
      { windowsHide: true, timeout: 10_000 },
    );
    return /Wow\.exe/i.test(stdout);
  } catch {
    // If we can't tell, assume it is running and skip the write. Skipping
    // costs one cycle; writing into a live session is simply lost.
    return true;
  }
}

/**
 * Fetch the inbound payload and write it into the addon's SavedVariables.
 *
 * Never throws: this runs on a timer beside the run sync, and a failure to
 * deliver a leaderboard standing must not disturb posting runs.
 */
export async function syncInbound(args: {
  config: CompanionConfig;
  fetchPayload: () => Promise<Record<string, unknown> | null>;
  log: Logger;
}): Promise<InboundSyncResult> {
  const { config, fetchPayload, log } = args;

  if (!config.jwt) return { status: "skipped", reason: "not paired" };

  const svPath = config.savedVariablesPath;
  if (!svPath || !existsSync(svPath)) {
    return { status: "skipped", reason: "SavedVariables file not found yet" };
  }

  if (await isWowRunning()) {
    // Expected most of the time someone is playing — not worth a warning.
    return { status: "skipped", reason: "WoW is running" };
  }

  let payload: Record<string, unknown> | null;
  try {
    payload = await fetchPayload();
  } catch (err) {
    log.warn(`[inbound] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return { status: "failed", reason: "fetch failed" };
  }

  if (!payload) {
    // 204: no characters or no season yet. Leaving the existing table alone
    // beats overwriting usable data with an empty one.
    return { status: "unavailable", reason: "nothing to send" };
  }

  try {
    writeInbound(svPath, payload);
  } catch (err) {
    log.warn(`[inbound] write failed: ${err instanceof Error ? err.message : String(err)}`);
    return { status: "failed", reason: "write failed" };
  }

  const roster = payload.roster as Record<string, unknown> | undefined;
  const records = payload.records as Record<string, unknown> | undefined;
  const rosterCount = roster ? Object.keys(roster).length : 0;
  const recordCount = records ? Object.keys(records).length : 0;

  log.log(
    `[inbound] wrote ${rosterCount} character(s) and ${recordCount} dungeon record(s) to SavedVariables`,
  );
  return { status: "written", rosterCount, recordCount };
}
