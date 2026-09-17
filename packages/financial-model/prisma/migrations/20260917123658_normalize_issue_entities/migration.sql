/*
  Warnings:

  - You are about to drop the column `entities` on the `Issue` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Issue" DROP COLUMN "entities";

-- CreateTable
CREATE TABLE "IssueEntity" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "IssueEntity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueEntity_issueId_idx" ON "IssueEntity"("issueId");

-- CreateIndex
CREATE INDEX "IssueEntity_entityId_idx" ON "IssueEntity"("entityId");

-- AddForeignKey
ALTER TABLE "IssueEntity" ADD CONSTRAINT "IssueEntity_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
