-- CreateEnum
CREATE TYPE "RunSource" AS ENUM ('addon', 'manual', 'raiderio');

-- CreateTable
CREATE TABLE "seasons" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dungeons" (
    "id" SERIAL NOT NULL,
    "challenge_mode_id" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "par_time_sec" INTEGER NOT NULL,
    "short_code" TEXT NOT NULL,
    "season_id" INTEGER NOT NULL,

    CONSTRAINT "dungeons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "discord_id" TEXT NOT NULL,
    "battle_tag" TEXT,
    "timezone" TEXT,
    "is_mentor" BOOLEAN NOT NULL DEFAULT false,
    "mentor_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "rio_score" INTEGER NOT NULL DEFAULT 0,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" SERIAL NOT NULL,
    "dungeon_id" INTEGER NOT NULL,
    "season_id" INTEGER NOT NULL,
    "keystone_level" INTEGER NOT NULL,
    "completion_ms" INTEGER NOT NULL,
    "par_ms" INTEGER NOT NULL,
    "on_time" BOOLEAN NOT NULL,
    "upgrades" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "time_lost_sec" INTEGER NOT NULL DEFAULT 0,
    "affixes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "server_time" BIGINT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "RunSource" NOT NULL DEFAULT 'addon',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "dedup_hash" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "event_id" INTEGER,
    "team_id" INTEGER,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_members" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "character_id" INTEGER NOT NULL,
    "class_snapshot" TEXT NOT NULL,
    "spec_snapshot" TEXT NOT NULL,
    "role_snapshot" TEXT NOT NULL,

    CONSTRAINT "run_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seasons_slug_key" ON "seasons"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "dungeons_season_id_challenge_mode_id_key" ON "dungeons"("season_id", "challenge_mode_id");

-- CreateIndex
CREATE UNIQUE INDEX "dungeons_season_id_slug_key" ON "dungeons"("season_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_discord_id_key" ON "users"("discord_id");

-- CreateIndex
CREATE INDEX "characters_user_id_idx" ON "characters"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "characters_region_realm_name_key" ON "characters"("region", "realm", "name");

-- CreateIndex
CREATE UNIQUE INDEX "runs_dedup_hash_key" ON "runs"("dedup_hash");

-- CreateIndex
CREATE INDEX "runs_season_id_dungeon_id_completion_ms_idx" ON "runs"("season_id", "dungeon_id", "completion_ms");

-- CreateIndex
CREATE INDEX "runs_season_id_keystone_level_idx" ON "runs"("season_id", "keystone_level");

-- CreateIndex
CREATE INDEX "runs_recorded_at_idx" ON "runs"("recorded_at");

-- CreateIndex
CREATE INDEX "runs_event_id_idx" ON "runs"("event_id");

-- CreateIndex
CREATE INDEX "run_members_user_id_idx" ON "run_members"("user_id");

-- CreateIndex
CREATE INDEX "run_members_character_id_idx" ON "run_members"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_members_run_id_character_id_key" ON "run_members"("run_id", "character_id");

-- AddForeignKey
ALTER TABLE "dungeons" ADD CONSTRAINT "dungeons_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_dungeon_id_fkey" FOREIGN KEY ("dungeon_id") REFERENCES "dungeons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_members" ADD CONSTRAINT "run_members_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_members" ADD CONSTRAINT "run_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_members" ADD CONSTRAINT "run_members_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
