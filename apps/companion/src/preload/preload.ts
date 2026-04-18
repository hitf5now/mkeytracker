/**
 * Preload script — the safe bridge between the sandboxed renderer and
 * the Node-privileged main process.
 *
 * Exposes `window.mplus.*` methods that each round-trip to a main-process
 * IPC handler. The renderer cannot access Node directly — everything
 * goes through this typed surface.
 *
 * Since we're in CJS-compatible preload context (electron preloads run
 * before the renderer and support both CJS and ESM), we use `require`
 * for electron imports to be maximally compatible across Electron versions.
 */

import { contextBridge, ipcRenderer } from "electron";

import {
  IPC,
  type AddonInstallResult,
  type AppInfo,
  type EnrichmentBackfillResult,
  type EnrichmentDiagnoseResult,
  type PairRequest,
  type PairResponse,
  type ResyncResult,
  type SetWowRequest,
  type StatusSnapshot,
  type UpdateStateSnapshot,
  type WowAccount,
  type WowDetectionResult,
} from "../electron/ipc-channels.js";

interface CompanionConfigSnapshot {
  onboarded: boolean;
  apiBaseUrl: string;
  wowInstallPath: string | null;
  wowAccountName: string | null;
  savedVariablesPath: string | null;
  paired: boolean;
  jwtExpiresAt: string | null;
  lastSubmittedAt: string | null;
  postedRunHashesCount: number;
}

const api = {
  // WoW detection + folder picker
  wowDetect: (): Promise<WowDetectionResult> => ipcRenderer.invoke(IPC.WOW_DETECT),
  wowChooseFolder: (): Promise<WowDetectionResult | null> =>
    ipcRenderer.invoke(IPC.WOW_CHOOSE_FOLDER),
  wowScanAccounts: (wowRoot: string): Promise<WowAccount[]> =>
    ipcRenderer.invoke(IPC.WOW_SCAN_ACCOUNTS, wowRoot),

  // Addon
  addonInstall: (wowRoot: string): Promise<AddonInstallResult> =>
    ipcRenderer.invoke(IPC.ADDON_INSTALL, wowRoot),

  // Auth + onboarding
  authPair: (req: PairRequest): Promise<PairResponse> =>
    ipcRenderer.invoke(IPC.AUTH_PAIR, req),
  configSetWow: (req: SetWowRequest): Promise<{ ok: boolean; savedVariablesPath: string | null }> =>
    ipcRenderer.invoke(IPC.CONFIG_SET_WOW, req),
  configCompleteOnboarding: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.CONFIG_COMPLETE_ONBOARDING),
  configGet: (): Promise<CompanionConfigSnapshot> => ipcRenderer.invoke(IPC.CONFIG_GET),

  // Watcher control + status
  watcherStart: (): Promise<{ ok: boolean; running: boolean }> =>
    ipcRenderer.invoke(IPC.WATCHER_START),
  watcherStop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.WATCHER_STOP),
  statusGet: (): Promise<StatusSnapshot> => ipcRenderer.invoke(IPC.STATUS_GET),
  statusResync: (): Promise<ResyncResult> => ipcRenderer.invoke(IPC.STATUS_RESYNC),

  // Auto-update
  updateGet: (): Promise<UpdateStateSnapshot> => ipcRenderer.invoke(IPC.UPDATE_GET),
  updateDownload: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
  updateInstall: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.UPDATE_INSTALL),

  // Re-run the wizard
  resetOnboarding: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.RESET_ONBOARDING),

  // App metadata — version, Electron/Node runtime info
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.APP_INFO),

  // Auto-launch on Windows startup
  setAutoLaunch: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.APP_SET_AUTO_LAUNCH, enabled),
  getAutoLaunch: (): Promise<{ enabled: boolean }> =>
    ipcRenderer.invoke(IPC.APP_GET_AUTO_LAUNCH),

  // Manual update check
  updateCheck: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.UPDATE_CHECK),

  // Open URL in the default browser
  openExternal: (url: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),

  // Diagnostics — dry-run enrichment against the user's combat logs.
  enrichmentDiagnose: (): Promise<EnrichmentDiagnoseResult> =>
    ipcRenderer.invoke(IPC.ENRICHMENT_DIAGNOSE),
  // Backfill — for each segment in the latest log, POST to the API's
  // enrich-by-match endpoint and fill in any missing enrichment.
  enrichmentBackfill: (): Promise<EnrichmentBackfillResult> =>
    ipcRenderer.invoke(IPC.ENRICHMENT_BACKFILL),
  // Open the companion log file in the OS default viewer.
  openLogFile: (): Promise<{ ok: boolean; path?: string; error?: string; reason?: string }> =>
    ipcRenderer.invoke(IPC.LOG_OPEN),

  // Push events from main → renderer
  onQueueUpdate: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on("mplus:events:queueUpdate", listener);
    return () => ipcRenderer.removeListener("mplus:events:queueUpdate", listener);
  },
  onUpdateState: (cb: (state: UpdateStateSnapshot) => void): (() => void) => {
    const listener = (_e: unknown, state: UpdateStateSnapshot): void => cb(state);
    ipcRenderer.on("mplus:events:updateState", listener);
    return () => ipcRenderer.removeListener("mplus:events:updateState", listener);
  },
};

export type MplusApi = typeof api;

contextBridge.exposeInMainWorld("mplus", api);
