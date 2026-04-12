#!/usr/bin/env node
/**
 * Icon generator.
 *
 * Reads src/renderer/assets/icon.svg and produces:
 *   - build/icon.ico         (multi-resolution ICO for the NSIS installer + Windows shortcuts)
 *   - build/icon.png         (512x512 PNG used by electron-builder for macOS/Linux fallback)
 *   - dist/renderer/assets/icon.png (256x256 runtime window icon)
 *   - dist/renderer/assets/tray.png (32x32 tray icon — scaled by OS if needed)
 *
 * Uses:
 *   - sharp: SVG → PNG rasterization at exact sizes
 *   - png-to-ico: bundles multiple PNGs into a single .ico file
 *
 * Idempotent — safe to run on every build. Skips regeneration if the
 * source SVG's mtime is older than the generated outputs (small speedup).
 */

import { statSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const companionRoot = resolve(__dirname, "..");

const sourceSvgPath = resolve(companionRoot, "src/renderer/assets/icon.svg");
const outIconIco = resolve(companionRoot, "build/icon.ico");
const outIconPng = resolve(companionRoot, "build/icon.png");
const outRendererIconPng = resolve(
  companionRoot,
  "dist/renderer/assets/icon.png",
);
const outRendererTrayPng = resolve(
  companionRoot,
  "dist/renderer/assets/tray.png",
);

// Which sizes to embed in the multi-res ICO. Windows NSIS + Explorer use
// the biggest-that-fits at each display context, so we provide several.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// Skip-if-up-to-date check
function isUpToDate() {
  if (!existsSync(outIconIco) || !existsSync(outIconPng)) return false;
  try {
    const srcMtime = statSync(sourceSvgPath).mtimeMs;
    const icoMtime = statSync(outIconIco).mtimeMs;
    return icoMtime >= srcMtime;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(sourceSvgPath)) {
    console.error(`[generate-icons] source SVG not found at ${sourceSvgPath}`);
    process.exit(1);
  }

  if (isUpToDate()) {
    console.log("[generate-icons] icons are up to date — skipping");
    return;
  }

  // Ensure output dirs exist
  for (const p of [outIconIco, outIconPng, outRendererIconPng, outRendererTrayPng]) {
    mkdirSync(dirname(p), { recursive: true });
  }

  const svgBuffer = readFileSync(sourceSvgPath);

  // Rasterize all ICO sizes from the SVG in parallel
  const pngBuffers = await Promise.all(
    ICO_SIZES.map(async (size) => {
      return sharp(svgBuffer, { density: 384 })
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    }),
  );

  // Bundle into a single .ico
  const icoBuffer = await pngToIco(pngBuffers);
  writeFileSync(outIconIco, icoBuffer);
  console.log(`[generate-icons] wrote ${outIconIco} (${ICO_SIZES.length} sizes)`);

  // 512x512 master PNG for other platforms / fallback
  const master = await sharp(svgBuffer, { density: 384 }).resize(512, 512).png().toBuffer();
  writeFileSync(outIconPng, master);
  console.log(`[generate-icons] wrote ${outIconPng} (512x512)`);

  // Runtime window icon (256x256)
  const winPng = await sharp(svgBuffer, { density: 384 }).resize(256, 256).png().toBuffer();
  writeFileSync(outRendererIconPng, winPng);
  console.log(`[generate-icons] wrote ${outRendererIconPng} (256x256)`);

  // Tray icon (32x32)
  const trayPng = await sharp(svgBuffer, { density: 384 }).resize(32, 32).png().toBuffer();
  writeFileSync(outRendererTrayPng, trayPng);
  console.log(`[generate-icons] wrote ${outRendererTrayPng} (32x32)`);

  console.log("[generate-icons] done");
}

void main().catch((err) => {
  console.error("[generate-icons] failed:", err);
  process.exit(1);
});
