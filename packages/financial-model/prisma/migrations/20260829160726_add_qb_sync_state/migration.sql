-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PAST_DUE', 'CANCELLED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'SYNCING', 'ERROR');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isBypassed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "password" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QbConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "isSandbox" BOOLEAN NOT NULL DEFAULT false,
    "companyName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
    "paystackCustCode" TEXT,
    "paystackPlanCode" TEXT,
    "paystackSubscriptionCode" TEXT,
    "billingCycle" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "lastTransactionRef" TEXT,
    "lastSyncMessage" TEXT,

    CONSTRAINT "QbConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QbSyncState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QbSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleFinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "syncToken" INTEGER NOT NULL DEFAULT 0,
    "findingData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subType" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL,
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" TEXT,
    "customerId" TEXT,
    "vendorId" TEXT,
    "rawData" JSONB NOT NULL,
    "syncToken" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "healthScore" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "errorMessage" TEXT,
    "metadata" JSONB,
    "connectionId" TEXT NOT NULL,

    CONSTRAINT "DiagnosticRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticCheck" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "fingerprint" TEXT,
    "entities" JSONB NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "recordsSynced" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "description" TEXT,
    "payee" TEXT,
    "status" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(65,30) NOT NULL,
    "closingBalance" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleConfig" (
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "json" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleConfig_pkey" PRIMARY KEY ("tenantId","realmId","ruleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_email_key" ON "Tenant"("email");

-- CreateIndex
CREATE INDEX "Tenant_email_idx" ON "Tenant"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "QbConnection_realmId_idx" ON "QbConnection"("realmId");

-- CreateIndex
CREATE INDEX "QbConnection_subscriptionStatus_idx" ON "QbConnection"("subscriptionStatus");

-- CreateIndex
CREATE INDEX "QbConnection_currentPeriodEnd_idx" ON "QbConnection"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "QbConnection_tenantId_realmId_key" ON "QbConnection"("tenantId", "realmId");

-- CreateIndex
CREATE INDEX "QbSyncState_tenantId_realmId_idx" ON "QbSyncState"("tenantId", "realmId");

-- CreateIndex
CREATE UNIQUE INDEX "QbSyncState_realmId_entityType_key" ON "QbSyncState"("realmId", "entityType");

-- CreateIndex
CREATE INDEX "RuleFinding_tenantId_realmId_ruleId_idx" ON "RuleFinding"("tenantId", "realmId", "ruleId");

-- CreateIndex
CREATE INDEX "RuleFinding_tenantId_qbId_idx" ON "RuleFinding"("tenantId", "qbId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleFinding_tenantId_realmId_ruleId_qbId_syncToken_key" ON "RuleFinding"("tenantId", "realmId", "ruleId", "qbId", "syncToken");

-- CreateIndex
CREATE INDEX "Account_tenantId_realmId_idx" ON "Account"("tenantId", "realmId");

-- CreateIndex
CREATE INDEX "Account_tenantId_realmId_type_idx" ON "Account"("tenantId", "realmId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantId_realmId_qbId_key" ON "Account"("tenantId", "realmId", "qbId");

-- CreateIndex
CREATE INDEX "Transaction_tenantId_realmId_idx" ON "Transaction"("tenantId", "realmId");

-- CreateIndex
CREATE INDEX "Transaction_tenantId_realmId_type_idx" ON "Transaction"("tenantId", "realmId", "type");

-- CreateIndex
CREATE INDEX "Transaction_tenantId_realmId_date_idx" ON "Transaction"("tenantId", "realmId", "date");

-- CreateIndex
CREATE INDEX "Transaction_tenantId_realmId_status_idx" ON "Transaction"("tenantId", "realmId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_tenantId_realmId_qbId_key" ON "Transaction"("tenantId", "realmId", "qbId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_date_id_key" ON "Transaction"("date", "id");

-- CreateIndex
CREATE INDEX "Customer_tenantId_realmId_idx" ON "Customer"("tenantId", "realmId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_realmId_name_idx" ON "Customer"("tenantId", "realmId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_realmId_qbId_key" ON "Customer"("tenantId", "realmId", "qbId");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_realmId_idx" ON "Vendor"("tenantId", "realmId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_tenantId_realmId_qbId_key" ON "Vendor"("tenantId", "realmId", "qbId");

-- CreateIndex
CREATE INDEX "DiagnosticRun_tenantId_connectionId_idx" ON "DiagnosticRun"("tenantId", "connectionId");

-- CreateIndex
CREATE INDEX "DiagnosticRun_connectionId_idx" ON "DiagnosticRun"("connectionId");

-- CreateIndex
CREATE INDEX "DiagnosticRun_runAt_idx" ON "DiagnosticRun"("runAt");

-- CreateIndex
CREATE INDEX "DiagnosticCheck_runId_idx" ON "DiagnosticCheck"("runId");

-- CreateIndex
CREATE INDEX "DiagnosticCheck_ruleId_idx" ON "DiagnosticCheck"("ruleId");

-- CreateIndex
CREATE INDEX "Issue_connectionId_idx" ON "Issue"("connectionId");

-- CreateIndex
CREATE INDEX "Issue_runId_idx" ON "Issue"("runId");

-- CreateIndex
CREATE INDEX "Issue_ruleId_idx" ON "Issue"("ruleId");

-- CreateIndex
CREATE INDEX "Issue_severity_idx" ON "Issue"("severity");

-- CreateIndex
CREATE INDEX "Issue_fingerprint_idx" ON "Issue"("fingerprint");

-- CreateIndex
CREATE INDEX "Issue_connectionId_isResolved_idx" ON "Issue"("connectionId", "isResolved");

-- CreateIndex
CREATE INDEX "SyncLog_tenantId_realmId_idx" ON "SyncLog"("tenantId", "realmId");

-- CreateIndex
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");

-- CreateIndex
CREATE INDEX "BankTransaction_tenantId_realmId_idx" ON "BankTransaction"("tenantId", "realmId");

-- CreateIndex
CREATE INDEX "BankTransaction_tenantId_accountId_idx" ON "BankTransaction"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "BankTransaction_tenantId_date_idx" ON "BankTransaction"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_tenantId_realmId_qbId_key" ON "BankTransaction"("tenantId", "realmId", "qbId");

-- CreateIndex
CREATE INDEX "Reconciliation_tenantId_realmId_idx" ON "Reconciliation"("tenantId", "realmId");

-- CreateIndex
CREATE INDEX "Reconciliation_tenantId_accountId_idx" ON "Reconciliation"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "Reconciliation_tenantId_endDate_idx" ON "Reconciliation"("tenantId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Reconciliation_tenantId_realmId_qbId_key" ON "Reconciliation"("tenantId", "realmId", "qbId");

-- CreateIndex
CREATE INDEX "RuleConfig_tenantId_realmId_idx" ON "RuleConfig"("tenantId", "realmId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QbConnection" ADD CONSTRAINT "QbConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticRun" ADD CONSTRAINT "DiagnosticRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "QbConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticRun" ADD CONSTRAINT "DiagnosticRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticCheck" ADD CONSTRAINT "DiagnosticCheck_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiagnosticRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "QbConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiagnosticRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
