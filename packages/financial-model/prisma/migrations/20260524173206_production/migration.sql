/*
  Warnings:

  - A unique constraint covering the columns `[date,id]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PAST_DUE');

-- AlterTable
ALTER TABLE "DiagnosticCheck" ADD COLUMN     "severity" TEXT;

-- AlterTable
ALTER TABLE "DiagnosticRun" ADD COLUMN     "connectionId" TEXT;

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "fingerprint" TEXT;

-- AlterTable
ALTER TABLE "QbConnection" ADD COLUMN     "paystackCustCode" TEXT,
ADD COLUMN     "paystackPlanCode" TEXT,
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "SyncLog" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "RuleFinding" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "syncToken" INTEGER NOT NULL DEFAULT 0,
    "findingData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "description" TEXT,
    "payee" TEXT,
    "status" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(65,30) NOT NULL,
    "closingBalance" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleConfig" (
    "realmId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "json" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleConfig_pkey" PRIMARY KEY ("realmId","ruleId")
);

-- CreateIndex
CREATE INDEX "RuleFinding_realmId_ruleId_idx" ON "RuleFinding"("realmId", "ruleId");

-- CreateIndex
CREATE INDEX "RuleFinding_qbId_idx" ON "RuleFinding"("qbId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleFinding_realmId_ruleId_qbId_syncToken_key" ON "RuleFinding"("realmId", "ruleId", "qbId", "syncToken");

-- CreateIndex
CREATE INDEX "BankTransaction_realmId_idx" ON "BankTransaction"("realmId");

-- CreateIndex
CREATE INDEX "BankTransaction_accountId_idx" ON "BankTransaction"("accountId");

-- CreateIndex
CREATE INDEX "BankTransaction_date_idx" ON "BankTransaction"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_realmId_qbId_key" ON "BankTransaction"("realmId", "qbId");

-- CreateIndex
CREATE INDEX "Reconciliation_realmId_idx" ON "Reconciliation"("realmId");

-- CreateIndex
CREATE INDEX "Reconciliation_accountId_idx" ON "Reconciliation"("accountId");

-- CreateIndex
CREATE INDEX "Reconciliation_endDate_idx" ON "Reconciliation"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Reconciliation_realmId_qbId_key" ON "Reconciliation"("realmId", "qbId");

-- CreateIndex
CREATE INDEX "RuleConfig_realmId_idx" ON "RuleConfig"("realmId");

-- CreateIndex
CREATE INDEX "DiagnosticRun_connectionId_idx" ON "DiagnosticRun"("connectionId");

-- CreateIndex
CREATE INDEX "Issue_fingerprint_idx" ON "Issue"("fingerprint");

-- CreateIndex
CREATE INDEX "Issue_connectionId_isResolved_idx" ON "Issue"("connectionId", "isResolved");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_date_id_key" ON "Transaction"("date", "id");

-- AddForeignKey
ALTER TABLE "DiagnosticRun" ADD CONSTRAINT "DiagnosticRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "QbConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
