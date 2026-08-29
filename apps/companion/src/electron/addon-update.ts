/**
 * Updating the WoW addon from the API.
 *
 * The addon also ships inside the installer, but that couples a one-line Lua
 * fix to a 97 MB Electron release. This path lets the companion pull the
 * current addon on demand, so the game side can move at its own pace.
 *
 * Writes are all-or-nothing in the sense that matters: every file is
 * downloaded and validated before any of them is written. A half-updated
 * addon folder is the one outcome worth engineering against, because WoW
 * will happily load a mix of old and new Lua and fail in confusing ways.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Mirrors the API's bundle shape. */
interface RemoteAddonFile {
  name: string;
  content: string;
}

interface RemoteAddonBundle {
  version: string;
  interfaceVersion: string;
  files: RemoteAddonFile[];
  updatedAt: string;
}

export interface AddonVersionStatus {
  installed: string | null;
  available: string | null;
  interfaceVersion: string | null;
  updateAvailable: boolean;
  error?: string;
}

export interface AddonUpdateResult {
  success: boolean;
  version?: string;
  filesWritten?: number;
  error?: string;
}

const ADDON_FOLDER = "MKeyTracker";

export function addonTargetDir(wowInstallPath: string): string {
  return join(wowInstallPath, "_retail_", "Interface", "AddOns", ADDON_FOLDER);
}

function parseTocField(toc: string, field: string): string | null {
  const match = new RegExp(`^##\\s*${field}\\s*:\\s*(.+)$`, "mi").exec(toc);
  return match?.[1]?.trim() ?? null;
}

/** Version currently sitting in the WoW folder, or null if not installed. */
export function readInstalledAddonVersion(wowInstallPath: string): string | null {
  const toc = join(addonTargetDir(wowInstallPath), "MKeyTracker.toc");
  if (!existsSync(toc)) return null;
  try {
    return parseTocField(readFileSync(toc, "utf-8"), "Version");
  } catch {
    return null;
  }
}

/**
 * Compare two addon versions.
 *
 * Deliberately not semver-aware beyond numeric segments — addon versions are
 * plain `major.minor.patch`, and treating an unparseable version as "differs"
 * errs toward offering an update rather than hiding one.
 */
export function isNewerVersion(available: string, installed: string | null): boolean {
  if (!installed) return true;
  if (available === installed) return false;

  const parse = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10));
  const a = parse(available);
  const b = parse(installed);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return true;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

async function fetchBundle(apiBaseUrl: string): Promise<RemoteAddonBundle> {
  const res = await fetch(`${apiBaseUrl}/download/addon`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const bundle = (await res.json()) as RemoteAddonBundle;

  if (!bundle.version || !Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw new Error("malformed addon bundle");
  }
  // A bundle without its TOC would leave WoW unable to load the addon at all.
  if (!bundle.files.some((f) => f.name.toLowerCase() === "mkeytracker.toc")) {
    throw new Error("addon bundle is missing MKeyTracker.toc");
  }
  for (const file of bundle.files) {
    // The name lands in a path join, so refuse anything that could escape.
    if (!/^[A-Za-z0-9._-]+$/.test(file.name) || file.name.includes("..")) {
      throw new Error(`unsafe file name in bundle: ${file.name}`);
    }
    if (typeof file.content !== "string") {
      throw new Error(`missing content for ${file.name}`);
    }
  }
  return bundle;
}

/** What the dashboard shows next to the update button. */
export async function checkAddonVersion(
  apiBaseUrl: string,
  wowInstallPath: string | null,
): Promise<AddonVersionStatus> {
  const installed = wowInstallPath ? readInstalledAddonVersion(wowInstallPath) : null;
  try {
    const res = await fetch(`${apiBaseUrl}/download/addon/info`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const info = (await res.json()) as {
      version: string;
      interfaceVersion: string;
    };
    return {
      installed,
      available: info.version,
      interfaceVersion: info.interfaceVersion,
      updateAvailable: isNewerVersion(info.version, installed),
    };
  } catch (err) {
    return {
      installed,
      available: null,
      interfaceVersion: null,
      updateAvailable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Download the current addon and write it into the WoW folder.
 *
 * Safe to run while WoW is open — the addon's Lua is only read at load, so
 * the player picks it up on their next `/reload` or login. SavedVariables
 * are a different file and are not touched here.
 */
export async function updateAddonFromApi(
  apiBaseUrl: string,
  wowInstallPath: string,
): Promise<AddonUpdateResult> {
  let bundle: RemoteAddonBundle;
  try {
    bundle = await fetchBundle(apiBaseUrl);
  } catch (err) {
    return {
      success: false,
      error: `Couldn't download the addon: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const target = addonTargetDir(wowInstallPath);
  try {
    mkdirSync(target, { recursive: true });
    // Everything is already in memory and validated, so this loop can't
    // stop halfway for network reasons.
    for (const file of bundle.files) {
      writeFileSync(join(target, file.name), file.content, "utf-8");
    }
  } catch (err) {
    return {
      success: false,
      error: `Couldn't write to the AddOns folder: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { success: true, version: bundle.version, filesWritten: bundle.files.length };
}
