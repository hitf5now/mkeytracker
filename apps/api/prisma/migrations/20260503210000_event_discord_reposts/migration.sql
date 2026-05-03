-- Track repost pointer messages so they can be updated when the event
-- ends. Purely additive: only CREATE TABLE + index, no changes to any
-- existing table or column.
CREATE TABLE "event_discord_reposts" (
  "id"                  SERIAL PRIMARY KEY,
  "event_id"            INTEGER NOT NULL,
  "discord_channel_id"  TEXT NOT NULL,
  "discord_message_id"  TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_discord_reposts_event_id_fkey"
    FOREIGN KEY ("event_id")
    REFERENCES "events"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "event_discord_reposts_event_id_idx"
  ON "event_discord_reposts" ("event_id");
