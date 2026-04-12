/**
 * Database seed — reference data only.
 *
 * Idempotent: re-running this script updates existing rows instead of
 * erroring on unique-constraint violations. Safe to invoke after schema
 * changes or after editing `prisma/data/dungeons.json`.
 *
 * ⚠️ The default dungeon data in `prisma/data/dungeons.json` is placeholder.
 * Before running in production, update it with real challenge_mode_id values
 * (from the addon's `C_ChallengeMode.GetActiveChallengeMapID()` or RaiderIO).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SeasonSeed {
  slug: string;
  name: string;
  patch: string;
  startsAt: string;
  isActive: boolean;
}

interface DungeonSeed {
  challengeModeId: number;
  slug: string;
  name: string;
  shortCode: string;
  parTimeSec: number;
}

interface DungeonSeedFile {
  season: SeasonSeed;
  dungeons: DungeonSeed[];
}

function loadSeedData(): DungeonSeedFile {
  const path = resolve(__dirname, "data/dungeons.json");
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as DungeonSeedFile;
  if (!parsed.season || !Array.isArray(parsed.dungeons)) {
    throw new Error("Invalid dungeons.json — missing `season` or `dungeons`");
  }
  return parsed;
}

async function main(): Promise<void> {
  const data = loadSeedData();

  console.log(`→ Seeding season: ${data.season.slug} (${data.season.name})`);

  // When activating a new season, deactivate any previously active one.
  if (data.season.isActive) {
    await prisma.season.updateMany({
      where: { isActive: true, slug: { not: data.season.slug } },
      data: { isActive: false },
    });
  }

  const season = await prisma.season.upsert({
    where: { slug: data.season.slug },
    create: {
      slug: data.season.slug,
      name: data.season.name,
      patch: data.season.patch,
      startsAt: new Date(data.season.startsAt),
      isActive: data.season.isActive,
    },
    update: {
      name: data.season.name,
      patch: data.season.patch,
      startsAt: new Date(data.season.startsAt),
      isActive: data.season.isActive,
    },
  });

  console.log(`→ Seeding ${data.dungeons.length} dungeons`);
  for (const d of data.dungeons) {
    await prisma.dungeon.upsert({
      where: { seasonId_slug: { seasonId: season.id, slug: d.slug } },
      create: {
        challengeModeId: d.challengeModeId,
        slug: d.slug,
        name: d.name,
        shortCode: d.shortCode,
        parTimeSec: d.parTimeSec,
        seasonId: season.id,
      },
      update: {
        challengeModeId: d.challengeModeId,
        name: d.name,
        shortCode: d.shortCode,
        parTimeSec: d.parTimeSec,
      },
    });
  }

  // Warn loudly about placeholder data.
  const placeholders = data.dungeons.filter(
    (d) => d.challengeModeId <= 0 || d.name.startsWith("TODO"),
  );
  if (placeholders.length > 0) {
    console.warn(
      `⚠️  ${placeholders.length} dungeon row(s) have placeholder data. ` +
        `Update prisma/data/dungeons.json with real values before production use.`,
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
