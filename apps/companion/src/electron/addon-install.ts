/**
 * MKeyTracker addon installer.
 *
 * Copies the bundled addon files from the Electron app's resources
 * directory to the user's `<wowRoot>\_retail_\Interface\AddOns\MKeyTracker\`.
 *
 * Sources the addon from two possible locations:
 *   - Packaged app: process.resourcesPath (set via electron-builder extraResources)
 *   - Dev mode:     ../../../addon/MKeyTracker relative to the compiled main.js
 *
 * The "dev mode" path works because our copy-static.mjs script copies
 * the addon into dist/addon/MKeyTracker at build time.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AddonInstallResult {
  success: boolean;
  targetPath: string;
  filesCopied: number;
  error?: string;
}

/**
 * Resolve where the addon bundle lives at runtime.
 *
 * Order:
 *   1. Electron `process.resourcesPath` (production — set by electron-builder)
 *   2. `dist/addon/MKeyTracker` next to the compiled main.js (dev/build)
 *   3. `../../../addon/MKeyTracker` relative to source (fallback for tsx dev)
 */
export function resolveBundledAddonPath(): string | null {
  const candidates: string[] = [];

  // 1. Packaged Electron app — resourcesPath is typically
  //    <app>/resources, and we'll extraResources the addon folder.
  const resourcesPath =
    process.resourcesPath && typeof process.resourcesPath === "string"
      ? process.resourcesPath
      : null;
  if (resourcesPath) {
    candidates.push(join(resourcesPath, "addon", "MKeyTracker"));
  }

  // 2. Built dev layout — dist/electron/*.js, addon at dist/addon/MKeyTracker
  candidates.push(join(__dirname, "..", "addon", "MKeyTracker"));

  // 3. Repo-root source layout for tsx-based dev without a build step
  candidates.push(join(__dirname, "..", "..", "..", "..", "addon", "MKeyTracker"));

  for (const path of candidates) {
    if (existsSync(join(path, "MKeyTracker.toc"))) {
      return path;
    }
  }
  return null;
}

/**
 * Install the MKeyTracker addon to the given WoW root. Creates the
 * target directory if needed and copies every file from the bundle.
 *
 * @param wowInstallPath The WoW root directory (contains _retail_)
 * @returns An AddonInstallResult describing success/failure + file count
 */
export function installAddon(wowInstallPath: string): AddonInstallResult {
  const sourcePath = resolveBundledAddonPath();
  if (!sourcePath) {
    return {
      success: false,
      targetPath: "",
      filesCopied: 0,
      error: "Could not find the bundled MKeyTracker addon. The companion app may be mis-packaged.",
    };
  }

  const targetPath = join(
    wowInstallPath,
    "_retail_",
    "Interface",
    "AddOns",
    "MKeyTracker",
  );

  try {
    mkdirSync(targetPath, { recursive: true });

    // Copy every file (overwrites existing — we want updates to replace).
    cpSync(sourcePath, targetPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });

    // Count files in the target for confirmation
    const filesCopied = countFilesRecursive(targetPath);

    // Sanity: the TOC file must exist after copy
    if (!existsSync(join(targetPath, "MKeyTracker.toc"))) {
      return {
        success: false,
        targetPath,
        filesCopied,
        error: "Copied files but MKeyTracker.toc is missing from the target. Something went wrong mid-copy.",
      };
    }

    return { success: true, targetPath, filesCopied };
  } catch (err) {
    return {
      success: false,
      targetPath,
      filesCopied: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function countFilesRecursive(dir: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        count += countFilesRecursive(join(dir, entry.name));
      } else if (entry.isFile()) {
        count++;
      }
    }
  } catch {
    /* ignore */
  }
  return count;
}
