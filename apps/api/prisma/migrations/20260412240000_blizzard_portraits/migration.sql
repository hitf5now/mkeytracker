-- Blizzard Character Media API portrait URLs
ALTER TABLE "characters" ADD COLUMN "avatar_url" TEXT;
ALTER TABLE "characters" ADD COLUMN "inset_url" TEXT;
ALTER TABLE "characters" ADD COLUMN "main_raw_url" TEXT;
