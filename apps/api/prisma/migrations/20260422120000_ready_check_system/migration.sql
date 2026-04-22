-- Ready Check System migration
-- See docs/EVENT_READY_CHECK_SYSTEM.md
--
-- Changes:
--   1. Drop `signups_closed` from EventStatus (signups never close in the new model)
--   2. Add FlexRole, SlotPosition, EventGroupState, ReadyCheckState enums
--   3. Add flex_role, priority_flag, slot_position to event_signups
--   4. Replace event_groups.status (string) with state (enum); add ready_check_id, resolved_at
--   5. Create ready_checks + ready_check_participants tables

-- ─────────────────────────────────────────────────────────────
-- 1. EventStatus: drop `signups_closed`
-- Postgres doesn't let you drop an enum value directly, so rename + recreate.
-- Any row with status = 'signups_closed' becomes 'open' — signups stay open
-- in the new model, and the "group assembly" phase no longer exists.
-- ─────────────────────────────────────────────────────────────

UPDATE "events" SET "status" = 'open' WHERE "status" = 'signups_closed';

ALTER TYPE "EventStatus" RENAME TO "EventStatus_old";
CREATE TYPE "EventStatus" AS ENUM ('draft', 'open', 'in_progress', 'completed', 'cancelled');
ALTER TABLE "events"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "EventStatus" USING "status"::text::"EventStatus",
  ALTER COLUMN "status" SET DEFAULT 'draft';
DROP TYPE "EventStatus_old";

-- ─────────────────────────────────────────────────────────────
-- 2. New enums
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "EventGroupState" AS ENUM ('forming', 'matched', 'disbanded', 'timed_out');
CREATE TYPE "FlexRole" AS ENUM ('tank', 'healer', 'dps', 'none');
CREATE TYPE "SlotPosition" AS ENUM ('tank', 'healer', 'dps1', 'dps2', 'dps3');
CREATE TYPE "ReadyCheckState" AS ENUM ('active', 'expired');

-- ─────────────────────────────────────────────────────────────
-- 3. event_signups — add flex, priority flag, slot position
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "event_signups"
  ADD COLUMN "flex_role" "FlexRole" NOT NULL DEFAULT 'none',
  ADD COLUMN "priority_flag" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "slot_position" "SlotPosition";

-- ─────────────────────────────────────────────────────────────
-- 4. ready_checks (needed before event_groups.ready_check_id FK)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "ready_checks" (
  "id" SERIAL PRIMARY KEY,
  "event_id" INTEGER NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "state" "ReadyCheckState" NOT NULL DEFAULT 'active',
  "started_by_user_id" INTEGER NOT NULL,
  CONSTRAINT "ready_checks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE,
  CONSTRAINT "ready_checks_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE INDEX "ready_checks_event_id_state_idx" ON "ready_checks"("event_id", "state");

CREATE TABLE "ready_check_participants" (
  "id" SERIAL PRIMARY KEY,
  "ready_check_id" INTEGER NOT NULL,
  "signup_id" INTEGER NOT NULL,
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at" TIMESTAMP(3),
  CONSTRAINT "ready_check_participants_ready_check_id_fkey" FOREIGN KEY ("ready_check_id") REFERENCES "ready_checks"("id") ON DELETE CASCADE,
  CONSTRAINT "ready_check_participants_signup_id_fkey" FOREIGN KEY ("signup_id") REFERENCES "event_signups"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ready_check_participants_ready_check_id_signup_id_key" ON "ready_check_participants"("ready_check_id", "signup_id");
CREATE INDEX "ready_check_participants_signup_id_idx" ON "ready_check_participants"("signup_id");

-- ─────────────────────────────────────────────────────────────
-- 5. event_groups — replace freeform status with EventGroupState enum,
-- add ready_check_id + resolved_at
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "event_groups"
  ADD COLUMN "state" "EventGroupState" NOT NULL DEFAULT 'forming',
  ADD COLUMN "ready_check_id" INTEGER,
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD CONSTRAINT "event_groups_ready_check_id_fkey"
    FOREIGN KEY ("ready_check_id") REFERENCES "ready_checks"("id") ON DELETE SET NULL;

-- Map legacy status strings to the new state enum:
--   assigned / ready -> forming (no terminal outcome)
--   completed -> matched (had a run linked)
-- Any unexpected values fall through as `forming`.
UPDATE "event_groups" SET "state" = 'matched' WHERE "status" = 'completed';

ALTER TABLE "event_groups" DROP COLUMN "status";

CREATE INDEX "event_groups_state_idx" ON "event_groups"("state");

-- slot_position uniqueness: each seat per group is held by at most one signup.
-- NULL slot_positions (unassigned signups) are ignored by the unique constraint.
CREATE UNIQUE INDEX "event_signups_group_id_slot_position_key"
  ON "event_signups"("group_id", "slot_position")
  WHERE "slot_position" IS NOT NULL;
