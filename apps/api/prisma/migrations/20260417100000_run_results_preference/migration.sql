-- CreateEnum
CREATE TYPE "RunResultsMode" AS ENUM ('all_my_servers', 'none', 'primary');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "run_results_mode" "RunResultsMode" NOT NULL DEFAULT 'all_my_servers';

-- CreateTable
CREATE TABLE "run_discord_posts" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "channel_id" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_discord_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "run_discord_posts_run_id_idx" ON "run_discord_posts"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_discord_posts_run_id_channel_id_key" ON "run_discord_posts"("run_id", "channel_id");

-- AddForeignKey
ALTER TABLE "run_discord_posts" ADD CONSTRAINT "run_discord_posts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
