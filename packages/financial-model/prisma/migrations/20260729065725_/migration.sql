/*
  Warnings:

  - The `syncStatus` column on the `QbConnection` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'SYNCING', 'ERROR');

-- AlterTable
ALTER TABLE "QbConnection" DROP COLUMN "syncStatus",
ADD COLUMN     "syncStatus" "SyncStatus" NOT NULL DEFAULT 'IDLE';
