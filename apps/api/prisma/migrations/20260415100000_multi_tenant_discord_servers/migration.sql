-- Sprint 13 Phase 1: Multi-tenant Discord server support
-- Replaces guild_configs with discord_servers, adds admin/member tables,
-- adds Event.server_id FK, adds Run.event_juice + Run.team_juice columns.

-- 1. Create discord_servers table (replacing guild_configs)
CREATE TABLE "discord_servers" (
    "id" SERIAL NOT NULL,
    "discord_guild_id" TEXT NOT NULL,
    "guild_name" TEXT,
    "guild_icon_url" TEXT,
    "installed_by_discord_id" TEXT,
    "bot_active" BOOLEAN NOT NULL DEFAULT true,
    "events_channel_id" TEXT,
    "results_channel_id" TEXT,
    "announcements_channel_id" TEXT,
    "results_webhook_url" TEXT,
    "allow_public_events" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_servers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discord_servers_discord_guild_id_key" ON "discord_servers"("discord_guild_id");

-- 2. Migrate existing guild_configs data into discord_servers
INSERT INTO "discord_servers" ("discord_guild_id", "guild_name", "events_channel_id", "created_at", "updated_at")
SELECT "discord_guild_id", "guild_name", "events_channel_id", "created_at", "updated_at"
FROM "guild_configs";

-- 3. Create admin table
CREATE TABLE "discord_server_admins" (
    "id" SERIAL NOT NULL,
    "server_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discord_server_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discord_server_admins_server_id_user_id_key" ON "discord_server_admins"("server_id", "user_id");

ALTER TABLE "discord_server_admins"
    ADD CONSTRAINT "discord_server_admins_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "discord_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discord_server_admins"
    ADD CONSTRAINT "discord_server_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Create member table
CREATE TABLE "discord_server_members" (
    "id" SERIAL NOT NULL,
    "server_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discord_server_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discord_server_members_server_id_user_id_key" ON "discord_server_members"("server_id", "user_id");
CREATE INDEX "discord_server_members_user_id_is_primary_idx" ON "discord_server_members"("user_id", "is_primary");

ALTER TABLE "discord_server_members"
    ADD CONSTRAINT "discord_server_members_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "discord_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discord_server_members"
    ADD CONSTRAINT "discord_server_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Add server_id FK to events + backfill from discord_guild_id
ALTER TABLE "events" ADD COLUMN "server_id" INTEGER;

UPDATE "events" e
SET "server_id" = ds."id"
FROM "discord_servers" ds
WHERE e."discord_guild_id" = ds."discord_guild_id";

ALTER TABLE "events"
    ADD CONSTRAINT "events_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "discord_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "events_server_id_idx" ON "events"("server_id");

-- 6. Add event_juice and team_juice to runs
ALTER TABLE "runs" ADD COLUMN "event_juice" INTEGER;
ALTER TABLE "runs" ADD COLUMN "team_juice" INTEGER;

-- 7. Drop the old guild_configs table
DROP TABLE "guild_configs";
