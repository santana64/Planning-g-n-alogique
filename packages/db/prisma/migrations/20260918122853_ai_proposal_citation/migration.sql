-- Prisma generated a DROP INDEX for "places_geom_gist" here. It is removed by
-- hand, deliberately: the index sits on an Unsupported(geography) column that
-- Prisma cannot declare, so every `migrate dev` sees it as drift and tries to
-- drop it. Applying that would silently turn every spatial query into a scan.
-- The guard in tests/schema-indexes.integration.test.ts fails if it ever goes.

-- AlterTable
ALTER TABLE "ai_proposals" ADD COLUMN     "citationId" UUID;

-- CreateIndex
CREATE INDEX "ai_proposals_citationId_idx" ON "ai_proposals"("citationId");

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "citations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
