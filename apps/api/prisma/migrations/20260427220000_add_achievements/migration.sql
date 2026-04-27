-- Achievements (Sprint 16)
-- Two-layer model: archetypes are code-backed triggers; flavors are
-- user-facing badges that share an archetype. RunAchievement persists
-- what was awarded so gallery, dedup, and rarity calibration share a
-- single source of truth.

-- ─────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "AchievementSeverity" AS ENUM ('positive', 'negative', 'neutral');
CREATE TYPE "AchievementRarity" AS ENUM ('common', 'uncommon', 'rare', 'epic', 'legendary');
CREATE TYPE "AchievementApplies" AS ENUM ('player', 'party');

-- ─────────────────────────────────────────────────────────────
-- achievement_archetypes
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "achievement_archetypes" (
  "id" SERIAL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "applies_to" "AchievementApplies" NOT NULL,
  "role_gate" TEXT,
  "description" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "achievement_archetypes_key_key" ON "achievement_archetypes"("key");

-- ─────────────────────────────────────────────────────────────
-- achievement_flavors
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "achievement_flavors" (
  "id" SERIAL PRIMARY KEY,
  "archetype_id" INTEGER NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "flavor_text" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "severity" "AchievementSeverity" NOT NULL,
  "rarity" "AchievementRarity" NOT NULL,
  "weight" INTEGER NOT NULL DEFAULT 100,
  "theme_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "class_filter" TEXT,
  "spec_filter" TEXT,
  "dungeon_filter" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "achievement_flavors_archetype_id_fkey"
    FOREIGN KEY ("archetype_id") REFERENCES "achievement_archetypes"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "achievement_flavors_key_key" ON "achievement_flavors"("key");
CREATE INDEX "achievement_flavors_archetype_id_is_active_idx" ON "achievement_flavors"("archetype_id", "is_active");
CREATE INDEX "achievement_flavors_class_filter_idx" ON "achievement_flavors"("class_filter");
CREATE INDEX "achievement_flavors_dungeon_filter_idx" ON "achievement_flavors"("dungeon_filter");

-- ─────────────────────────────────────────────────────────────
-- run_achievements
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "run_achievements" (
  "id" SERIAL PRIMARY KEY,
  "run_id" INTEGER NOT NULL,
  "member_id" INTEGER,
  "character_id" INTEGER,
  "archetype_id" INTEGER NOT NULL,
  "flavor_id" INTEGER NOT NULL,
  "rarity" "AchievementRarity" NOT NULL,
  "reason" TEXT NOT NULL,
  "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "run_achievements_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE,
  CONSTRAINT "run_achievements_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "run_members"("id") ON DELETE CASCADE,
  CONSTRAINT "run_achievements_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL,
  CONSTRAINT "run_achievements_archetype_id_fkey"
    FOREIGN KEY ("archetype_id") REFERENCES "achievement_archetypes"("id") ON DELETE RESTRICT,
  CONSTRAINT "run_achievements_flavor_id_fkey"
    FOREIGN KEY ("flavor_id") REFERENCES "achievement_flavors"("id") ON DELETE RESTRICT
);

-- One archetype per (run, member). NULL member_id means party-wide; PG
-- treats NULLs as distinct in unique indexes, which is exactly what we
-- want: a party-wide award doesn't conflict with a per-player one.
CREATE UNIQUE INDEX "run_achievements_run_member_archetype_unique"
  ON "run_achievements"("run_id", "member_id", "archetype_id");

CREATE INDEX "run_achievements_character_id_awarded_at_idx"
  ON "run_achievements"("character_id", "awarded_at");
CREATE INDEX "run_achievements_archetype_id_idx"
  ON "run_achievements"("archetype_id");
CREATE INDEX "run_achievements_run_id_idx"
  ON "run_achievements"("run_id");
