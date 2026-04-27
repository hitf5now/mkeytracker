/**
 * Seed loader for the achievement catalog.
 *
 * Reads JSON in `apps/api/prisma/seeds/achievements/` and upserts the
 * AchievementArchetype + AchievementFlavor rows into the DB. Idempotent:
 * a flavor's `key` is the unique identifier, so re-running rewrites copy
 * but doesn't duplicate.
 *
 * Called from:
 *   - prisma/seed.ts at deploy/init time
 *   - POST /api/v1/admin/achievements/reload (live reload, no redeploy)
 *
 * Validation:
 *   - Every flavor.archetype must reference a known archetype key.
 *   - Every archetype.key must be present in the code-side archetype
 *     registry (apps/api/src/services/achievements/archetypes.ts).
 *     Orphan rows are flagged but not auto-deleted; admin can deactivate.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AchievementApplies,
  AchievementRarity,
  AchievementSeverity,
  PrismaClient,
} from "@prisma/client";

import { archetypeKeys } from "./archetypes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// services/achievements -> services -> src -> apps/api -> prisma/seeds/achievements
const SEED_DIR = resolve(__dirname, "..", "..", "..", "prisma", "seeds", "achievements");

interface ArchetypeSeed {
  key: string;
  category: string;
  appliesTo: AchievementApplies;
  roleGate: string | null;
  description: string;
}

interface FlavorSeed {
  archetype: string;
  key: string;
  name: string;
  flavorText: string;
  description: string;
  icon: string;
  severity: AchievementSeverity;
  rarity: AchievementRarity;
  weight?: number;
  themeTags?: string[];
  classFilter?: string | null;
  specFilter?: string | null;
  dungeonFilter?: string | null;
  isActive?: boolean;
}

export interface SeedReport {
  archetypesUpserted: number;
  flavorsUpserted: number;
  flavorsSkipped: number;
  unknownArchetypeRefs: string[];
  codeOrphanArchetypes: string[];
}

export async function loadAchievementSeed(
  prisma: PrismaClient,
): Promise<SeedReport> {
  const archetypesPath = resolve(SEED_DIR, "archetypes.json");
  const flavorsPath = resolve(SEED_DIR, "flavors.json");

  const archetypes = JSON.parse(await readFile(archetypesPath, "utf8")) as ArchetypeSeed[];
  const flavors = JSON.parse(await readFile(flavorsPath, "utf8")) as FlavorSeed[];

  // ── Validate ────────────────────────────────────────────────────────
  const seedArchetypeKeys = new Set(archetypes.map((a) => a.key));
  const codeOrphanArchetypes: string[] = [];
  for (const k of seedArchetypeKeys) {
    if (!archetypeKeys.has(k)) codeOrphanArchetypes.push(k);
  }
  const codeMissing: string[] = [];
  for (const k of archetypeKeys) {
    if (!seedArchetypeKeys.has(k)) codeMissing.push(k);
  }
  if (codeMissing.length > 0) {
    console.warn(
      `[achievements] code archetypes missing from seed JSON: ${codeMissing.join(", ")}. ` +
        "These triggers will fire but no flavor card exists, so no row will be written.",
    );
  }

  const unknownArchetypeRefs: string[] = [];

  // ── Upsert archetypes ──────────────────────────────────────────────
  let archetypesUpserted = 0;
  const archetypeIdByKey = new Map<string, number>();
  for (const a of archetypes) {
    const row = await prisma.achievementArchetype.upsert({
      where: { key: a.key },
      create: {
        key: a.key,
        category: a.category,
        appliesTo: a.appliesTo,
        roleGate: a.roleGate ?? null,
        description: a.description,
        isActive: true,
      },
      update: {
        category: a.category,
        appliesTo: a.appliesTo,
        roleGate: a.roleGate ?? null,
        description: a.description,
      },
    });
    archetypeIdByKey.set(a.key, row.id);
    archetypesUpserted++;
  }

  // ── Upsert flavors ─────────────────────────────────────────────────
  let flavorsUpserted = 0;
  let flavorsSkipped = 0;
  for (const f of flavors) {
    const archetypeId = archetypeIdByKey.get(f.archetype);
    if (!archetypeId) {
      unknownArchetypeRefs.push(`${f.key} -> ${f.archetype}`);
      flavorsSkipped++;
      continue;
    }
    await prisma.achievementFlavor.upsert({
      where: { key: f.key },
      create: {
        archetypeId,
        key: f.key,
        name: f.name,
        flavorText: f.flavorText,
        description: f.description,
        icon: f.icon,
        severity: f.severity,
        rarity: f.rarity,
        weight: f.weight ?? 100,
        themeTags: f.themeTags ?? [],
        classFilter: f.classFilter ?? null,
        specFilter: f.specFilter ?? null,
        dungeonFilter: f.dungeonFilter ?? null,
        isActive: f.isActive ?? true,
      },
      update: {
        archetypeId,
        name: f.name,
        flavorText: f.flavorText,
        description: f.description,
        icon: f.icon,
        severity: f.severity,
        rarity: f.rarity,
        weight: f.weight ?? 100,
        themeTags: f.themeTags ?? [],
        classFilter: f.classFilter ?? null,
        specFilter: f.specFilter ?? null,
        dungeonFilter: f.dungeonFilter ?? null,
        isActive: f.isActive ?? true,
      },
    });
    flavorsUpserted++;
  }

  return {
    archetypesUpserted,
    flavorsUpserted,
    flavorsSkipped,
    unknownArchetypeRefs,
    codeOrphanArchetypes,
  };
}
