-- Sprint 9: Server-scoped events + guild config

-- Add discordGuildId to events
ALTER TABLE "events" ADD COLUMN "discord_guild_id" TEXT;
CREATE INDEX "events_discord_guild_id_idx" ON "events"("discord_guild_id");

-- Create guild_configs table
CREATE TABLE "guild_configs" (
    "id" SERIAL NOT NULL,
    "discord_guild_id" TEXT NOT NULL,
    "events_channel_id" TEXT,
    "guild_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guild_configs_discord_guild_id_key" ON "guild_configs"("discord_guild_id");
