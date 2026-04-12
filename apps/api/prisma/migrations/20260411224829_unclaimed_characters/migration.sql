-- DropForeignKey
ALTER TABLE "run_members" DROP CONSTRAINT "run_members_user_id_fkey";

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "claimed_at" TIMESTAMP(3),
ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "run_members" ALTER COLUMN "user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "run_members" ADD CONSTRAINT "run_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
