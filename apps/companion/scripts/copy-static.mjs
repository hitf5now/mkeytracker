#!/usr/bin/env node
/**
 * Post-build script for the companion app.
 *
 * `tsc` only compiles TypeScript files. We have HTML, CSS, and the
 * bundled MKeyTracker addon folder that need to live NEXT TO the
 * compiled JS in dist/ so main.ts's `__dirname/../renderer` and
 * `__dirname/../addon` paths resolve correctly at runtime.
 *
 * The compiled main.js lands at `dist/apps/companion/src/electron/main.js`
 * because tsconfig paths pull in workspace packages (@mplus/*), which
 * lifts tsc's rootDir to the monorepo root. So we copy the static trees
 * alongside that, into `dist/apps/companion/src/`.
 *
 * Inputs:
 *   src/renderer/  *.html, *.css, *.js  →  dist/apps/companion/src/renderer/
 *   ../../addon/MKeyTracker/*             →  dist/apps/companion/src/addon/MKeyTracker/
 *
 * We ALSO emit `dist/renderer/` and `dist/addon/` as a fallback, so
 * electron-builder's "files" glob still finds them if any tool hunts
 * at the top-level dist root. Doubles the footprint of the static
 * trees (tiny) and buys us resilience against future build layout shifts.
 *
 * Usage: node scripts/copy-static.mjs
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const companionRoot = resolve(__dirname, "..");
const repoRoot = resolve(companionRoot, "../..");

function copy(src, dest, label) {
  if (!existsSync(src)) {
    console.warn(`[copy-static] skip ${label}: ${src} does not exist`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
  console.log(`[copy-static] copied ${label} → ${dest}`);
}

const rendererSrc = resolve(companionRoot, "src/renderer");
const addonSrc = resolve(repoRoot, "addon/MKeyTracker");

// Primary: sit next to the compiled main.js (new tsc layout)
copy(
  rendererSrc,
  resolve(companionRoot, "dist/apps/companion/src/renderer"),
  "renderer (next to main.js)",
);
copy(
  addonSrc,
  resolve(companionRoot, "dist/apps/companion/src/addon/MKeyTracker"),
  "addon (next to main.js)",
);

// Fallback: top-level, in case anything references the old layout
copy(rendererSrc, resolve(companionRoot, "dist/renderer"), "renderer (fallback)");
copy(addonSrc, resolve(companionRoot, "dist/addon/MKeyTracker"), "addon (fallback)");

console.log("[copy-static] done");
