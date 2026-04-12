/**
 * System tray integration.
 *
 * Owns the Tray icon, the right-click menu, and the show/hide cycle.
 * Also manages the "close-to-tray" UX: the first time the user clicks
 * the window's close button, we show a native notification explaining
 * the app is still running in the background.
 */

import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;
let hasShownCloseToTrayToast = false;

interface TrayCallbacks {
    onOpen: () => void;
    onResync: () => Promise<void>;
    onPairAgain: () => void;
    onQuit: () => void;
}

/**
 * Find an icon file bundled next to the compiled main.js. We try PNG
 * first (best quality on modern Windows + good on macOS), then fall
 * back to the ICO generated at packaging time.
 */
function resolveTrayIconPath(): string | null {
    const candidates = [
        join(__dirname, "..", "renderer", "assets", "icon.png"),
        join(__dirname, "..", "renderer", "assets", "icon.ico"),
        join(__dirname, "..", "..", "build", "icon.png"),
    ];
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return null;
}

export function setupTray(callbacks: TrayCallbacks): Tray {
    const iconPath = resolveTrayIconPath();
    const icon = iconPath
        ? nativeImage.createFromPath(iconPath)
        : nativeImage.createEmpty();

    tray = new Tray(icon);
    tray.setToolTip("M+ Tracker — capturing your Mythic+ runs");

    updateMenu(callbacks, { queueCount: 0, watcherRunning: false });

    // Clicking the tray icon on Windows shows/hides the window.
    tray.on("click", () => callbacks.onOpen());

    return tray;
}

export function updateMenu(
    callbacks: TrayCallbacks,
    state: { queueCount: number; watcherRunning: boolean },
): void {
    if (!tray) return;
    const statusLabel = state.watcherRunning
        ? "● Watcher running"
        : "○ Watcher idle";
    const queueLabel =
        state.queueCount > 0
            ? `${state.queueCount} run(s) synced this session`
            : "No activity yet";

    const menu = Menu.buildFromTemplate([
        { label: `M+ Tracker v${app.getVersion()}`, enabled: false },
        { label: statusLabel, enabled: false },
        { label: queueLabel, enabled: false },
        { type: "separator" },
        { label: "Open", click: callbacks.onOpen },
        { label: "Re-sync now", click: () => void callbacks.onResync() },
        { label: "Pair again…", click: callbacks.onPairAgain },
        { type: "separator" },
        { label: "Quit", click: callbacks.onQuit },
    ]);

    tray.setContextMenu(menu);
}

export function updateTrayBadge(queueCount: number): void {
    if (!tray) return;
    const tooltip =
        queueCount > 0
            ? `M+ Tracker — ${queueCount} run(s) synced`
            : "M+ Tracker — ready";
    tray.setToolTip(tooltip);

    // Windows doesn't support tray badges the way macOS does, but the
    // tooltip + title refresh gives users a hover-to-check signal.
    if (process.platform === "darwin" && app.dock) {
        app.dock.setBadge(queueCount > 0 ? String(queueCount) : "");
    }
}

/**
 * Intercept the window's close button and hide to tray instead of quit.
 * First-time-close shows a native notification so users understand the
 * app is still running.
 */
export function wireCloseToTray(win: BrowserWindow): void {
    win.on("close", (event) => {
        if ((app as unknown as { isQuitting?: boolean }).isQuitting) return;
        event.preventDefault();
        win.hide();

        if (!hasShownCloseToTrayToast) {
            hasShownCloseToTrayToast = true;
            if (Notification.isSupported()) {
                new Notification({
                    title: "M+ Tracker is still running",
                    body: "The companion is listening for your runs from the system tray. Right-click the tray icon to quit.",
                    silent: true,
                }).show();
            }
        }
    });
}

export function destroyTray(): void {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}
