/*
  Warnings:

  - You are about to drop the column `syncToken` on the `RuleFinding` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[tenantId,realmId,ruleId,qbId]` on the table `RuleFinding` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "RuleFinding_tenantId_realmId_ruleId_qbId_syncToken_key";

-- AlterTable
ALTER TABLE "DiagnosticRun" ADD COLUMN     "correlationId" TEXT;

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "correlationId" TEXT;

-- AlterTable
ALTER TABLE "QbConnection" ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RuleFinding" DROP COLUMN "syncToken";

-- AlterTable
ALTER TABLE "SyncLog" ADD COLUMN     "correlationId" TEXT;

-- CreateIndex
CREATE INDEX "DiagnosticRun_correlationId_idx" ON "DiagnosticRun"("correlationId");

-- CreateIndex
CREATE INDEX "Issue_correlationId_idx" ON "Issue"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleFinding_tenantId_realmId_ruleId_qbId_key" ON "RuleFinding"("tenantId", "realmId", "ruleId", "qbId");

-- CreateIndex
CREATE INDEX "SyncLog_correlationId_idx" ON "SyncLog"("correlationId");
