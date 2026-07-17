-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
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

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QbConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "companyName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'IDLE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QbConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subType" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL,
    "categoryId" TEXT,
    "customerId" TEXT,
    "vendorId" TEXT,
    "rawData" JSONB NOT NULL,
    "syncToken" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "qbId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
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

    CONSTRAINT "DiagnosticRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticCheck" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
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
    "entities" JSONB NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "recordsSynced" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "QbConnection_realmId_key" ON "QbConnection"("realmId");

-- CreateIndex
CREATE INDEX "QbConnection_tenantId_idx" ON "QbConnection"("tenantId");

-- CreateIndex
CREATE INDEX "QbConnection_realmId_idx" ON "QbConnection"("realmId");

-- CreateIndex
CREATE INDEX "Account_realmId_idx" ON "Account"("realmId");

-- CreateIndex
CREATE INDEX "Account_realmId_type_idx" ON "Account"("realmId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_realmId_qbId_key" ON "Account"("realmId", "qbId");

-- CreateIndex
CREATE INDEX "Transaction_realmId_idx" ON "Transaction"("realmId");

-- CreateIndex
CREATE INDEX "Transaction_realmId_type_idx" ON "Transaction"("realmId", "type");

-- CreateIndex
CREATE INDEX "Transaction_realmId_date_idx" ON "Transaction"("realmId", "date");

-- CreateIndex
CREATE INDEX "Transaction_realmId_status_idx" ON "Transaction"("realmId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_realmId_qbId_key" ON "Transaction"("realmId", "qbId");

-- CreateIndex
CREATE INDEX "Customer_realmId_idx" ON "Customer"("realmId");

-- CreateIndex
CREATE INDEX "Customer_realmId_name_idx" ON "Customer"("realmId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_realmId_qbId_key" ON "Customer"("realmId", "qbId");

-- CreateIndex
CREATE INDEX "Vendor_realmId_idx" ON "Vendor"("realmId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_realmId_qbId_key" ON "Vendor"("realmId", "qbId");

-- CreateIndex
CREATE INDEX "DiagnosticRun_tenantId_idx" ON "DiagnosticRun"("tenantId");

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
CREATE INDEX "SyncLog_realmId_idx" ON "SyncLog"("realmId");

-- CreateIndex
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QbConnection" ADD CONSTRAINT "QbConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticRun" ADD CONSTRAINT "DiagnosticRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticCheck" ADD CONSTRAINT "DiagnosticCheck_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiagnosticRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "QbConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiagnosticRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
