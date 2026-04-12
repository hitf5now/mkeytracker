/**
 * Run deduplication.
 *
 * When a 5-player key finishes, all 5 players' addons fire
 * CHALLENGE_MODE_COMPLETED and their companion apps will each POST the
 * same run to the API. We only want to persist it once.
 *
 * Strategy: hash a stable fingerprint of the run + its members.
 * `(dungeonChallengeModeId, keystoneLevel, serverTime, sortedMemberIdentities)`
 * uniquely identifies a run — two separate runs cannot share all of those.
 *
 * The hash is stored in `runs.dedup_hash` with a UNIQUE constraint, so
 * concurrent POSTs race to INSERT and the second one gets a 409. The
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
  /** Unix seconds at run completion, from the WoW server */
  serverTime: number;
  members: DedupMemberIdentity[];
}

/**
 * Build the canonical fingerprint string. Sorting member identities
 * ensures POSTs from different members of the same party produce the
 * same hash regardless of submission order or party slot position.
 */
function fingerprint(input: DedupInput): string {
  const sortedMembers = input.members
    .map((m) => `${m.region}/${m.realm}/${m.name.toLowerCase()}`)
    .sort();
  return [
    `cm=${input.challengeModeId}`,
    `lvl=${input.keystoneLevel}`,
    `st=${input.serverTime}`,
    `m=${sortedMembers.join(",")}`,
  ].join("|");
}

export function computeDedupHash(input: DedupInput): string {
  return createHash("sha256").update(fingerprint(input)).digest("hex");
}
