-- Sprint 15.2: Pet damage attribution subtotals
--
-- Pet / guardian / totem damage is now rolled into the owning player's
-- damageDone (and healing), with a separate subtotal preserved so UIs can
-- show "of which 11.9M was pet damage". SPELL_SUMMON events in the parser
-- provide the pet-to-owner mapping.

ALTER TABLE "run_enrichments"
  ADD COLUMN "total_pet_damage"  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "total_pet_healing" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "run_enrichment_players"
  ADD COLUMN "pet_damage_done"  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "pet_healing_done" BIGINT NOT NULL DEFAULT 0;
