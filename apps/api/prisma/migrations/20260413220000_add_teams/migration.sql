-- Persistent teams — pre-made rosters that sign up for team-mode events.
-- Rosters are immutable after creation. Captain can soft-delete (inactivate).

CREATE TABLE "teams" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "captain_user_id" INTEGER NOT NULL,
    "season_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_members" (
    "id" SERIAL NOT NULL,
    "team_id" INTEGER NOT NULL,
    "character_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "teams_season_id_name_key" ON "teams"("season_id", "name");
CREATE UNIQUE INDEX "team_members_team_id_character_id_key" ON "team_members"("team_id", "character_id");

-- Indexes
CREATE INDEX "teams_captain_user_id_idx" ON "teams"("captain_user_id");
CREATE INDEX "teams_active_idx" ON "teams"("active");
CREATE INDEX "team_members_character_id_idx" ON "team_members"("character_id");

-- Foreign keys
ALTER TABLE "teams" ADD CONSTRAINT "teams_captain_user_id_fkey" FOREIGN KEY ("captain_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
