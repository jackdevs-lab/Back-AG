-- DropForeignKey
ALTER TABLE "DiagnosticRun" DROP CONSTRAINT "DiagnosticRun_connectionId_fkey";

-- AddForeignKey
ALTER TABLE "DiagnosticRun" ADD CONSTRAINT "DiagnosticRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "QbConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
