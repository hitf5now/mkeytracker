-- Sprint 15.1: Damage-timeline buckets + peak-damage columns
--
-- Adds per-player damage timeline (bucketed) and peak-bucket metadata to
-- enrichment. The bucket width is stored on the parent enrichment row so
-- future re-tuning can coexist with historical data without invalidating it.

ALTER TABLE "run_enrichments"
  ADD COLUMN "bucket_size_ms"     INTEGER,
  ADD COLUMN "segment_started_at" TIMESTAMP(3);

ALTER TABLE "run_enrichment_players"
  ADD COLUMN "damage_buckets"     JSONB,
  ADD COLUMN "peak_bucket_index"  INTEGER,
  ADD COLUMN "peak_damage"        BIGINT;

-- Supports the "personal-record peak DPS" query planned for the PR dashboard:
--   SELECT peak_damage FROM run_enrichment_players
--   WHERE character_id = $1 ORDER BY peak_damage DESC LIMIT 1;
CREATE INDEX "run_enrichment_players_characterId_peakDamage_idx"
  ON "run_enrichment_players" ("character_id", "peak_damage" DESC);
