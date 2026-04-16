/**
 * Shared types for run submission, storage, and display.
 *
 * The addon builds a `RunSubmission` object from the post-dungeon
 * `CHALLENGE_MODE_COMPLETED` event, writes it into `MKeyTrackerDB.pendingRuns[]`,
 * and the companion app POSTs it to the API.
 */

import type { WowClass, WowRole } from "./users.js";

export type RunSource = "addon" | "manual" | "raiderio";

export interface RunMemberPayload {
  /** WoW character name */
  name: string;
  /** Normalized realm slug (e.g. "area-52") */
  realm: string;
  class: WowClass;
  /** Spec name as reported by client, e.g. "Blood" */
  spec: string;
  role: WowRole;
}

/**
 * The exact shape the companion app POSTs to `POST /api/v1/runs`.
 * Validated server-side with JSON schema.
 */
export interface RunSubmission {
  /** WoW challenge mode map id (e.g. 378 = Halls of Atonement) */
  challengeModeId: number;
  keystoneLevel: number;
  /** Completion time in ms, from GetCompletionInfo() */
  completionMs: number;
  /** True if the run beat par time */
  onTime: boolean;
  /** 0, 1, 2, or 3 — keystone upgrade levels */
  upgrades: 0 | 1 | 2 | 3;
  /** Total party deaths */
  deaths: number;
  /** Seconds added to run time by deaths (5 sec per death) */
  timeLostSec: number;
  /** Server time as unix seconds at run completion */
  serverTime: number;
  /** Active affix ids from C_MythicPlus.GetCurrentAffixes() */
  affixes: number[];
  /** Region shared by all party members (cross-region parties are impossible) */
  region: "us" | "eu" | "kr" | "tw" | "cn";
  members: RunMemberPayload[];
  /** Optional: event id this run belongs to, if addon was aware of an active event */
  eventId?: number;
  /** Source of the submission — always "addon" for the normal flow */
  source: RunSource;
}

/**
 * Server-side view of a persisted run (with scoring applied).
 */
export interface RunRecord extends RunSubmission {
  id: number;
  parMs: number;
  recordedAt: string;
  verified: boolean;
  groupId: number | null;
  personalJuice: number;
}
