/**
 * WoW install auto-detection.
 *
 * Stage 1: find the WoW root directory (the folder containing _retail_).
 * Stage 2: scan for Battle.net account folders under the retail WTF path.
 *
 * Windows only for now. macOS/Linux support is a future sprint.
 *
 * The detection is best-effort — we never throw if the user has a weird
 * install. The wizard always offers a manual folder-picker fallback.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface WowDetectionResult {
  /** The WoW root directory (contains _retail_) or null if not found. */
  installPath: string | null;
  /** Where the answer came from — useful for UI feedback. */
  source: "registry" | "standard-path" | "none";
  /** Does the chosen root actually have _retail_? */
  hasRetail: boolean;
}

/**
 * Query a Windows registry key. Returns null if reg fails or the key
 * doesn't exist. Never throws.
 */
function readRegistryKey(keyPath: string, valueName: string): string | null {
  // Windows-only; on any other OS this just fails silently.
  if (process.platform !== "win32") return null;

  try {
    const result = spawnSync("reg", ["query", keyPath, "/v", valueName], {
      encoding: "utf-8",
      windowsHide: true,
    });
    if (result.status !== 0) return null;
    // Output format:
    //   HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Blizzard Entertainment\...
    //       InstallPath    REG_SZ    C:\Program Files (x86)\World of Warcraft
    const match = result.stdout.match(
      new RegExp(`${valueName}\\s+REG_SZ\\s+(.+)`, "i"),
    );
    if (!match) return null;
    return match[1]!.trim();
  } catch {
    return null;
  }
}

/**
 * Find the WoW root via registry. Battle.net writes the install path to
 * HKLM\SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft\InstallPath.
 * Returns the *parent* of _retail_ when possible.
 */
function detectFromRegistry(): string | null {
  const candidates = [
    "HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft",
    "HKLM\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft",
    "HKCU\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft",
  ];

  for (const key of candidates) {
    const path = readRegistryKey(key, "InstallPath");
    if (!path) continue;

    // Battle.net's InstallPath sometimes points at the retail folder
    // directly ("...\World of Warcraft\_retail_"), sometimes at the
    // root ("...\World of Warcraft"). Normalize to the root.
    let normalized = path.replace(/["']/g, "").trim();
    if (normalized.toLowerCase().endsWith("\\_retail_")) {
      normalized = normalized.slice(0, -"\\_retail_".length);
    }
    if (normalized.toLowerCase().endsWith("/_retail_")) {
      normalized = normalized.slice(0, -"/_retail_".length);
    }
    if (existsSync(normalized)) return normalized;
  }
  return null;
}

/**
 * Fallback: check common install paths used by the Battle.net launcher.
 */
function detectFromStandardPaths(): string | null {
  if (process.platform !== "win32") return null;

  const candidates = [
    "C:\\Program Files (x86)\\World of Warcraft",
    "C:\\Program Files\\World of Warcraft",
    "D:\\Program Files (x86)\\World of Warcraft",
    "D:\\World of Warcraft",
    "E:\\World of Warcraft",
  ];

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Validate that a WoW root candidate has a _retail_ subfolder. This is
 * the sanity check we run against user-picked paths AND auto-detected
 * paths before accepting them.
 */
export function hasRetailSubfolder(wowRoot: string): boolean {
  try {
    const retail = join(wowRoot, "_retail_");
    return existsSync(retail) && statSync(retail).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Top-level detection entry point. Tries registry → standard paths →
 * gives up and returns null. Wizard calls this on mount.
 */
export function detectWowInstall(): WowDetectionResult {
  const fromRegistry = detectFromRegistry();
  if (fromRegistry) {
    return {
      installPath: fromRegistry,
      source: "registry",
      hasRetail: hasRetailSubfolder(fromRegistry),
    };
  }

  const fromStd = detectFromStandardPaths();
  if (fromStd) {
    return {
      installPath: fromStd,
      source: "standard-path",
      hasRetail: hasRetailSubfolder(fromStd),
    };
  }

  return { installPath: null, source: "none", hasRetail: false };
}

// ─── Account folder scanning ──────────────────────────────────────────

export interface WowAccount {
  /** Folder name, e.g. "MESTOPGOBOOM" */
  name: string;
  /** Absolute path to the account folder */
  path: string;
  /** Does the account already have a SavedVariables subfolder? */
  hasSavedVariables: boolean;
  /** Does it already have our specific addon's SV file? */
  hasMKeyTrackerFile: boolean;
}

/**
 * List the Battle.net account folders found under
 * `<wowRoot>\_retail_\WTF\Account\`. Returns an empty array if the
 * folder doesn't exist (e.g. player hasn't launched WoW yet).
 */
export function scanWowAccounts(wowRoot: string): WowAccount[] {
  const accountsDir = join(wowRoot, "_retail_", "WTF", "Account");
  if (!existsSync(accountsDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(accountsDir);
  } catch {
    return [];
  }

  const accounts: WowAccount[] = [];
  for (const name of entries) {
    const path = join(accountsDir, name);
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    // Skip the "SavedVariables" folder itself if it happens to appear
    // at this level (sometimes on unusual installs) and Blizzard's
    // shared folders like "SavedVariables.bak".
    if (name.toLowerCase().startsWith("savedvariables")) continue;

    const svDir = join(path, "SavedVariables");
    const svFile = join(svDir, "MKeyTracker.lua");
    accounts.push({
      name,
      path,
      hasSavedVariables: existsSync(svDir),
      hasMKeyTrackerFile: existsSync(svFile),
    });
  }

  return accounts;
}
