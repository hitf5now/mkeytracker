-- Track the Discord message id of the formed-group card so the bot can
-- edit/delete it when the group leaves the `forming` state.
ALTER TABLE "event_groups"
  ADD COLUMN "discord_message_id" TEXT,
  ADD COLUMN "discord_channel_id" TEXT;
