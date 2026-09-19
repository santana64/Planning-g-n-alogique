-- An export takes every living person in the tree away as a file; the audit
-- trail records who did it and when.
ALTER TYPE "RevisionAction" ADD VALUE 'EXPORT';
