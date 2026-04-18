/**
 * Electron main process.
 *
 * Responsibilities:
 *   - Boot the app, create the main BrowserWindow
 *   - Decide whether to show the wizard (first-run) or dashboard
 *   - Register all IPC handlers that the renderer calls via window.mplus
 *   - Own the core RunQueue + SavedVariablesWatcher lifecycle
 *   - System tray (wired up in a later batch)
 *
 * The renderer is plain HTML + JS, loaded from dist/renderer/. Node is
 * NOT enabled in the renderer — all system access goes through the
 * preload's contextBridge.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CompanionApiClient } from "../core/api-client.js";
import {
  addPostedHash,
  deriveSavedVariablesPath,
  loadConfig,
  updateConfig,
} from "../core/config.js";
import { fileLogger, getLogFilePath, initFileLogger } from "../core/file-logger.js";
import { RunQueue } from "../core/queue.js";
import { recordEvent, startTelemetry, stopTelemetry } from "../core/telemetry.js";
import { SavedVariablesWatcher } from "../core/watcher.js";

import { installAddon } from "./addon-install.js";
import {
  destroyTray,
  setupTray,
  updateMenu,
  updateTrayBadge,
  wireCloseToTray,
} from "./tray.js";
import {
  checkForUpdatesManually,
  downloadUpdate,
  getUpdateState,
  initAutoUpdater,
  quitAndInstall,
} from "./updater.js";
import { detectWowInstall, hasRetailSubfolder, scanWowAccounts } from "./wow-detect.js";
import {
  IPC,
  type AppInfo,
  type EnrichmentBackfillResult,
  type EnrichmentBackfillSegmentResult,
  type EnrichmentDiagnoseResult,
  type PairRequest,
  type PairResponse,
  type ResyncResult,
  type SetWowRequest,
  type StatusSnapshot,
} from "./ipc-channels.js";
import { resolveCombatLogsDir, summaryToSubmission } from "../core/combat-log.js";
import { summarizeAllSegmentsInLogFile } from "@mplus/combat-log-parser";
import { readdirSync, statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── App-wide state ───────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let watcher: SavedVariablesWatcher | null = null;
let queue: RunQueue | null = null;
let lastSyncAt: string | null = null;
let runsSyncedThisSession = 0;

// ─── Window creation ──────────────────────────────────────────────────
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 620,
    minHeight: 520,
    title: "M+ Tracker Companion",
    autoHideMenuBar: true,
    backgroundColor: "#0f1115",
    show: false, // show after ready-to-show to avoid white flash
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Decide which page to load: wizard if first-run, dashboard otherwise.
  const cfg = loadConfig();
  const page =
    cfg.onboarded && cfg.jwt && cfg.savedVariablesPath
      ? "dashboard.html"
      : "wizard.html";
  const htmlPath = join(__dirname, "..", "renderer", page);
  void win.loadFile(htmlPath);

  // Close-to-tray instead of quit
  wireCloseToTray(win);

  return win;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ─── Core watcher lifecycle ───────────────────────────────────────────
function startWatcherIfReady(): void {
  if (watcher) return; // already running
  const cfg = loadConfig();
  if (!cfg.jwt || !cfg.savedVariablesPath) return;
  if (!existsSync(cfg.savedVariablesPath)) {
    console.warn(
      `[main] SavedVariables not found yet at ${cfg.savedVariablesPath} — will pick up when WoW creates it.`,
    );
  }

  const apiClient = new CompanionApiClient(cfg.apiBaseUrl, cfg.jwt);
  queue = new RunQueue(apiClient, fileLogger);

  watcher = new SavedVariablesWatcher(cfg.savedVariablesPath, 500);
  watcher.on("ready", () => {
    console.log("[main] watcher ready");
    void processTick("initial");
  });
  watcher.on("updated", () => {
    void processTick("file-change");
  });
  watcher.on("error", (err) => {
    console.error("[main] watcher error:", err.message);
  });
  watcher.start();
  console.log(`[main] watcher started on ${cfg.savedVariablesPath}`);
}

async function processTick(trigger: string): Promise<ResyncResult> {
  const cfg = loadConfig();
  if (!queue || !cfg.savedVariablesPath) {
    return { newRuns: 0, submitted: 0, deduplicated: 0, skipped: 0, errors: 0, enrichedComplete: 0, enrichedUnavailable: 0 };
  }
  if (!existsSync(cfg.savedVariablesPath)) {
    console.warn(`[main] ${trigger} tick but SavedVariables file missing`);
    return { newRuns: 0, submitted: 0, deduplicated: 0, skipped: 0, errors: 0, enrichedComplete: 0, enrichedUnavailable: 0 };
  }
  try {
    const result = await queue.processSavedVariables(cfg.savedVariablesPath);
    if (result.newRuns > 0 || result.errors.length > 0) {
      console.log(
        `[main] ${trigger} tick: new=${result.newRuns} submitted=${result.submitted} dedup=${result.deduplicated} enriched=${result.enrichedComplete}/${result.newRuns} errors=${result.errors.length}`,
      );
      lastSyncAt = new Date().toISOString();
      runsSyncedThisSession += result.submitted;
      mainWindow?.webContents.send("mplus:events:queueUpdate");
      updateTrayBadge(runsSyncedThisSession);
      refreshTrayMenu();

      // Telemetry
      for (let i = 0; i < result.submitted; i++) recordEvent("run_submitted");
      for (let i = 0; i < result.deduplicated; i++) recordEvent("run_dedup_hit");
      for (let i = 0; i < result.errors.length; i++) recordEvent("run_error");
      for (let i = 0; i < result.enrichedComplete; i++) recordEvent("run_enriched");
      for (let i = 0; i < result.enrichedUnavailable; i++) recordEvent("run_enrich_unavailable");
    }
    return {
      newRuns: result.newRuns,
      submitted: result.submitted,
      deduplicated: result.deduplicated,
      skipped: result.skipped,
      errors: result.errors.length,
      enrichedComplete: result.enrichedComplete,
      enrichedUnavailable: result.enrichedUnavailable,
    };
  } catch (err) {
    console.error("[main] tick error:", err);
    recordEvent("error", { where: "processTick" });
    return { newRuns: 0, submitted: 0, deduplicated: 0, skipped: 0, errors: 1, enrichedComplete: 0, enrichedUnavailable: 0 };
  }
}

function refreshTrayMenu(): void {
  updateMenu(trayCallbacks, {
    queueCount: runsSyncedThisSession,
    watcherRunning: watcher !== null,
  });
}

const trayCallbacks = {
  onOpen: () => showMainWindow(),
  onResync: async () => {
    await processTick("tray-resync");
  },
  onPairAgain: () => {
    updateConfig({ jwt: null, jwtExpiresAt: null, onboarded: false });
    showMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const html = join(__dirname, "..", "renderer", "wizard.html");
      void mainWindow.loadFile(html);
    }
  },
  onQuit: () => {
    (app as unknown as { isQuitting?: boolean }).isQuitting = true;
    app.quit();
  },
};

async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.stop();
    watcher = null;
  }
  queue = null;
}

// ─── IPC handlers ─────────────────────────────────────────────────────
function registerIpcHandlers(): void {
  ipcMain.handle(IPC.WOW_DETECT, async () => detectWowInstall());

  ipcMain.handle(IPC.WOW_CHOOSE_FOLDER, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select your World of Warcraft install folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0]!;
    return {
      installPath: picked,
      source: "manual",
      hasRetail: hasRetailSubfolder(picked),
    };
  });

  ipcMain.handle(IPC.WOW_SCAN_ACCOUNTS, async (_e, wowRoot: string) =>
    scanWowAccounts(wowRoot),
  );

  ipcMain.handle(IPC.ADDON_INSTALL, async (_e, wowRoot: string) =>
    installAddon(wowRoot),
  );

  ipcMain.handle(IPC.CONFIG_SET_WOW, async (_e, req: SetWowRequest) => {
    const svPath = deriveSavedVariablesPath(req.wowInstallPath, req.wowAccountName);
    updateConfig({
      wowInstallPath: req.wowInstallPath,
      wowAccountName: req.wowAccountName,
      savedVariablesPath: svPath,
    });
    return { ok: true, savedVariablesPath: svPath };
  });

  ipcMain.handle(IPC.AUTH_PAIR, async (_e, req: PairRequest): Promise<PairResponse> => {
    if (!/^\d{6}$/.test(req.code)) {
      return { success: false, error: "Code must be 6 digits." };
    }
    const cfg = loadConfig();
    const client = new CompanionApiClient(cfg.apiBaseUrl, null);
    try {
      const result = await client.exchangeLinkCode(req.code);
      updateConfig({ jwt: result.token, jwtExpiresAt: result.expiresAt });
      return {
        success: true,
        userId: result.user.id,
        discordId: result.user.discordId,
        expiresAt: result.expiresAt,
      };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unknown error during pairing.";
      return { success: false, error: msg };
    }
  });

  ipcMain.handle(IPC.CONFIG_COMPLETE_ONBOARDING, async () => {
    updateConfig({ onboarded: true });
    startWatcherIfReady();
    // Reload the window to show the dashboard instead of the wizard.
    if (mainWindow) {
      const html = join(__dirname, "..", "renderer", "dashboard.html");
      void mainWindow.loadFile(html);
    }
    return { ok: true };
  });

  ipcMain.handle(IPC.CONFIG_GET, async () => {
    const cfg = loadConfig();
    // Redact secrets before sending to renderer
    return {
      onboarded: cfg.onboarded,
      apiBaseUrl: cfg.apiBaseUrl,
      wowInstallPath: cfg.wowInstallPath,
      wowAccountName: cfg.wowAccountName,
      savedVariablesPath: cfg.savedVariablesPath,
      paired: cfg.jwt !== null,
      jwtExpiresAt: cfg.jwtExpiresAt,
      lastSubmittedAt: cfg.lastSubmittedAt,
      postedRunHashesCount: cfg.postedRunHashes.length,
    };
  });

  ipcMain.handle(IPC.WATCHER_START, async () => {
    startWatcherIfReady();
    return { ok: true, running: watcher !== null };
  });

  ipcMain.handle(IPC.WATCHER_STOP, async () => {
    await stopWatcher();
    return { ok: true };
  });

  ipcMain.handle(IPC.STATUS_GET, async (): Promise<StatusSnapshot> => {
    const cfg = loadConfig();
    return {
      watcherRunning: watcher !== null,
      queueCount: cfg.postedRunHashes.length,
      lastSyncAt,
      paired: cfg.jwt !== null,
      pairedUserId: null, // not stored locally; could decode JWT if needed
      savedVariablesPath: cfg.savedVariablesPath,
      savedVariablesExists: cfg.savedVariablesPath ? existsSync(cfg.savedVariablesPath) : false,
    };
  });

  ipcMain.handle(IPC.STATUS_RESYNC, async () => processTick("manual-resync"));

  ipcMain.handle(IPC.UPDATE_GET, async () => getUpdateState());
  ipcMain.handle(IPC.UPDATE_DOWNLOAD, async () => {
    await downloadUpdate();
    return { ok: true };
  });
  ipcMain.handle(IPC.UPDATE_INSTALL, async () => {
    quitAndInstall();
    return { ok: true };
  });

  ipcMain.handle(IPC.RESET_ONBOARDING, async () => {
    updateConfig({ onboarded: false });
    if (mainWindow && !mainWindow.isDestroyed()) {
      const html = join(__dirname, "..", "renderer", "wizard.html");
      void mainWindow.loadFile(html);
    }
    return { ok: true };
  });

  ipcMain.handle(IPC.APP_INFO, async (): Promise<AppInfo> => ({
    version: app.getVersion(),
    name: app.getName(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    packaged: app.isPackaged,
  }));

  ipcMain.handle(IPC.APP_SET_AUTO_LAUNCH, async (_e, enabled: boolean) => {
    if (!app.isPackaged) return { ok: false, reason: "dev mode" };
    app.setLoginItemSettings({ openAtLogin: enabled });
    return { ok: true, enabled };
  });

  ipcMain.handle(IPC.APP_GET_AUTO_LAUNCH, async () => {
    if (!app.isPackaged) return { enabled: false, devMode: true };
    const settings = app.getLoginItemSettings();
    return { enabled: settings.openAtLogin };
  });

  ipcMain.handle(IPC.UPDATE_CHECK, async () => {
    await checkForUpdatesManually();
    return { ok: true };
  });

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_e, url: string) => {
    // Only allow http/https URLs to prevent shell injection
    if (!/^https?:\/\//i.test(url)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle(IPC.LOG_OPEN, async () => {
    const p = getLogFilePath();
    if (!p) return { ok: false, reason: "log not initialized yet" };
    const res = await shell.openPath(p);
    return { ok: res === "", path: p, error: res || undefined };
  });

  ipcMain.handle(IPC.ENRICHMENT_DIAGNOSE, async (): Promise<EnrichmentDiagnoseResult> => {
    const cfg = loadConfig();
    const result: EnrichmentDiagnoseResult = {
      logFilePath: getLogFilePath(),
      logsDir: null,
      logsDirExists: false,
      combatLogFiles: [],
      pickedFile: null,
      segments: [],
      message: "",
    };

    const logsDir = resolveCombatLogsDir(cfg);
    result.logsDir = logsDir;
    if (!logsDir) {
      result.message = "WoW install path is not configured — finish the setup wizard first.";
      fileLogger.warn("[diagnose] no WoW install path");
      return result;
    }
    result.logsDirExists = existsSync(logsDir);
    if (!result.logsDirExists) {
      result.message = `Logs directory doesn't exist: ${logsDir}. Is WoW installed here?`;
      fileLogger.warn(`[diagnose] logs dir missing: ${logsDir}`);
      return result;
    }

    try {
      const entries = readdirSync(logsDir);
      const files = entries
        .filter((n) => /^WoWCombatLog.*\.txt$/i.test(n))
        .map((n) => {
          const p = join(logsDir, n);
          const st = statSync(p);
          return {
            path: p,
            name: n,
            size: st.size,
            mtimeMs: st.mtimeMs,
          };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      result.combatLogFiles = files.map((f) => ({
        name: f.name,
        size: f.size,
        mtime: new Date(f.mtimeMs).toISOString(),
      }));
      fileLogger.log(`[diagnose] found ${files.length} WoWCombatLog*.txt file(s) in ${logsDir}`);

      if (files.length === 0) {
        result.message =
          "No WoWCombatLog*.txt files found. Enable combat logging in-game with /combatlog.";
        return result;
      }

      const newest = files[0]!;
      result.pickedFile = newest.path;
      fileLogger.log(`[diagnose] parsing newest file: ${newest.path}`);

      try {
        const segments = await summarizeAllSegmentsInLogFile(newest.path);
        result.segments = segments.map((s, i) => ({
          index: i,
          challengeModeId: s.challengeModeId,
          zoneName: s.zoneName,
          keystoneLevel: s.keystoneLevel,
          playerCount: s.players.length,
          encounterCount: s.encounters.length,
          totalDamage: s.totals.damage,
          endedAt: s.endedAt.toISOString(),
        }));
        result.message =
          segments.length === 0
            ? "File parsed but contained no completed CHALLENGE_MODE segments."
            : `Parsed ${segments.length} segment(s) successfully.`;
        fileLogger.log(`[diagnose] parsed ${segments.length} segment(s) from ${newest.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.message = `Parse failed: ${msg}`;
        fileLogger.error(`[diagnose] parse failed for ${newest.path}: ${msg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.message = `Couldn't scan logs dir: ${msg}`;
      fileLogger.error(`[diagnose] scan failed: ${msg}`);
    }

    return result;
  });

  ipcMain.handle(IPC.ENRICHMENT_BACKFILL, async (): Promise<EnrichmentBackfillResult> => {
    const totals = { created: 0, replaced: 0, alreadyComplete: 0, noMatch: 0, error: 0 };
    const segResults: EnrichmentBackfillSegmentResult[] = [];

    const cfg = loadConfig();
    if (!cfg.jwt) {
      fileLogger.warn("[backfill] no JWT — pair the companion first");
      return { segments: [], totals, message: "Not paired — finish setup first." };
    }

    const logsDir = resolveCombatLogsDir(cfg);
    if (!logsDir || !existsSync(logsDir)) {
      return {
        segments: [],
        totals,
        message: "WoW logs directory not found — check the setup wizard.",
      };
    }

    // Find newest combat log and parse every segment.
    let newestPath: string | null = null;
    try {
      const files = readdirSync(logsDir)
        .filter((n) => /^WoWCombatLog.*\.txt$/i.test(n))
        .map((n) => ({ path: join(logsDir, n), mtime: statSync(join(logsDir, n)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      newestPath = files[0]?.path ?? null;
    } catch (err) {
      fileLogger.error(`[backfill] couldn't list logs dir: ${err instanceof Error ? err.message : err}`);
    }

    if (!newestPath) {
      return { segments: [], totals, message: "No WoWCombatLog*.txt files found." };
    }

    fileLogger.log(`[backfill] parsing ${newestPath}`);
    let segments;
    try {
      segments = await summarizeAllSegmentsInLogFile(newestPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fileLogger.error(`[backfill] parse failed: ${msg}`);
      return { segments: [], totals, message: `Parse failed: ${msg}` };
    }
    fileLogger.log(`[backfill] parsed ${segments.length} segment(s); posting each to the API`);

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      const base: EnrichmentBackfillSegmentResult = {
        index: i,
        challengeModeId: s.challengeModeId,
        zoneName: s.zoneName,
        keystoneLevel: s.keystoneLevel,
        segmentEnd: s.endedAt.toISOString(),
        outcome: "error",
      };

      try {
        const body = {
          challengeModeId: s.challengeModeId,
          // serverTime is unix seconds, matching Run.serverTime on the server.
          serverTime: Math.floor(s.endedAt.getTime() / 1000),
          enrichment: summaryToSubmission(s, "complete"),
        };
        const res = await fetch(`${cfg.apiBaseUrl}/api/v1/runs/enrich-by-match`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.jwt}`,
          },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as {
          status?: string;
          runId?: number;
          enrichmentId?: number;
          previousStatus?: string;
          message?: string;
          error?: string;
        };

        if (!res.ok) {
          base.outcome = "error";
          base.message = `HTTP ${res.status}: ${json.error ?? json.message ?? "unknown"}`;
          totals.error++;
          fileLogger.warn(
            `[backfill] segment ${i} (cmId=${s.challengeModeId}): ${base.message}`,
          );
        } else {
          const status = json.status ?? "error";
          base.outcome = status;
          base.runId = json.runId;
          base.enrichmentId = json.enrichmentId;
          base.previousStatus = json.previousStatus;
          base.message = json.message;
          switch (status) {
            case "created":
              totals.created++;
              break;
            case "replaced":
              totals.replaced++;
              break;
            case "already_complete":
              totals.alreadyComplete++;
              break;
            case "no_match":
              totals.noMatch++;
              break;
            default:
              totals.error++;
          }
          fileLogger.log(
            `[backfill] segment ${i} (cmId=${s.challengeModeId}) → ${status}${json.runId ? ` runId=${json.runId}` : ""}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        base.outcome = "error";
        base.message = msg;
        totals.error++;
        fileLogger.error(`[backfill] segment ${i}: ${msg}`);
      }

      segResults.push(base);
    }

    const summary =
      `Backfilled: ${totals.created} created, ${totals.replaced} replaced, ` +
      `${totals.alreadyComplete} already complete, ${totals.noMatch} no match` +
      (totals.error > 0 ? `, ${totals.error} errors` : "");
    fileLogger.log(`[backfill] done — ${summary}`);

    return { segments: segResults, totals, message: summary };
  });
}

// ─── Auto-update addon on startup ────────────────────────────────────
// Every time the companion starts (including after auto-update), ensure
// the WoW addon is up to date by copying the bundled version over.
function syncAddonOnStartup(): void {
  const cfg = loadConfig();
  if (!cfg.wowInstallPath || !cfg.onboarded) return;

  try {
    const result = installAddon(cfg.wowInstallPath);
    if (result.success) {
      console.log(`[main] addon synced to ${result.targetPath} (${result.filesCopied} files)`);
    } else {
      console.warn(`[main] addon sync failed: ${result.error}`);
    }
  } catch (err) {
    console.warn(`[main] addon sync error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────
app.whenReady().then(() => {
  // File logger first so every subsequent step is recorded.
  const logPath = initFileLogger(app.getPath("userData"));
  fileLogger.log(`companion v${app.getVersion()} starting — log at ${logPath}`);

  registerIpcHandlers();
  mainWindow = createMainWindow();
  setupTray(trayCallbacks);
  refreshTrayMenu();
  syncAddonOnStartup();
  startWatcherIfReady();
  startTelemetry();
  recordEvent("app_started");
  void initAutoUpdater(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    } else {
      showMainWindow();
    }
  });
});

// Single-instance lock: second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
}

// Close-to-tray behavior: don't quit on window-all-closed.
// The only way to actually quit is the tray menu's Quit item.
app.on("window-all-closed", () => {
  // Close-to-tray: the window close handler already hid the window and
  // this event technically means "no windows open", but we want to keep
  // running in the tray. Do nothing here — Electron will keep the app
  // alive as long as the Tray object exists.
});

app.on("before-quit", () => {
  (app as unknown as { isQuitting?: boolean }).isQuitting = true;
  destroyTray();
  stopTelemetry();
  void stopWatcher();
});

// Silence an unused-import lint in some toolchains
void addPostedHash;
