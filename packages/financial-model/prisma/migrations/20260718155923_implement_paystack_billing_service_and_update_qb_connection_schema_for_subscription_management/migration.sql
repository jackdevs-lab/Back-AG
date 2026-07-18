-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "QbConnection" ADD COLUMN     "billingCycle" TEXT,
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "paystackSubscriptionCode" TEXT;

-- CreateIndex
CREATE INDEX "QbConnection_subscriptionStatus_idx" ON "QbConnection"("subscriptionStatus");

-- CreateIndex
CREATE INDEX "QbConnection_currentPeriodEnd_idx" ON "QbConnection"("currentPeriodEnd");
