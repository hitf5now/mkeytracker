/**
 * Simple file logger for the companion app.
 *
 * Electron packaged apps on Windows have no visible stdout — any
 * console.log from the main process disappears. Writing to a file in
 * the user's AppData directory gives us (and the user) something
 * concrete to look at when diagnosing enrichment/submission issues.
 *
 * Format: one line per entry, `[ISO timestamp] [LEVEL] message`.
 * Size cap: we rotate once the file crosses ~1MB by truncating to the
 * last ~500KB. Good enough for debugging without unbounded growth.
 *
 * Callers pass a matching `LoggerLike` shape (log/warn/error), so any
 * file that previously accepted `console` can now accept the file
 * logger without changes.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MAX_BYTES = 1_000_000; // 1 MB before rotation
const KEEP_BYTES = 500_000; // Retain most recent ~500 KB on rotate

let logFilePath: string | null = null;

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function rotateIfNeeded(path: string): void {
  try {
    const st = statSync(path);
    if (st.size <= MAX_BYTES) return;
    const buf = readFileSync(path);
    const keep = buf.subarray(Math.max(0, buf.length - KEEP_BYTES));
    writeFileSync(path, keep);
    appendFileSync(
      path,
      `[${new Date().toISOString()}] [INFO] --- log rotated (kept last ${keep.length} bytes) ---\n`,
    );
  } catch {
    // rotation is best-effort; keep logging
  }
}

function writeLine(level: "INFO" | "WARN" | "ERROR", parts: unknown[]): void {
  const message = parts
    .map((p) => {
      if (typeof p === "string") return p;
      if (p instanceof Error) return `${p.name}: ${p.message}\n${p.stack ?? ""}`;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(" ");
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;

  // Always mirror to console for dev — Electron packaged apps drop these
  // but that's fine; we only need them visible in `tsx` dev.
  const consoleFn = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  consoleFn(line.trim());

  if (!logFilePath) return;
  try {
    rotateIfNeeded(logFilePath);
    appendFileSync(logFilePath, line);
  } catch {
    // don't let logging itself crash callers
  }
}

/**
 * Initialize the file logger. Safe to call multiple times — only the
 * first call sets the path. Returns the resolved log file path so the
 * caller can expose it in a settings page or log banner.
 */
export function initFileLogger(logDir: string): string {
  if (logFilePath) return logFilePath;
  const path = join(logDir, "companion.log");
  ensureDir(path);
  logFilePath = path;
  writeLine("INFO", [`log opened at ${path}`]);
  return path;
}

/** Returns the current log file path, or null if not yet initialized. */
export function getLogFilePath(): string | null {
  return logFilePath;
}

/**
 * LoggerLike shape compatible with `console` and the signatures passed
 * through RunQueue / enrichRun.
 */
export const fileLogger = {
  log: (...args: unknown[]) => writeLine("INFO", args),
  warn: (...args: unknown[]) => writeLine("WARN", args),
  error: (...args: unknown[]) => writeLine("ERROR", args),
};
