/*
  Warnings:

  - Made the column `connectionId` on table `DiagnosticRun` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "DiagnosticRun" DROP CONSTRAINT "DiagnosticRun_connectionId_fkey";

-- DropIndex
DROP INDEX "DiagnosticRun_tenantId_idx";

-- AlterTable
ALTER TABLE "DiagnosticRun" ALTER COLUMN "connectionId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "DiagnosticRun_tenantId_connectionId_idx" ON "DiagnosticRun"("tenantId", "connectionId");

-- AddForeignKey
ALTER TABLE "DiagnosticRun" ADD CONSTRAINT "DiagnosticRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "QbConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
