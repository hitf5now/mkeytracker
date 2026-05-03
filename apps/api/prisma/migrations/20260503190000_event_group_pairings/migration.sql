-- Pair-history table for the matchmaker's "don't reform identical groups
-- back-to-back" tiebreaker. Purely additive: only CREATE TABLE + indexes,
-- no changes to any existing table or column.
CREATE TABLE "event_group_pairings" (
  "id"              SERIAL PRIMARY KEY,
  "event_id"        INTEGER NOT NULL,
  "group_id"        INTEGER NOT NULL,
  "ready_check_id"  INTEGER NOT NULL,
  "signup_id_a"     INTEGER NOT NULL,
  "signup_id_b"     INTEGER NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_group_pairings_group_id_fkey"
    FOREIGN KEY ("group_id")
    REFERENCES "event_groups"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "event_group_pairings_ready_check_id_fkey"
    FOREIGN KEY ("ready_check_id")
    REFERENCES "ready_checks"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "event_group_pairings_event_id_signup_id_a_idx"
  ON "event_group_pairings" ("event_id", "signup_id_a");
CREATE INDEX "event_group_pairings_event_id_signup_id_b_idx"
  ON "event_group_pairings" ("event_id", "signup_id_b");
CREATE INDEX "event_group_pairings_ready_check_id_idx"
  ON "event_group_pairings" ("ready_check_id");
