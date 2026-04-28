-- Add AchievementTier enum + tier column on achievement_archetypes.
-- Composite archetypes evaluate after base archetypes and read which base
-- archetypes fired (severities, categories). Surfaced in the UI as a
-- "legendary tier" sitting above the normal per-player cap.

CREATE TYPE "AchievementTier" AS ENUM ('base', 'composite');

ALTER TABLE "achievement_archetypes"
  ADD COLUMN "tier" "AchievementTier" NOT NULL DEFAULT 'base';
