-- Add new event types and type-specific config field.

ALTER TYPE "EventType" ADD VALUE 'key_climbing';
ALTER TYPE "EventType" ADD VALUE 'marathon';
ALTER TYPE "EventType" ADD VALUE 'best_average';
ALTER TYPE "EventType" ADD VALUE 'bracket_tournament';

ALTER TABLE "events" ADD COLUMN "type_config" JSONB;
