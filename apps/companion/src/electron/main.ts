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
  type PairRequest,
  type PairResponse,
  type ResyncResult,
  type SetWowRequest,
  type StatusSnapshot,
} from "./ipc-channels.js";

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
  queue = new RunQueue(apiClient);

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
    return { newRuns: 0, submitted: 0, deduplicated: 0, skipped: 0, errors: 0 };
  }
  if (!existsSync(cfg.savedVariablesPath)) {
    console.warn(`[main] ${trigger} tick but SavedVariables file missing`);
    return { newRuns: 0, submitted: 0, deduplicated: 0, skipped: 0, errors: 0 };
  }
  try {
    const result = await queue.processSavedVariables(cfg.savedVariablesPath);
    if (result.newRuns > 0 || result.errors.length > 0) {
      console.log(
        `[main] ${trigger} tick: new=${result.newRuns} submitted=${result.submitted} dedup=${result.deduplicated} errors=${result.errors.length}`,
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
    }
    return {
      newRuns: result.newRuns,
      submitted: result.submitted,
      deduplicated: result.deduplicated,
      skipped: result.skipped,
      errors: result.errors.length,
    };
  } catch (err) {
    console.error("[main] tick error:", err);
    recordEvent("error", { where: "processTick" });
    return { newRuns: 0, submitted: 0, deduplicated: 0, skipped: 0, errors: 1 };
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
}

// ─── App lifecycle ────────────────────────────────────────────────────
app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createMainWindow();
  setupTray(trayCallbacks);
  refreshTrayMenu();
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
