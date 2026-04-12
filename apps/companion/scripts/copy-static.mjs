#!/usr/bin/env node
/**
 * Post-build script for the companion app.
 *
 * `tsc` only compiles TypeScript files. We have HTML, CSS, and the
 * bundled MKeyTracker addon folder that need to live next to the
 * compiled JS in dist/ for Electron to find at runtime. This script
 * copies them over after every build.
 *
 * Inputs:
 *   src/renderer/  *.html, *.css, *.js  →  dist/renderer/
 *   ../../addon/MKeyTracker/*             →  dist/addon/MKeyTracker/
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
  console.log(`[copy-static] copied ${label}`);
}

copy(
  resolve(companionRoot, "src/renderer"),
  resolve(companionRoot, "dist/renderer"),
  "renderer static files",
);
copy(
  resolve(repoRoot, "addon/MKeyTracker"),
  resolve(companionRoot, "dist/addon/MKeyTracker"),
  "MKeyTracker addon bundle",
);

console.log("[copy-static] done");
