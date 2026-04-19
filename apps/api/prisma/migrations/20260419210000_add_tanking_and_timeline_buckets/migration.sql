-- Add data needed for the tabbed timeline UI (Damage / Healing / Tanking)
-- and the split-absorb change (option B from design discussion).
--
-- Per-player:
--   absorb_provided        — total shield absorbs cast (split out of healing_done)
--   damage_taken           — actual damage received (tank chart line 2)
--   damage_incoming        — damage directed (tank chart line 1); post-armor,
--                            pre-shield/block/resist
--   self_healing           — self-heal total (tank chart line 3)
--   parries/dodges/misses  — avoidance counts (log has no amount)
--   *_buckets (JSONB)      — per-5s timeline arrays matching damage_buckets shape
--   cast_events (JSONB)    — [{spellId, offsetMs}] for future CD overlay mapping
--
-- Per-run-aggregate:
--   total_absorb_provided
--   total_damage_taken

ALTER TABLE "run_enrichment_players"
  ADD COLUMN "absorb_provided"           BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "damage_taken"              BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "damage_incoming"           BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "self_healing"              BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "parries"                   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dodges"                    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "misses"                    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "healing_buckets"           JSONB,
  ADD COLUMN "absorb_provided_buckets"   JSONB,
  ADD COLUMN "damage_taken_buckets"      JSONB,
  ADD COLUMN "damage_incoming_buckets"   JSONB,
  ADD COLUMN "self_healing_buckets"      JSONB,
  ADD COLUMN "cast_events"               JSONB;

ALTER TABLE "run_enrichments"
  ADD COLUMN "total_absorb_provided"     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "total_damage_taken"        BIGINT NOT NULL DEFAULT 0;
