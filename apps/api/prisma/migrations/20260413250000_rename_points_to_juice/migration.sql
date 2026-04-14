-- Rename "points" to "Juice" — the platform's unique scoring currency.
-- Three pools: Personal Juice (run score), Event Juice, Team Juice.
-- This migration handles the existing "points" column rename.

ALTER TABLE "runs" RENAME COLUMN "points" TO "personal_juice";
ALTER TABLE "users" RENAME COLUMN "mentor_points" TO "mentor_juice";
