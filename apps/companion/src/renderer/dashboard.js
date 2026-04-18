/**
 * Dashboard page controller.
 *
 * Polls window.mplus.statusGet() on mount and every 3 seconds, plus
 * listens for push events from the main process when the queue updates.
 */

const POLL_INTERVAL_MS = 3000;
let pollTimer = null;

async function refresh() {
    try {
        const [cfg, status] = await Promise.all([
            window.mplus.configGet(),
            window.mplus.statusGet(),
        ]);
        renderStatus(cfg, status);
    } catch (err) {
        console.error("dashboard refresh failed", err);
    }
}

async function renderAppInfo() {
    try {
        const info = await window.mplus.appInfo();
        const subEl = document.getElementById("brand-sub");
        if (subEl) {
            const mode = info.packaged ? "" : " (dev)";
            subEl.textContent = `v${info.version}${mode}`;
            subEl.title = `Electron ${info.electronVersion} • Node ${info.nodeVersion} • ${info.platform}`;
        }
        // Tab title too, so alt-tab distinguishes versions
        document.title = `M+ Tracker v${info.version}`;
    } catch (err) {
        console.error("app info fetch failed", err);
    }
}

function renderStatus(cfg, status) {
    // Pairing
    const pairingEl = document.getElementById("stat-pairing");
    const pairingDetailEl = document.getElementById("stat-pairing-detail");
    if (status.paired) {
        pairingEl.innerHTML =
            '<span class="badge success"><span class="badge-dot"></span>Paired</span>';
        if (cfg.jwtExpiresAt) {
            const exp = new Date(cfg.jwtExpiresAt);
            const days = Math.round((exp - Date.now()) / (1000 * 60 * 60 * 24));
            pairingDetailEl.textContent =
                days > 0 ? `Token expires in ${days} day${days === 1 ? "" : "s"}` : "Token expired — re-pair via /link";
        }
    } else {
        pairingEl.innerHTML =
            '<span class="badge error"><span class="badge-dot"></span>Not paired</span>';
        pairingDetailEl.textContent = "Run setup wizard to pair";
    }

    // Watcher
    const watcherEl = document.getElementById("stat-watcher");
    const watcherDetailEl = document.getElementById("stat-watcher-detail");
    if (status.watcherRunning) {
        watcherEl.innerHTML =
            '<span class="badge success"><span class="badge-dot"></span>Running</span>';
        watcherDetailEl.textContent = "Listening for SavedVariables changes";
    } else {
        watcherEl.innerHTML =
            '<span class="badge warning"><span class="badge-dot"></span>Idle</span>';
        watcherDetailEl.textContent = status.savedVariablesPath
            ? "Watcher not started"
            : "No SavedVariables path configured";
    }

    // Runs synced
    document.getElementById("stat-synced").textContent = cfg.postedRunHashesCount ?? 0;
    document.getElementById("stat-synced-detail").textContent = cfg.lastSubmittedAt
        ? `Latest: ${formatRelative(cfg.lastSubmittedAt)}`
        : "No runs posted yet";

    // Last sync
    const lastEl = document.getElementById("stat-last");
    const lastDetailEl = document.getElementById("stat-last-detail");
    if (status.lastSyncAt) {
        lastEl.textContent = formatRelative(status.lastSyncAt);
        lastDetailEl.textContent = new Date(status.lastSyncAt).toLocaleString();
    } else if (cfg.lastSubmittedAt) {
        lastEl.textContent = formatRelative(cfg.lastSubmittedAt);
        lastDetailEl.textContent = new Date(cfg.lastSubmittedAt).toLocaleString();
    } else {
        lastEl.textContent = "Never";
        lastDetailEl.textContent = "—";
    }

    // SavedVariables card
    const svPathEl = document.getElementById("sv-path");
    const svStatusEl = document.getElementById("sv-status");
    if (status.savedVariablesPath) {
        svPathEl.textContent = status.savedVariablesPath;
        svStatusEl.innerHTML = status.savedVariablesExists
            ? '<span class="badge success"><span class="badge-dot"></span>Present</span>'
            : '<span class="badge warning"><span class="badge-dot"></span>Not yet — launch WoW once</span>';
    } else {
        svPathEl.textContent = "Not configured";
        svStatusEl.innerHTML =
            '<span class="badge error"><span class="badge-dot"></span>Missing</span>';
    }
}

