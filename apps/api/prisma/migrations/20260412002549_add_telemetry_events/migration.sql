-- CreateTable
CREATE TABLE "telemetry_events" (
    "id" BIGSERIAL NOT NULL,
    "install_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "meta" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telemetry_events_install_id_occurred_at_idx" ON "telemetry_events"("install_id", "occurred_at");

-- CreateIndex
CREATE INDEX "telemetry_events_name_occurred_at_idx" ON "telemetry_events"("name", "occurred_at");
