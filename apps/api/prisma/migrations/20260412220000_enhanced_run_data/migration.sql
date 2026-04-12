-- Enhanced run data: rating, combat stats, dynamic dungeon/season

ALTER TABLE "runs" ADD COLUMN "dungeon_name" TEXT;
ALTER TABLE "runs" ADD COLUMN "wow_season_id" INTEGER;
ALTER TABLE "runs" ADD COLUMN "old_rating" INTEGER;
ALTER TABLE "runs" ADD COLUMN "new_rating" INTEGER;
ALTER TABLE "runs" ADD COLUMN "rating_gained" INTEGER;
ALTER TABLE "runs" ADD COLUMN "is_map_record" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "runs" ADD COLUMN "is_affix_record" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "runs" ADD COLUMN "player_stats" JSONB;
