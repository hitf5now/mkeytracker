/**
 * Auto-update integration via electron-updater.
 *
 * Update feed: GitHub Releases at hitf5now/mkeytracker. electron-builder
 * publishes the installer + a `latest.yml` manifest; electron-updater
 * reads that manifest and compares against app.getVersion().
 *
 * UX (per user choice: Option B — banner + manual button, not seamless):
 *   - On app start, silently check for an update
 *   - If one is available, push an IPC event so the dashboard shows a
 *     "Update available — v1.2.3" banner with a Download button
 *   - User clicks Download → electron-updater downloads in the background
 *   - When download completes, push another event so the banner becomes
 *     "Update ready — Restart to install"
 *   - User clicks Restart → autoUpdater.quitAndInstall()
 *
 * This module is a no-op in dev (when the app isn't packaged) because
 * electron-updater only works against signed / versioned releases.
 */

import { app, BrowserWindow } from "electron";

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
let updaterInstance: unknown = null;

function emitState(state: UpdateState): void {
    currentState = state;
    mainWindow?.webContents.send("mplus:events:updateState", state);
}

/**
 * Wires up electron-updater if it's available. Fails gracefully if the
 * package isn't installed (we still ship without it — it's only pulled
 * in during packaging).
 */
export async function initAutoUpdater(win: BrowserWindow): Promise<void> {
    mainWindow = win;

    if (!app.isPackaged) {
        console.log("[updater] skipping — running unpackaged (dev mode)");
        emitState({ status: "idle" });
        return;
    }

    try {
        // Dynamic import so the dep is only required in production builds.
        // Using string concatenation prevents bundlers from statically
        // resolving the package when it's not present in dev.
        const moduleName = "electron-" + "updater";
        const { autoUpdater } = (await import(moduleName)) as {
            autoUpdater: {
                on: (event: string, listener: (...args: unknown[]) => void) => void;
                autoDownload: boolean;
                autoInstallOnAppQuit: boolean;
                checkForUpdates: () => Promise<unknown>;
                downloadUpdate: () => Promise<unknown>;
                quitAndInstall: () => void;
            };
        };

        autoUpdater.autoDownload = false; // user-initiated per UX spec
        autoUpdater.autoInstallOnAppQuit = true;
        updaterInstance = autoUpdater;

        autoUpdater.on("checking-for-update", () => {
            emitState({ status: "checking" });
        });
        autoUpdater.on("update-available", (info: unknown) => {
            const i = info as { version?: string; releaseNotes?: string };
            emitState({
                status: "available",
                version: i.version,
                notes:
                    typeof i.releaseNotes === "string"
                        ? i.releaseNotes.slice(0, 400)
                        : undefined,
            });
        });
        autoUpdater.on("update-not-available", () => {
            emitState({ status: "up-to-date" });
        });
        autoUpdater.on("download-progress", (prog: unknown) => {
            const p = prog as { percent?: number };
            emitState({
                status: "downloading",
                progress: typeof p.percent === "number" ? p.percent : 0,
            });
        });
        autoUpdater.on("update-downloaded", (info: unknown) => {
            const i = info as { version?: string };
            emitState({ status: "ready", version: i.version });
        });
        autoUpdater.on("error", (err: unknown) => {
            const message =
                err instanceof Error ? err.message : String(err);
            console.error("[updater] error:", message);
            emitState({ status: "error", error: message });
        });

        // Fire the initial check. Wrapped in catch because
        // checkForUpdates() rejects if the feed isn't reachable.
        try {
            await autoUpdater.checkForUpdates();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn("[updater] initial check failed:", message);
        }
    } catch (err) {
        console.warn("[updater] electron-updater not installed — skipping", err);
    }
}

export function getUpdateState(): UpdateState {
    return currentState;
}

export async function downloadUpdate(): Promise<void> {
    if (!updaterInstance) return;
    const u = updaterInstance as { downloadUpdate: () => Promise<unknown> };
    try {
        await u.downloadUpdate();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emitState({ status: "error", error: message });
    }
}

export function quitAndInstall(): void {
    if (!updaterInstance) return;
    const u = updaterInstance as { quitAndInstall: () => void };
    u.quitAndInstall();
}
