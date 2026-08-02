-- AlterTable
ALTER TABLE "QbConnection" ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "isBypassed" BOOLEAN NOT NULL DEFAULT false;
