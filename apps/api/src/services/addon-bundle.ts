/**
 * Serving the WoW addon straight from the API.
 *
 * The addon used to travel only inside the companion installer, so shipping
 * a one-line Lua fix meant building and publishing a 97 MB Electron package
 * and waiting for everyone to update. Serving it here decouples the two: an
 * addon change needs an API deploy, and every companion can pull it on
 * demand.
 *
 * It ships as JSON rather than a zip. The whole addon is eight Lua files and
 * a TOC — well under 100 KB — so an archive would add a dependency and a
 * binary streaming path to save nothing. Plain text also means the companion
 * can diff and verify what it is about to write.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Only these extensions are ever served — never walk arbitrary files out. */
const ALLOWED_EXTENSIONS = [".lua", ".toc", ".xml"];

export interface AddonFile {
  name: string;
  content: string;
}

export interface AddonBundle {
  version: string;
  /** TOC `## Interface` value, so the companion can warn on a mismatch. */
  interfaceVersion: string;
  files: AddonFile[];
  /** Newest mtime across the bundle, as an ISO string. */
  updatedAt: string;
}

export interface AddonBundleInfo {
  version: string;
  interfaceVersion: string;
  fileCount: number;
  totalBytes: number;
  updatedAt: string;
}

/**
 * Where the addon lives relative to the compiled API.
 *
 * The Docker image copies the whole repo to /app, so the addon sits beside
 * the API's own source. The local dev layout resolves the same way.
 */
function resolveAddonDir(): string | null {
  const candidates = [
    resolve(__dirname, "..", "..", "..", "..", "addon", "MKeyTracker"),
    resolve(process.cwd(), "..", "..", "addon", "MKeyTracker"),
    resolve("/app/addon/MKeyTracker"),
  ];
  for (const dir of candidates) {
    try {
      if (statSync(join(dir, "MKeyTracker.toc")).isFile()) return dir;
    } catch {
      // Not here — try the next candidate.
    }
  }
  return null;
}

function parseTocField(toc: string, field: string): string {
  const match = new RegExp(`^##\\s*${field}\\s*:\\s*(.+)$`, "mi").exec(toc);
  return match?.[1]?.trim() ?? "";
}

let cached: { bundle: AddonBundle; builtAt: number } | null = null;
/** The files only change on deploy, but a short TTL keeps dev iteration sane. */
const CACHE_TTL_MS = 60_000;

/**
 * Read the addon off disk. Returns null when the files aren't present,
 * which is a mis-packaged image rather than a user-facing error.
 */
export function getAddonBundle(): AddonBundle | null {
  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached.bundle;

  const dir = resolveAddonDir();
  if (!dir) return null;

  const files: AddonFile[] = [];
  let newest = 0;

  for (const name of readdirSync(dir).sort()) {
    // Guards against a stray file in the addon folder becoming a download,
    // and against `..` ever reaching the filesystem call below.
    if (name.includes("/") || name.includes("\\") || name.startsWith(".")) continue;
    if (!ALLOWED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) continue;

    const full = join(dir, name);
    const stat = statSync(full);
    if (!stat.isFile()) continue;

    files.push({ name, content: readFileSync(full, "utf-8") });
    newest = Math.max(newest, stat.mtimeMs);
  }

  const toc = files.find((f) => f.name.toLowerCase() === "mkeytracker.toc");
  if (!toc) return null;

  const bundle: AddonBundle = {
    version: parseTocField(toc.content, "Version"),
    interfaceVersion: parseTocField(toc.content, "Interface"),
    files,
    updatedAt: new Date(newest || Date.now()).toISOString(),
  };

  cached = { bundle, builtAt: Date.now() };
  return bundle;
}

/** Metadata only — what the companion polls to decide whether to update. */
export function getAddonBundleInfo(): AddonBundleInfo | null {
  const bundle = getAddonBundle();
  if (!bundle) return null;
  return {
    version: bundle.version,
    interfaceVersion: bundle.interfaceVersion,
    fileCount: bundle.files.length,
    totalBytes: bundle.files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0),
    updatedAt: bundle.updatedAt,
  };
}
