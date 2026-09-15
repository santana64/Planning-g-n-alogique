-- Extensions required by Chronolignee.
-- Runs once, on first container start, before any Prisma migration.
--
-- pg_trgm   : fuzzy surname matching for duplicate detection and search
-- unaccent  : "Lefevre" must match "Lefèvre" in a French-first product
-- citext    : case-insensitive emails without lower() everywhere
-- postgis   : place geometry, migration paths, spatial queries

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Immutable unaccent wrapper. The stock unaccent() is STABLE, not IMMUTABLE,
-- so PostgreSQL refuses it in expression indexes. Genealogical name search is
-- worthless without accent-insensitive indexed lookups, hence this wrapper.
CREATE OR REPLACE FUNCTION chronolignee_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
