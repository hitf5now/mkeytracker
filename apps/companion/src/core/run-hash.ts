/**
 * Client-side run hashing for dedup.
 *
 * Must produce the SAME hash as the addon's client-side dedup AND be
 * compatible with the server's dedup logic (even though it's computed
 * differently — the server uses sha256 over sorted member identities).
 *
 * For companion-side dedup we only need to prevent re-POSTing a run the
 * companion has already successfully POSTed. A local fingerprint is
 * sufficient — it doesn't need to match the server's hash exactly.
 */

import { createHash } from "node:crypto";
import type { ParsedRun } from "./sv-parser.js";

export function computeClientRunHash(run: ParsedRun): string {
  const sortedMembers = run.members
    .map((m) => `${m.realm}/${m.name.toLowerCase()}`)
    .sort();
  const fingerprint = [
    `cm=${run.challengeModeId}`,
    `lvl=${run.keystoneLevel}`,
    `st=${run.serverTime}`,
    `m=${sortedMembers.join(",")}`,
  ].join("|");
  return createHash("sha256").update(fingerprint).digest("hex");
}
