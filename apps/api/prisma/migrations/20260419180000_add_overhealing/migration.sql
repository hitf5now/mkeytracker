-- Add overhealing tracking to enrichment records.
--
-- Effective healing (Details-style) = raw amount - overhealing - heal-absorbed,
-- plus SPELL_ABSORBED credits. Overhealing is now tracked separately so the UI
-- can show "Healing / Overheal" and new achievements can reason about wasteful
-- heals without a re-migration.

ALTER TABLE "run_enrichments"
  ADD COLUMN "total_overhealing" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "run_enrichment_players"
  ADD COLUMN "overhealing" BIGINT NOT NULL DEFAULT 0;
