/*
  Warnings:

  - A unique constraint covering the columns `[realmId]` on the table `QbConnection` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "QbConnection_tenantId_realmId_key";

-- CreateIndex
CREATE UNIQUE INDEX "QbConnection_realmId_key" ON "QbConnection"("realmId");
