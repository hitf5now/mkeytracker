-- Sprint 15: Combat-log enrichment tables
--
-- Populated by the companion app after parsing WoWCombatLog.txt.
-- A Run without enrichment is still a valid run — enrichment is additive.
-- Schema collects broadly (including raw COMBATANT_INFO blobs) so Phase E
-- event-type work isn't gated on a re-migration.

CREATE TYPE "EnrichmentStatus" AS ENUM ('complete', 'partial', 'unavailable');

CREATE TABLE "run_enrichments" (
    "id"                    SERIAL NOT NULL,
    "run_id"                INTEGER NOT NULL,
    "status"                "EnrichmentStatus" NOT NULL,
    "status_reason"         TEXT,
    "parser_version"        TEXT NOT NULL,
    "total_damage"          BIGINT NOT NULL DEFAULT 0,
    "total_damage_support"  BIGINT NOT NULL DEFAULT 0,
    "total_healing"         BIGINT NOT NULL DEFAULT 0,
    "total_healing_support" BIGINT NOT NULL DEFAULT 0,
    "total_interrupts"      INTEGER NOT NULL DEFAULT 0,
    "total_dispels"         INTEGER NOT NULL DEFAULT 0,
    "party_deaths"          INTEGER NOT NULL DEFAULT 0,
    "end_trailing_fields"   DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "event_counts_raw"      JSONB,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_enrichments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "run_enrichments_run_id_key" ON "run_enrichments"("run_id");

ALTER TABLE "run_enrichments"
    ADD CONSTRAINT "run_enrichments_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "run_enrichment_players" (
    "id"                   SERIAL NOT NULL,
    "enrichment_id"        INTEGER NOT NULL,
    "player_guid"          TEXT NOT NULL,
    "player_name"          TEXT NOT NULL,
    "spec_id"              INTEGER,
    "character_id"         INTEGER,
    "damage_done"          BIGINT NOT NULL DEFAULT 0,
    "damage_done_support"  BIGINT NOT NULL DEFAULT 0,
    "healing_done"         BIGINT NOT NULL DEFAULT 0,
    "healing_done_support" BIGINT NOT NULL DEFAULT 0,
    "interrupts"           INTEGER NOT NULL DEFAULT 0,
    "dispels"              INTEGER NOT NULL DEFAULT 0,
    "deaths"               INTEGER NOT NULL DEFAULT 0,
    "combatant_info_raw"   JSONB,

    CONSTRAINT "run_enrichment_players_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "run_enrichment_players_enrichment_id_idx" ON "run_enrichment_players"("enrichment_id");
CREATE INDEX "run_enrichment_players_character_id_idx"  ON "run_enrichment_players"("character_id");
CREATE INDEX "run_enrichment_players_spec_id_idx"       ON "run_enrichment_players"("spec_id");

ALTER TABLE "run_enrichment_players"
    ADD CONSTRAINT "run_enrichment_players_enrichment_id_fkey"
    FOREIGN KEY ("enrichment_id") REFERENCES "run_enrichments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "run_enrichment_players"
    ADD CONSTRAINT "run_enrichment_players_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "characters"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "run_enrichment_encounters" (
    "id"             SERIAL NOT NULL,
    "enrichment_id"  INTEGER NOT NULL,
    "encounter_id"   INTEGER NOT NULL,
    "encounter_name" TEXT NOT NULL,
    "success"        BOOLEAN NOT NULL,
    "fight_time_ms"  INTEGER NOT NULL,
    "difficulty_id"  INTEGER NOT NULL,
    "group_size"     INTEGER NOT NULL,
    "started_at"     TIMESTAMP(3) NOT NULL,
    "sequence_index" INTEGER NOT NULL,

    CONSTRAINT "run_enrichment_encounters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "run_enrichment_encounters_enrichment_id_idx" ON "run_enrichment_encounters"("enrichment_id");
CREATE INDEX "run_enrichment_encounters_encounter_id_idx"  ON "run_enrichment_encounters"("encounter_id");

ALTER TABLE "run_enrichment_encounters"
    ADD CONSTRAINT "run_enrichment_encounters_enrichment_id_fkey"
    FOREIGN KEY ("enrichment_id") REFERENCES "run_enrichments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
