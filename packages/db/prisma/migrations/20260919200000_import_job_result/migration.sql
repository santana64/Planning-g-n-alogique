-- The outcome of an import written by the worker, read back by the page that
-- asked for it. Nullable: every existing job keeps meaning what it meant.
ALTER TABLE "import_jobs" ADD COLUMN "result" JSONB;
