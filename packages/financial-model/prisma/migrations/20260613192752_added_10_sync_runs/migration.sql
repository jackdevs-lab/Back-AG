-- AlterTable
ALTER TABLE "QbConnection" ADD COLUMN     "scanCredits" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "qbSyncState" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qbSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qbSyncState_realmId_entityType_key" ON "qbSyncState"("realmId", "entityType");
