-- Expansion grouping for season pickers. Both nullable: seasons created
-- before this migration are backfilled by the seed / season sync, and an
-- unrecognised upstream expansion legitimately leaves them null.
ALTER TABLE "seasons" ADD COLUMN "expansion" TEXT;
ALTER TABLE "seasons" ADD COLUMN "season_number" INTEGER;
