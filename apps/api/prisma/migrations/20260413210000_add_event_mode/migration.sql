-- Add EventMode enum and mode column to events table.
-- All existing events default to 'group' (individual signup + matchmaking).

CREATE TYPE "EventMode" AS ENUM ('group', 'team');

ALTER TABLE "events" ADD COLUMN "mode" "EventMode" NOT NULL DEFAULT 'group';
