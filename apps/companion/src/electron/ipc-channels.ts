/**
 * IPC channel name + payload type definitions.
 *
 * Shared between main process (electron/main.ts) and preload
 * (preload/preload.ts) to keep the typed surface in sync.
 */

import type { AddonInstallResult } from "./addon-install.js";
import type { WowAccount, WowDetectionResult } from "./wow-detect.js";

export const IPC = {
  /** Detect WoW install on the machine. Returns current config path if already set. */
  WOW_DETECT: "mplus:wow:detect",
  /** Present a folder-picker dialog. Returns selected path or null if cancelled. */
  WOW_CHOOSE_FOLDER: "mplus:wow:chooseFolder",
  /** Scan the WoW root for Battle.net account folders. */
  WOW_SCAN_ACCOUNTS: "mplus:wow:scanAccounts",
  /** Copy the bundled addon to the WoW AddOns folder. */
  ADDON_INSTALL: "mplus:addon:install",
  /** Exchange a 6-digit pairing code for a JWT. Persists JWT on success. */
  AUTH_PAIR: "mplus:auth:pair",
  /** Commit the WoW path + account choice to config. */
  CONFIG_SET_WOW: "mplus:config:setWow",
  /** Mark the wizard as completed. */
  CONFIG_COMPLETE_ONBOARDING: "mplus:config:completeOnboarding",
  /** Read the current companion config (secrets redacted). */
  CONFIG_GET: "mplus:config:get",
  /** Start the watcher + queue loop. */
  WATCHER_START: "mplus:watcher:start",
  /** Stop the watcher cleanly. */
  WATCHER_STOP: "mplus:watcher:stop",
  /** Read a status snapshot: { watcherRunning, queueCount, lastSync } */
  STATUS_GET: "mplus:status:get",
  /** Force-process the SavedVariables file now (ignoring the watcher). */
  STATUS_RESYNC: "mplus:status:resync",
  /** Read the current update state. */
  UPDATE_GET: "mplus:update:get",
  /** Trigger a download of the pending update. */
  UPDATE_DOWNLOAD: "mplus:update:download",
  /** Quit + install the ready update. */
  UPDATE_INSTALL: "mplus:update:install",
  /** Unset jwt + wow config to re-run the wizard. */
  RESET_ONBOARDING: "mplus:config:resetOnboarding",
  /** Return { version, name, electronVersion, nodeVersion, platform } from main */
  APP_INFO: "mplus:app:info",
  /** Set Windows auto-launch on/off */
  APP_SET_AUTO_LAUNCH: "mplus:app:setAutoLaunch",
  /** Get current auto-launch state */
  APP_GET_AUTO_LAUNCH: "mplus:app:getAutoLaunch",
  /** Manually trigger an update check */
  UPDATE_CHECK: "mplus:update:check",
  /** Open a URL in the default browser */
  SHELL_OPEN_EXTERNAL: "mplus:shell:openExternal",
} as const;

// ─── Payload types ────────────────────────────────────────────────────

export interface PairRequest {
  code: string;
}

export interface PairResponse {
  success: boolean;
  userId?: number;
  discordId?: string;
  expiresAt?: string;
  error?: string;
}

export interface SetWowRequest {
  wowInstallPath: string;
  wowAccountName: string;
}

export interface StatusSnapshot {
  watcherRunning: boolean;
  queueCount: number;
  lastSyncAt: string | null;
  paired: boolean;
  pairedUserId: number | null;
  savedVariablesPath: string | null;
  savedVariablesExists: boolean;
}

export interface ResyncResult {
  newRuns: number;
  submitted: number;
  deduplicated: number;
  skipped: number;
  errors: number;
}

export interface UpdateStateSnapshot {
  status: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";
  version?: string;
  progress?: number;
  notes?: string;
  error?: string;
}

export interface AppInfo {
  /** Semver from package.json — e.g. "0.1.3" */
  version: string;
  /** Human product name — "M+ Tracker" */
  name: string;
  /** Electron runtime version */
  electronVersion: string;
  /** Node.js runtime version */
  nodeVersion: string;
  /** win32 / darwin / linux */
  platform: string;
  /** true when packaged, false in dev (`electron dist/…`) */
  packaged: boolean;
}

// Re-exports for convenience (preload needs these types too)
export type { AddonInstallResult, WowAccount, WowDetectionResult };
