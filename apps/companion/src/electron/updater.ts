/**
 * Auto-update integration via electron-updater.
 *
 * UX (Option B — banner + manual button):
 *   - On app start, silently check for an update
 *   - If one is available, push an IPC event so the dashboard shows a
 *     "Update available" banner with a Download button
 *   - User clicks Download → downloads in background
 *   - When download completes, banner becomes "Restart to install"
 *   - User clicks Restart → autoUpdater.quitAndInstall()
 *
 * Feed: GitHub Releases at hitf5now/mkeytracker (configured in
 * package.json build.publish).
 *
 * IMPORTANT: electron-updater MUST be in `dependencies` (not
 * devDependencies) because electron-builder prunes devDeps before
 * packaging. Using a static import here — if the module were missing,
 * the app would crash loudly at startup instead of silently disabling
 * updates (which is what happened with the old dynamic import pattern).
 */

import { app, BrowserWindow } from "electron";
// electron-updater is CJS; our app is ESM ("type": "module"). Node's
// ESM loader can't extract named exports from CJS modules, so we use
// a default import and destructure from it.
import electronUpdater from "electron-updater";
const autoUpdater = electronUpdater.autoUpdater;

export interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "ready"
    | "error";
  version?: string;
  progress?: number;
  notes?: string;
  error?: string;
}

let currentState: UpdateState = { status: "idle" };
let mainWindow: BrowserWindow | null = null;

function emitState(state: UpdateState): void {
  currentState = state;
  mainWindow?.webContents.send("mplus:events:updateState", state);
}

export async function initAutoUpdater(win: BrowserWindow): Promise<void> {
  mainWindow = win;

  if (!app.isPackaged) {
    console.log("[updater] dev mode (unpackaged) — skipping update check");
    emitState({ status: "idle" });
    return;
  }

  console.log(`[updater] packaged app v${app.getVersion()} — configuring auto-updater`);

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] checking for updates…");
    emitState({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] update available: ${info.version}`);
    emitState({
      status: "available",
      version: info.version,
      notes:
        typeof info.releaseNotes === "string"
          ? info.releaseNotes.slice(0, 400)
          : undefined,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log(`[updater] up to date (current: ${app.getVersion()}, latest: ${info.version})`);
    emitState({ status: "up-to-date" });
  });

  autoUpdater.on("download-progress", (prog) => {
    emitState({
      status: "downloading",
      progress: typeof prog.percent === "number" ? prog.percent : 0,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[updater] update downloaded: ${info.version} — ready to install`);
    emitState({ status: "ready", version: info.version });
  });

  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater] error:", message);
    emitState({ status: "error", error: message });
  });

  // Fire the initial check
  try {
    console.log("[updater] firing initial checkForUpdates…");
    await autoUpdater.checkForUpdates();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater] initial check failed:", message);
    emitState({ status: "error", error: message });
  }
}

export function getUpdateState(): UpdateState {
  return currentState;
}

export async function downloadUpdate(): Promise<void> {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitState({ status: "error", error: message });
  }
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
