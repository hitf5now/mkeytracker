/**
 * Companion app persistent configuration.
 *
 * Stored as JSON in the user's platform-specific app data directory:
 *   Windows: %APPDATA%/mplus-companion/config.json
 *   macOS:   ~/Library/Application Support/mplus-companion/config.json
 *   Linux:   ~/.config/mplus-companion/config.json
 *
 * Contains:
 *   - jwt:              long-lived API token from the pairing flow
 *   - jwtExpiresAt:     ISO timestamp (for warning before expiry)
 *   - apiBaseUrl:       e.g. "http://localhost:3001" or "https://api.hitf5now.com"
 *   - savedVariablesPath: absolute path to MKeyTracker.lua
 *   - postedRunHashes:  stable hashes of runs we've successfully POSTed,
 *                       used to avoid re-submitting on /reload
 *   - lastSubmittedAt:  ISO timestamp of most recent successful POST
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  jwt: z.string().nullable().default(null),
  jwtExpiresAt: z.string().nullable().default(null),
  apiBaseUrl: z.string().url().default("http://localhost:3001"),

  /**
   * Root of the WoW install — the folder CONTAINING _retail_ / _classic_.
   * Set by the Electron wizard after auto-detect or user picker.
   * Example on Windows: C:\Program Files (x86)\World of Warcraft
   */
  wowInstallPath: z.string().nullable().default(null),

  /**
   * Battle.net account folder name — the subfolder of
   * <wowInstallPath>\_retail_\WTF\Account\ that owns this player's
   * SavedVariables. Different from the Windows user and from the
   * character name. Detected by scanning; user-overridable.
   */
  wowAccountName: z.string().nullable().default(null),

  /**
   * Resolved path to the MKeyTracker SavedVariables file. Computed from
   * wowInstallPath + wowAccountName. Stored so legacy CLI flows work
   * without needing to re-derive.
   */
  savedVariablesPath: z.string().nullable().default(null),

  postedRunHashes: z.array(z.string()).default([]),
  lastSubmittedAt: z.string().nullable().default(null),

  /** Have we completed the first-run wizard? */
  onboarded: z.boolean().default(false),

  /** Anonymous install UUID used for telemetry batching. */
  telemetryInstallId: z.string().nullable().default(null),

  /** User-controlled telemetry opt-out. Default false (opted-in). */
  telemetryOptOut: z.boolean().default(false),
});

export type CompanionConfig = z.infer<typeof ConfigSchema>;

// ─── Path resolution ──────────────────────────────────────────────────────
function resolveConfigDir(): string {
  const home = homedir();
  switch (platform()) {
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "mplus-companion");
    case "darwin":
      return join(home, "Library", "Application Support", "mplus-companion");
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "mplus-companion");
  }
}

export function configPath(): string {
  return join(resolveConfigDir(), "config.json");
}

// ─── Load / save ──────────────────────────────────────────────────────────

/**
 * Load the config. If no file exists, returns defaults. If the file is
 * corrupt or schema-invalid, throws so the caller can decide whether to
 * recover.
 */
export function loadConfig(): CompanionConfig {
  const path = configPath();
  if (!existsSync(path)) {
    return ConfigSchema.parse({});
  }
  const raw = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Companion config at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Companion config at ${path} failed schema validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return result.data;
}

export function saveConfig(cfg: CompanionConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), "utf-8");
}

/**
 * Partial update helper — read, merge, write atomically enough for our
 * single-writer use case.
 */
export function updateConfig(patch: Partial<CompanionConfig>): CompanionConfig {
  const current = loadConfig();
  const next = { ...current, ...patch };
  saveConfig(next);
  return next;
}

/**
 * Derive the SavedVariables file path from wowInstallPath + wowAccountName.
 * Returns null if either field is missing. Caller should also update the
 * config.savedVariablesPath field for cached reads.
 */
export function deriveSavedVariablesPath(
  wowInstallPath: string | null,
  wowAccountName: string | null,
): string | null {
  if (!wowInstallPath || !wowAccountName) return null;
  return join(
    wowInstallPath,
    "_retail_",
    "WTF",
    "Account",
    wowAccountName,
    "SavedVariables",
    "MKeyTracker.lua",
  );
}

export function addPostedHash(hash: string): void {
  const cfg = loadConfig();
  if (cfg.postedRunHashes.includes(hash)) return;
  cfg.postedRunHashes.push(hash);
  // Cap at 500 entries — more than enough for dedup, keeps file small.
  if (cfg.postedRunHashes.length > 500) {
    cfg.postedRunHashes = cfg.postedRunHashes.slice(-500);
  }
  cfg.lastSubmittedAt = new Date().toISOString();
  saveConfig(cfg);
}
