-- Sprint 13 Track B: Event feedback table for reviewer input on scoring

CREATE TABLE "event_feedback" (
    "id" SERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "reviewer_email" TEXT,
    "scoring_preference" TEXT,
    "scoring_ranking" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ratings" JSONB,
    "comments" TEXT,
    "submitted_via_token" TEXT,
    "submitter_ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_feedback_event_type_created_at_idx" ON "event_feedback"("event_type", "created_at");
CREATE INDEX "event_feedback_created_at_idx" ON "event_feedback"("created_at");
