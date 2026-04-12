/**
 * Wizard page controller.
 *
 * Plain ES module — no bundling, no TypeScript (the renderer loads the
 * file directly). All privileged operations go through window.mplus
 * which is injected by the preload script.
 *
 * State machine:
 *   welcome → wow → account → pair → done
 * Back buttons return to the previous step. Progress pips at the top
 * reflect the current step.
 */

const STEPS = ["welcome", "wow", "account", "pair", "done"];
let currentStep = "welcome";
let wowPath = null;
let wowAccountName = null;

// ─── Step navigation ─────────────────────────────────────────────
function showStep(step) {
    currentStep = step;
    document.querySelectorAll(".screen").forEach((el) => {
        el.classList.toggle("hidden", el.dataset.screen !== step);
    });
    const stepIdx = STEPS.indexOf(step);
    document.querySelectorAll(".step-pip").forEach((pip, i) => {
        pip.classList.toggle("done", i < stepIdx);
        pip.classList.toggle("current", i === stepIdx);
    });
}

// Back buttons
document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showStep(btn.dataset.back));
});

// ─── Screen 1: Welcome ───────────────────────────────────────────
document.getElementById("welcome-next").addEventListener("click", async () => {
    showStep("wow");
    await detectWow();
});

// ─── Screen 2: WoW location ──────────────────────────────────────
async function detectWow() {
    const statusEl = document.getElementById("wow-detect-status");
    const pathEl = document.getElementById("wow-detect-path");

    statusEl.innerHTML =
        '<span class="loading"></span><span>Searching for WoW install…</span>';
    pathEl.classList.add("hidden");

    const result = await window.mplus.wowDetect();
    renderWowResult(result);
}

function renderWowResult(result) {
    const statusEl = document.getElementById("wow-detect-status");
    const pathEl = document.getElementById("wow-detect-path");
    const installBtn = document.getElementById("addon-install");
    const nextBtn = document.getElementById("wow-next");
    const addonStatus = document.getElementById("addon-status");

    // Hide previous addon-install state whenever WoW path changes
    addonStatus.classList.add("hidden");
    nextBtn.disabled = true;
    installBtn.disabled = true;

    if (!result.installPath) {
        statusEl.innerHTML =
            '<span class="text-error">✗</span><span>No WoW install detected. Use <b>Browse…</b> to find it.</span>';
        pathEl.classList.add("hidden");
        wowPath = null;
        return;
    }

    if (!result.hasRetail) {
        statusEl.innerHTML =
            '<span class="text-error">✗</span><span>Found a folder but no <span class="text-mono">_retail_</span> subdirectory. This doesn\'t look like a WoW Retail install.</span>';
        pathEl.classList.remove("hidden");
        pathEl.textContent = result.installPath;
        wowPath = null;
        return;
    }

    const sourceLabel = {
        registry: "from Windows registry",
        "standard-path": "at default install location",
        manual: "you selected this folder",
    }[result.source] || "detected";

    statusEl.innerHTML = `<span class="text-success">✓</span><span>Found WoW — <span class="text-muted">${sourceLabel}</span></span>`;
    pathEl.classList.remove("hidden");
    pathEl.textContent = result.installPath;

    wowPath = result.installPath;
    installBtn.disabled = false;
}

document.getElementById("wow-browse").addEventListener("click", async () => {
    const result = await window.mplus.wowChooseFolder();
    if (result) renderWowResult(result);
});

document.getElementById("addon-install").addEventListener("click", async () => {
    if (!wowPath) return;
    const btn = document.getElementById("addon-install");
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Installing…';

    const result = await window.mplus.addonInstall(wowPath);

    const addonStatus = document.getElementById("addon-status");
    const pathEl = document.getElementById("addon-status-path");
    const filesEl = document.getElementById("addon-status-files");

    if (result.success) {
        addonStatus.classList.remove("hidden");
        pathEl.textContent = result.targetPath;
        filesEl.textContent = `${result.filesCopied} file(s) copied`;
        btn.innerHTML = "Re-install addon";
        btn.disabled = false;
        document.getElementById("wow-next").disabled = false;
    } else {
        addonStatus.classList.remove("hidden");
        addonStatus.innerHTML = `
            <div class="card error">
                <div class="card-title text-error">Install failed</div>
                <div class="card-subtitle">${escapeHtml(result.error || "Unknown error")}</div>
            </div>`;
        btn.innerHTML = "Retry install";
        btn.disabled = false;
    }
});