// ─── Actions ─────────────────────────────────────────────────────
document.getElementById("resync-btn").addEventListener("click", async () => {
    const btn = document.getElementById("resync-btn");
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Syncing…';
    const result = await window.mplus.statusResync();
    btn.innerHTML = "↻ Re-sync";
    btn.disabled = false;
    await refresh();
    // Temporary feedback — could be replaced with a toast later
    const detail = document.getElementById("stat-last-detail");
    detail.textContent = `Just synced — ${result.submitted} new, ${result.deduplicated} dedup, ${result.errors} errors`;
});

document.getElementById("open-wizard").addEventListener("click", async () => {
    await window.mplus.resetOnboarding();
});

// ─── Quick links ─────────────────────────────────────────────────
const WEBSITE_BASE = "https://mythicplustracker.com";

document.getElementById("link-website")?.addEventListener("click", () => {
    void window.mplus.openExternal(WEBSITE_BASE);
});
document.getElementById("link-leaderboards")?.addEventListener("click", () => {
    void window.mplus.openExternal(`${WEBSITE_BASE}/leaderboards`);
});
document.getElementById("link-profile")?.addEventListener("click", () => {
    void window.mplus.openExternal(`${WEBSITE_BASE}/profile`);
});
document.getElementById("link-discord")?.addEventListener("click", () => {
    // Opens the Discord invite or server — update this URL when you have a permanent invite link
    void window.mplus.openExternal("https://discord.gg/your-invite-here");
});

// ─── Auto-launch ────────────────────────────────────────────────
const autoLaunchCheck = document.getElementById("auto-launch-check");
async function loadAutoLaunchState() {
    const result = await window.mplus.getAutoLaunch();
    if (autoLaunchCheck) autoLaunchCheck.checked = result.enabled;
}
autoLaunchCheck?.addEventListener("change", async () => {
    await window.mplus.setAutoLaunch(autoLaunchCheck.checked);
});
void loadAutoLaunchState();

// ─── Combat-log diagnostics ─────────────────────────────────────
function formatDiagnose(result) {
    const lines = [];
    lines.push(`Companion log: ${result.logFilePath ?? "(not initialized)"}`);
    lines.push(`WoW Logs dir: ${result.logsDir ?? "(not configured)"} ${result.logsDir ? (result.logsDirExists ? "[exists]" : "[missing]") : ""}`);
    lines.push("");
    lines.push(`Combat log files (${result.combatLogFiles.length} found):`);
    if (result.combatLogFiles.length === 0) {
        lines.push("  (none — enable /combatlog in-game)");
    } else {
        for (const f of result.combatLogFiles.slice(0, 8)) {
            const sizeMB = (f.size / 1024 / 1024).toFixed(2);
            lines.push(`  ${f.name}  ${sizeMB} MB  (${f.mtime})`);
        }
        if (result.combatLogFiles.length > 8) {
            lines.push(`  ... ${result.combatLogFiles.length - 8} more`);
        }
    }
    lines.push("");
    lines.push(`Picked for enrichment: ${result.pickedFile ?? "(none)"}`);
    lines.push("");
    lines.push(`Segments parsed (${result.segments.length}):`);
    if (result.segments.length === 0) {
        lines.push("  (no CHALLENGE_MODE segments in picked file)");
    } else {
        for (const s of result.segments) {
            const dmgM = (s.totalDamage / 1_000_000).toFixed(1);
            lines.push(`  #${s.index}  cmId=${s.challengeModeId}  ${s.zoneName} +${s.keystoneLevel}  ${s.playerCount}p/${s.encounterCount}b  ${dmgM}M dmg  end ${s.endedAt}`);
        }
    }
    lines.push("");
    lines.push(`→ ${result.message}`);
    return lines.join("\n");
}

