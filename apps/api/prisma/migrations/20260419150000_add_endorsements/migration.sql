-- CreateEnum
CREATE TYPE "EndorsementCategory" AS ENUM ('great_tank', 'great_healer', 'great_dps', 'interrupt_master', 'dispel_wizard', 'cc_master', 'cooldown_hero', 'affix_slayer', 'route_master', 'patient_teacher', 'calm_under_pressure', 'positive_vibes', 'shot_caller', 'clutch_saviour', 'comeback_kid');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "favorite_endorsement_id" INTEGER,
ADD COLUMN     "lifetime_juice_earned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seasonal_tokens_remaining" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seasonal_tokens_season_id" INTEGER,
ADD COLUMN     "starter_companion_granted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "starter_discord_granted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "starter_tokens_remaining" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokens_granted_from_juice" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "endorsements" (
    "id" SERIAL NOT NULL,
    "giver_id" INTEGER NOT NULL,
    "receiver_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "category" "EndorsementCategory" NOT NULL,
    "note" TEXT,
    "season_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "endorsements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "endorsements_receiver_id_idx" ON "endorsements"("receiver_id");

-- CreateIndex
CREATE INDEX "endorsements_giver_id_idx" ON "endorsements"("giver_id");

-- CreateIndex
CREATE INDEX "endorsements_run_id_idx" ON "endorsements"("run_id");

-- CreateIndex
CREATE INDEX "endorsements_receiver_id_category_idx" ON "endorsements"("receiver_id", "category");

-- CreateIndex
CREATE INDEX "endorsements_receiver_id_season_id_idx" ON "endorsements"("receiver_id", "season_id");

-- CreateIndex
CREATE UNIQUE INDEX "endorsements_giver_id_receiver_id_run_id_key" ON "endorsements"("giver_id", "receiver_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_favorite_endorsement_id_key" ON "users"("favorite_endorsement_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_seasonal_tokens_season_id_fkey" FOREIGN KEY ("seasonal_tokens_season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_favorite_endorsement_id_fkey" FOREIGN KEY ("favorite_endorsement_id") REFERENCES "endorsements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_giver_id_fkey" FOREIGN KEY ("giver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
