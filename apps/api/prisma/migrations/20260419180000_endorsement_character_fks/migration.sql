-- Add giver/receiver character FKs to endorsements so profile and
-- leaderboard views can be scoped to the specific character that earned
-- the endorsement. Columns are added nullable, backfilled from
-- run_members, then tightened to NOT NULL.

-- 1. Add columns nullable for safe backfill
ALTER TABLE "endorsements"
  ADD COLUMN "giver_character_id"    INTEGER,
  ADD COLUMN "receiver_character_id" INTEGER;

-- 2. Backfill from run_members — for each endorsement, find the
-- character the giver and receiver played in that run.
UPDATE "endorsements" e
SET "giver_character_id" = rm.character_id
FROM "run_members" rm
WHERE rm.run_id = e.run_id
  AND rm.user_id = e.giver_id
  AND e.giver_character_id IS NULL;

UPDATE "endorsements" e
SET "receiver_character_id" = rm.character_id
FROM "run_members" rm
WHERE rm.run_id = e.run_id
  AND rm.user_id = e.receiver_id
  AND e.receiver_character_id IS NULL;

-- 3. Safety check: any endorsement left without a character id means a
-- run_member row is missing. The API only accepts endorsements from
-- users who are members of the run, so this should never fire — if it
-- does, investigate before letting the migration complete.
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO missing_count
    FROM "endorsements"
   WHERE "giver_character_id" IS NULL
      OR "receiver_character_id" IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % endorsement row(s) have no matching run_member entry', missing_count;
  END IF;
END $$;

-- 4. Enforce non-null now that every row has values
ALTER TABLE "endorsements"
  ALTER COLUMN "giver_character_id" SET NOT NULL,
  ALTER COLUMN "receiver_character_id" SET NOT NULL;

-- 5. Indexes for character-scoped queries (profile + leaderboard counts)
CREATE INDEX "endorsements_receiver_character_id_idx"
  ON "endorsements"("receiver_character_id");
CREATE INDEX "endorsements_giver_character_id_idx"
  ON "endorsements"("giver_character_id");
CREATE INDEX "endorsements_receiver_character_id_category_idx"
  ON "endorsements"("receiver_character_id", "category");

-- 6. Foreign keys. CASCADE on delete matches the existing pattern for
-- character-linked rows (run_members, team_members).
ALTER TABLE "endorsements"
  ADD CONSTRAINT "endorsements_giver_character_id_fkey"
    FOREIGN KEY ("giver_character_id") REFERENCES "characters"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "endorsements"
  ADD CONSTRAINT "endorsements_receiver_character_id_fkey"
    FOREIGN KEY ("receiver_character_id") REFERENCES "characters"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
