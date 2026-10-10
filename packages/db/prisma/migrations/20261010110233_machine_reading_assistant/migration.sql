-- CreateEnum
CREATE TYPE "DocumentAnalysisStatus" AS ENUM ('NONE', 'QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ResearchSuggestionStatus" AS ENUM ('PENDING', 'ADOPTED', 'DISMISSED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "analysisError" TEXT,
ADD COLUMN     "analysisStatus" "DocumentAnalysisStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "machineCaveats" JSONB,
ADD COLUMN     "machineLegibility" TEXT,
ADD COLUMN     "machineReadAt" TIMESTAMP(3),
ADD COLUMN     "machineReader" TEXT,
ADD COLUMN     "machineTranscription" TEXT;

-- CreateTable
CREATE TABLE "ai_research_suggestions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "whereToLook" TEXT,
    "basis" JSONB NOT NULL,
    "status" "ResearchSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,

    CONSTRAINT "ai_research_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_research_suggestions_treeId_personId_status_idx" ON "ai_research_suggestions"("treeId", "personId", "status");

-- AddForeignKey
ALTER TABLE "ai_research_suggestions" ADD CONSTRAINT "ai_research_suggestions_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_research_suggestions" ADD CONSTRAINT "ai_research_suggestions_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