document.getElementById("diagnose-enrichment-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("diagnose-enrichment-btn");
    const out = document.getElementById("diagnose-output");
    if (btn) { btn.disabled = true; btn.textContent = "Checking..."; }
    out.style.display = "block";
    out.textContent = "Scanning...";
    try {
        const result = await window.mplus.enrichmentDiagnose();
        out.textContent = formatDiagnose(result);
    } catch (err) {
        out.textContent = "Diagnose failed: " + (err && err.message ? err.message : String(err));
    }
    if (btn) { btn.disabled = false; btn.textContent = "Check Combat Log"; }
});

document.getElementById("open-log-btn")?.addEventListener("click", async () => {
    const res = await window.mplus.openLogFile();
    if (!res.ok) {
        const out = document.getElementById("diagnose-output");
        out.style.display = "block";
        out.textContent = "Couldn't open log: " + (res.reason || res.error || "unknown");
    }
});

// ─── Check for updates button ───────────────────────────────────
document.getElementById("check-updates-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("check-updates-btn");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Checking…";
    }
    await window.mplus.updateCheck();
    // Status line will update via the onUpdateState push event.
    // Re-enable the button after a short delay.
    setTimeout(() => {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "Check for updates";
        }
    }, 3000);
});

// ─── Update banner ────────────────────────────────────────────────
function renderUpdateState(state) {
    const banner = document.getElementById("update-banner");
    const versionEl = document.getElementById("update-version");
    const notesEl = document.getElementById("update-notes");
    const downloadBtn = document.getElementById("update-download");
    const dismissBtn = document.getElementById("update-dismiss");

    if (!state || state.status === "idle" || state.status === "up-to-date" || state.status === "checking") {
        banner.classList.add("hidden");
        return;
    }

    banner.classList.remove("hidden");

    if (state.status === "available") {
        versionEl.textContent = state.version || "new version";
        notesEl.textContent = state.notes || "Click Download to install the latest version.";
        downloadBtn.textContent = "Download";
        downloadBtn.disabled = false;
        downloadBtn.onclick = async () => {
            downloadBtn.disabled = true;
            downloadBtn.textContent = "Downloading…";
            await window.mplus.updateDownload();
        };
        dismissBtn.onclick = () => banner.classList.add("hidden");
    } else if (state.status === "downloading") {
        versionEl.textContent = state.version || "";
        const pct = typeof state.progress === "number" ? Math.floor(state.progress) : 0;
        notesEl.textContent = `Downloading update… ${pct}%`;
        downloadBtn.disabled = true;
        downloadBtn.textContent = `${pct}%`;
    } else if (state.status === "ready") {
        versionEl.textContent = state.version || "new version";
        notesEl.textContent = "Update ready — restart the app to install.";
        downloadBtn.textContent = "Restart now";
        downloadBtn.disabled = false;
        downloadBtn.onclick = async () => {
            await window.mplus.updateInstall();
        };
    } else if (state.status === "error") {
        versionEl.textContent = "Error";
        notesEl.textContent = state.error || "Update check failed.";
        downloadBtn.textContent = "Retry";
        downloadBtn.disabled = false;
        downloadBtn.onclick = () => window.location.reload();
    }
}

function renderUpdaterStatusLine(state) {
    const el = document.getElementById("updater-status-line");
    if (!el) return;
    const labels = {
        idle: "Updates: idle",
        checking: "Updates: checking…",
        "up-to-date": "Updates: up to date ✓",
        available: `Updates: v${state.version || "?"} available`,
        downloading: `Updates: downloading ${Math.floor(state.progress || 0)}%`,
        ready: `Updates: v${state.version || "?"} ready — restart to install`,
        error: `Updates: error — ${(state.error || "unknown").slice(0, 80)}`,
    };
    el.textContent = labels[state.status] || `Updates: ${state.status}`;
}

async function fetchUpdateState() {
    const state = await window.mplus.updateGet();
    renderUpdateState(state);
    renderUpdaterStatusLine(state);
}

window.mplus.onUpdateState((state) => {
    renderUpdateState(state);
    renderUpdaterStatusLine(state);
});
void fetchUpdateState();

// Listen for push events from main process
window.mplus.onQueueUpdate(() => {
    void refresh();
});

function formatRelative(iso) {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Lifecycle ───────────────────────────────────────────────────
void renderAppInfo();
void refresh();
pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS);

window.addEventListener("beforeunload", () => {
    if (pollTimer) clearInterval(pollTimer);
});
