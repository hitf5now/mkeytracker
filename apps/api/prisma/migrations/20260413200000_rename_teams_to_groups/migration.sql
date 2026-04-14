-- Rename EventTeam → EventGroup (terminology: "teams" are persistent pre-made
-- rosters; "groups" are ephemeral auto-matchmade assignments within events).

-- Rename the table
ALTER TABLE "event_teams" RENAME TO "event_groups";

-- Rename FK columns pointing to the old table
ALTER TABLE "event_signups" RENAME COLUMN "team_id" TO "group_id";
ALTER TABLE "runs" RENAME COLUMN "team_id" TO "group_id";

-- Rename constraints
ALTER TABLE "event_groups" RENAME CONSTRAINT "event_teams_pkey" TO "event_groups_pkey";
ALTER TABLE "event_groups" RENAME CONSTRAINT "event_teams_event_id_fkey" TO "event_groups_event_id_fkey";
ALTER TABLE "event_signups" RENAME CONSTRAINT "event_signups_team_id_fkey" TO "event_signups_group_id_fkey";
ALTER TABLE "runs" RENAME CONSTRAINT "runs_team_id_fkey" TO "runs_group_id_fkey";

-- Rename indexes
ALTER INDEX "event_teams_event_id_idx" RENAME TO "event_groups_event_id_idx";
