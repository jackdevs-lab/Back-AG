/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,realmId]` on the table `QbConnection` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "QbConnection_realmId_key";

-- DropIndex
DROP INDEX "QbConnection_tenantId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "QbConnection_tenantId_realmId_key" ON "QbConnection"("tenantId", "realmId");
