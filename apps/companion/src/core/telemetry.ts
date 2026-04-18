/**
 * Anonymous telemetry client.
 *
 * Per user choice (Option C from the sprint planning), the companion
 * sends anonymous usage events + error reports to the backend so we can
 * diagnose issues and understand how the app is actually used.
 *
 * What's sent:
 *   - An install UUID generated on first run (stored in config)
 *   - The app version + OS/platform
 *   - Event name (e.g. "app_started", "run_captured", "pair_success", "error")
 *   - Event metadata (safely primitives only — no file paths, no PII)
 *
 * What's NEVER sent:
 *   - Character names / realms
 *   - Discord IDs
 *   - JWTs or pairing codes
 *   - Absolute file paths
 *   - Anything that could identify a specific WoW player
 *
 * Events are batched in-memory and flushed on a 30-second timer or when
 * the batch hits 20 items. Failures are swallowed — telemetry must
 * never break the app.
 *
 * An opt-out setting lives at `config.telemetryOptOut`. When set, this
 * module drops every event on the floor.
 */

import { randomUUID } from "node:crypto";
import { platform, release } from "node:os";
import { loadConfig, updateConfig } from "./config.js";

const FLUSH_INTERVAL_MS = 30_000;
const MAX_BATCH_SIZE = 20;
const APP_VERSION = "0.1.6";

export type TelemetryEventName =
    | "app_started"
    | "wizard_completed"
    | "pair_success"
    | "pair_failure"
    | "addon_installed"
    | "run_captured"
    | "run_submitted"
    | "run_dedup_hit"
    | "run_error"
    | "run_enriched"
    | "run_enrich_unavailable"
    | "watcher_started"
    | "watcher_error"
    | "error";

export interface TelemetryEvent {
    /** Install UUID — stable per companion install, anonymous */
    installId: string;
    /** Event name from the enum above */
    name: TelemetryEventName;
    /** ISO timestamp */
    at: string;
    /** App version */
    version: string;
    /** OS platform + release */
    platform: string;
    /** Arbitrary metadata — caller responsibility to keep PII-free */
    meta?: Record<string, string | number | boolean>;
}

let buffer: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let installId: string | null = null;

// ─── Install ID ────────────────────────────────────────────────────
function ensureInstallId(): string {
    if (installId) return installId;
    const cfg = loadConfig();
    if (cfg.telemetryInstallId) {
        installId = cfg.telemetryInstallId;
        return installId;
    }
    const newId = randomUUID();
    updateConfig({ telemetryInstallId: newId });
    installId = newId;
    return newId;
}

// ─── Event capture ─────────────────────────────────────────────────
export function recordEvent(
    name: TelemetryEventName,
    meta?: Record<string, string | number | boolean>,
): void {
    try {
        const cfg = loadConfig();
        if (cfg.telemetryOptOut) return;

        buffer.push({
            installId: ensureInstallId(),
            name,
            at: new Date().toISOString(),
            version: APP_VERSION,
            platform: `${platform()} ${release()}`,
            meta,
        });

        if (buffer.length >= MAX_BATCH_SIZE) {
            void flush();
        }
    } catch {
        // Never let telemetry break the app
    }
}

// ─── Flush ────────────────────────────────────────────────────────
async function flush(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    const cfg = loadConfig();
    try {
        await fetch(`${cfg.apiBaseUrl}/api/v1/telemetry`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events: batch }),
        });
    } catch {
        // Drop the batch on failure — we don't retry. Telemetry is
        // best-effort by design.
    }
}

// ─── Lifecycle ────────────────────────────────────────────────────
export function startTelemetry(): void {
    if (flushTimer) return;
    flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
}

export function stopTelemetry(): void {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
    void flush();
}
