/**
 * Run deduplication.
 *
 * When a 5-player key finishes, all 5 players' addons fire
 * CHALLENGE_MODE_COMPLETED and their companion apps each POST the same
 * run to the API. We only want to persist it once.
 *
 * Strategy: hash a stable fingerprint of the run + its members.
 *   (challengeModeId, keystoneLevel, completionMs, sortedMemberIdentities,
 *    serverTime rounded to the minute)
 *
 * Why these fields:
 *   - `completionMs` is the run's duration in ms. Every client observes
 *     the SAME CHALLENGE_MODE_END duration — it's not subject to clock
 *     skew between players.
 *   - Rounding `serverTime` to the minute tolerates the ~1s jitter we
 *     saw in practice (different clients captured GetServerTime()
 *     milliseconds apart and resolved to different integer seconds).
 *   - Sorting members ensures POSTs from different submitters hash
 *     identically regardless of slot order.
 *
 * Two distinct runs essentially cannot collide: same party + same
 * dungeon + same key level + identical duration-to-the-ms + within
 * the same minute would require running the dungeon twice with a
 * perfectly-matching timer, which is astronomically unlikely.
 *
 * The hash is stored in `runs.dedup_hash` with a UNIQUE constraint, so
 * concurrent POSTs race to INSERT and the second one gets a 409 — the
 * route handles the conflict by returning the already-stored run.
 */

import { createHash } from "node:crypto";

export interface DedupMemberIdentity {
  name: string;
  realm: string;
  region: string;
}

export interface DedupInput {
  challengeModeId: number;
  keystoneLevel: number;
  /** Unix seconds at run completion, from the WoW server. */
  serverTime: number;
  /** Run duration in milliseconds — from CHALLENGE_MODE_END. */
  completionMs: number;
  members: DedupMemberIdentity[];
}

/**
 * Quantize serverTime to minute precision. Absorbs the second-level
 * jitter between different players' GetServerTime() captures.
 */
function minuteBucket(serverTimeSec: number): number {
  return Math.floor(serverTimeSec / 60);
}

function fingerprint(input: DedupInput): string {
  const sortedMembers = input.members
    .map((m) => `${m.region}/${m.realm}/${m.name.toLowerCase()}`)
    .sort();
  return [
    `cm=${input.challengeModeId}`,
    `lvl=${input.keystoneLevel}`,
    `dur=${input.completionMs}`,
    `stmin=${minuteBucket(input.serverTime)}`,
    `m=${sortedMembers.join(",")}`,
  ].join("|");
}

export function computeDedupHash(input: DedupInput): string {
  return createHash("sha256").update(fingerprint(input)).digest("hex");
}
