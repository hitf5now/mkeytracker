-- Team event signups — pre-made teams register for team-mode events.

CREATE TABLE "team_event_signups" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "team_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "signed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_event_signups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_event_signups_event_id_team_id_key" ON "team_event_signups"("event_id", "team_id");
CREATE INDEX "team_event_signups_event_id_idx" ON "team_event_signups"("event_id");

ALTER TABLE "team_event_signups" ADD CONSTRAINT "team_event_signups_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_event_signups" ADD CONSTRAINT "team_event_signups_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
