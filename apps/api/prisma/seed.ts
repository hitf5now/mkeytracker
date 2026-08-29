/**
 * Database seed — reference data only.
 *
 * Idempotent: re-running this script updates existing rows instead of
 * erroring on unique-constraint violations. Safe to invoke after schema
 * changes or after editing `prisma/data/dungeons.json`.
 *
 * `prisma/data/dungeons.json` holds every season the platform knows about,
 * each with its dungeon pool. Exactly one is marked `isActive`. In normal
 * operation the season-sync service keeps this current automatically; this
 * seed is the bootstrap path and the manual override when a correction is
 * needed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { upsertSeason, activateSeason } from "../src/services/seasons.js";

const prisma = new PrismaClient();

const __dirname = dirname(fileURLToPath(import.meta.url));

interface DungeonSeed {
  challengeModeId: number;
  slug: string;
  name: string;
  shortCode: string;
  parTimeSec: number;
}

interface SeasonSeed {
  slug: string;
  name: string;
  patch: string;
  startsAt: string;
  endsAt?: string | null;
  isActive: boolean;
  externalSlug?: string | null;
  wowSeasonId?: number | null;
  dungeons: DungeonSeed[];
}

interface DungeonSeedFile {
  seasons: SeasonSeed[];
}

function loadSeedData(): DungeonSeedFile {
  const path = resolve(__dirname, "data/dungeons.json");
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as DungeonSeedFile;
  if (!Array.isArray(parsed.seasons) || parsed.seasons.length === 0) {
    throw new Error("Invalid dungeons.json — expected a non-empty `seasons` array");
  }
  for (const season of parsed.seasons) {
    if (!season.slug || !Array.isArray(season.dungeons)) {
      throw new Error(`Invalid season entry "${season.slug ?? "?"}" — missing slug or dungeons`);
    }
  }
  const active = parsed.seasons.filter((s) => s.isActive);
  if (active.length !== 1) {
    throw new Error(
      `Invalid dungeons.json — exactly one season must have isActive:true (found ${active.length})`,
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const data = loadSeedData();

  // Seed every season in chronological order so `activateSeason` closes out
  // prior seasons against the correct successor start date.
  const seasons = [...data.seasons].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  let activeSeasonId: number | null = null;

  for (const s of seasons) {
    const result = await upsertSeason(prisma, s);
    console.log(
      `→ ${result.created ? "Created" : "Updated"} season ${result.slug} ` +
        `(${result.dungeonsUpserted} dungeons` +
        `${result.dungeonsRemoved > 0 ? `, pruned ${result.dungeonsRemoved}` : ""})`,
    );
    if (s.isActive) activeSeasonId = result.seasonId;
  }

  if (activeSeasonId !== null) {
    await activateSeason(prisma, activeSeasonId);
    const active = await prisma.season.findUniqueOrThrow({ where: { id: activeSeasonId } });
    console.log(`→ Active season: ${active.slug} (${active.name})`);
  }

  // ── Achievement catalog ─────────────────────────────────────────
  const { loadAchievementSeed } = await import("../src/services/achievements/seed-loader.js");
  const achReport = await loadAchievementSeed(prisma);
  console.log(
    `✅ Achievements: ${achReport.archetypesUpserted} archetypes, ` +
      `${achReport.flavorsUpserted} flavors upserted ` +
      `(skipped ${achReport.flavorsSkipped})`,
  );
  if (achReport.unknownArchetypeRefs.length > 0) {
    console.warn(
      "⚠️  Flavors referencing unknown archetypes:",
      achReport.unknownArchetypeRefs,
    );
  }

  console.log("✅ Seed complete");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
