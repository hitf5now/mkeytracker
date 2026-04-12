-- Sprint 8: UX Overhaul schema changes
-- - Event: add discordMessageId, discordChannelId
-- - Character: add hasCompanionApp
-- - EventSignup: nullable userId, add discordUserId, spec, signupSource, signupStatus
-- - New enums: SignupSource, SignupStatus

-- CreateEnum
CREATE TYPE "SignupSource" AS ENUM ('discord_verified', 'discord_manual', 'web_oauth');

-- CreateEnum
CREATE TYPE "SignupStatus" AS ENUM ('confirmed', 'tentative', 'declined');

-- AlterTable: Event — add Discord embed tracking columns
ALTER TABLE "events" ADD COLUMN "discord_message_id" TEXT;
ALTER TABLE "events" ADD COLUMN "discord_channel_id" TEXT;

-- AlterTable: Character — add companion app flag
ALTER TABLE "characters" ADD COLUMN "has_companion_app" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: EventSignup — make userId nullable, add new columns
ALTER TABLE "event_signups" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "event_signups" ADD COLUMN "discord_user_id" TEXT;
ALTER TABLE "event_signups" ADD COLUMN "spec" TEXT;
ALTER TABLE "event_signups" ADD COLUMN "signup_source" "SignupSource" NOT NULL DEFAULT 'discord_verified';
ALTER TABLE "event_signups" ADD COLUMN "signup_status" "SignupStatus" NOT NULL DEFAULT 'confirmed';

-- Backfill discordUserId from existing signups (join through users table)
UPDATE "event_signups" es
SET "discord_user_id" = u."discord_id"
FROM "users" u
WHERE es."user_id" = u."id" AND es."discord_user_id" IS NULL;

-- Drop old unique constraint and create new one
ALTER TABLE "event_signups" DROP CONSTRAINT IF EXISTS "event_signups_event_id_user_id_key";
CREATE UNIQUE INDEX "event_signups_event_id_discord_user_id_key" ON "event_signups"("event_id", "discord_user_id");
