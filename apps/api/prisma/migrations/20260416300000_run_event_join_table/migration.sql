-- CreateTable
CREATE TABLE "run_events" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "event_id" INTEGER NOT NULL,
    "group_id" INTEGER,
    "event_juice" INTEGER NOT NULL DEFAULT 0,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "run_events_event_id_idx" ON "run_events"("event_id");

-- CreateIndex
CREATE INDEX "run_events_run_id_idx" ON "run_events"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_events_run_id_event_id_key" ON "run_events"("run_id", "event_id");

-- AddForeignKey
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "event_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