document.getElementById("wow-next").addEventListener("click", async () => {
    showStep("account");
    await scanAccounts();
});

// ─── Screen 3: Account picker ────────────────────────────────────
async function scanAccounts() {
    const loadingEl = document.getElementById("account-loading");
    const emptyEl = document.getElementById("account-empty");
    const listEl = document.getElementById("account-list");

    loadingEl.classList.remove("hidden");
    emptyEl.classList.add("hidden");
    listEl.classList.add("hidden");
    listEl.innerHTML = "";

    const accounts = await window.mplus.wowScanAccounts(wowPath);
    loadingEl.classList.add("hidden");

    if (accounts.length === 0) {
        emptyEl.classList.remove("hidden");
        return;
    }

    listEl.classList.remove("hidden");
    accounts.forEach((acc, i) => {
        const el = document.createElement("label");
        el.className = "choice";
        el.innerHTML = `
            <span class="choice-dot"></span>
            <div class="choice-body">
                <div class="choice-title">${escapeHtml(acc.name)}</div>
                <div class="choice-meta">
                    ${acc.hasSavedVariables ? '<span class="badge success"><span class="badge-dot"></span>SavedVariables</span>' : '<span class="badge warning"><span class="badge-dot"></span>No SavedVariables yet</span>'}
                    ${acc.hasMKeyTrackerFile ? '<span class="badge success"><span class="badge-dot"></span>MKeyTracker data found</span>' : ""}
                </div>
            </div>
            <input type="radio" name="account" value="${escapeAttr(acc.name)}" hidden />
        `;
        el.addEventListener("click", () => {
            document
                .querySelectorAll("#account-list .choice")
                .forEach((c) => c.classList.remove("selected"));
            el.classList.add("selected");
            wowAccountName = acc.name;
            document.getElementById("account-next").disabled = false;
        });
        // Auto-select if only one option
        if (accounts.length === 1 && i === 0) {
            setTimeout(() => el.click(), 0);
        }
        listEl.appendChild(el);
    });
}

document.getElementById("account-retry").addEventListener("click", scanAccounts);

document.getElementById("account-next").addEventListener("click", async () => {
    await window.mplus.configSetWow({ wowInstallPath: wowPath, wowAccountName });
    showStep("pair");
});

// ─── Screen 4: Pair ──────────────────────────────────────────────
const pairInput = document.getElementById("pair-code");
const pairBtn = document.getElementById("pair-submit");
const pairResult = document.getElementById("pair-result");

pairInput.addEventListener("input", () => {
    pairInput.value = pairInput.value.replace(/\D/g, "").slice(0, 6);
    pairBtn.disabled = pairInput.value.length !== 6;
});

pairInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !pairBtn.disabled) pairBtn.click();
});

pairBtn.addEventListener("click", async () => {
    const code = pairInput.value;
    pairBtn.disabled = true;
    pairBtn.innerHTML = '<span class="loading"></span> Pairing…';
    pairResult.classList.add("hidden");

    const result = await window.mplus.authPair({ code });

    pairBtn.innerHTML = "Pair with Discord";

    if (result.success) {
        pairResult.innerHTML = `
            <div class="card success">
                <div class="card-title text-success">✓ Paired successfully</div>
                <div class="card-subtitle">
                    Your companion is now linked. Token expires ${formatDate(result.expiresAt)}.
                </div>
            </div>`;
        pairResult.classList.remove("hidden");
        setTimeout(() => showStep("done"), 900);
    } else {
        pairResult.innerHTML = `
            <div class="card error">
                <div class="card-title text-error">✗ Pairing failed</div>
                <div class="card-subtitle">${escapeHtml(result.error || "Unknown error")}</div>
            </div>`;
        pairResult.classList.remove("hidden");
        pairBtn.disabled = false;
    }
});

// ─── Screen 5: Done ──────────────────────────────────────────────
document.getElementById("done-finish").addEventListener("click", async () => {
    // TODO: handle launch-on-startup checkbox
    await window.mplus.configCompleteOnboarding();
});

// ─── Utilities ───────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function escapeAttr(str) {
    return escapeHtml(str);
}

function formatDate(iso) {
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    } catch {
        return iso;
    }
}
