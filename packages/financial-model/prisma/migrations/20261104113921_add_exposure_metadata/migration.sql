-- AlterTable
ALTER TABLE "DiagnosticCheck" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "ruleExposureAmount" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "metadata" JSONB;
