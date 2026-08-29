-- Season-sync support: link a season row to its upstream identifiers so the
-- automated sync can match/upsert idempotently instead of guessing by slug.
ALTER TABLE "seasons" ADD COLUMN "external_slug" TEXT;
ALTER TABLE "seasons" ADD COLUMN "wow_season_id" INTEGER;

CREATE UNIQUE INDEX "seasons_external_slug_key" ON "seasons"("external_slug");
