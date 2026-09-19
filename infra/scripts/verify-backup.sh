#!/usr/bin/env bash
#
# Chronolignée — prove a backup restores.
#
# Checks the dump's SHA-256, restores it into a throwaway database on the same
# server, compares row counts of the tables that hold the research with the
# live database, and drops the throwaway database. Exits non-zero on any
# difference. Counts can differ legitimately if someone wrote in between the
# dump and the check; run it against a quiet database, or right after the dump.
#
#   PG_CONTAINER=chronolignee-postgres infra/scripts/verify-backup.sh backups/chronolignee-….dump
#   DATABASE_URL=postgresql://… infra/scripts/verify-backup.sh backups/chronolignee-….dump
#
# The restoring role needs CREATEDB, and the server the extensions the schema
# uses (citext, pg_trgm, postgis, unaccent).

set -euo pipefail

file="${1:?usage: verify-backup.sh <dump file>}"
(cd "$(dirname "$file")" && sha256sum --check --quiet "$(basename "$file").sha256")

check_db="chronolignee_restore_check_$(date -u +%s)"
user="${PGUSER:-chronolignee}"
live_db="${PGDATABASE:-chronolignee}"

if [[ -n "${PG_CONTAINER:-}" ]]; then
  sql() { docker exec -i "$PG_CONTAINER" psql --username="$user" --dbname="$1" -v ON_ERROR_STOP=1 -tAc "$2"; }
  restore() { docker exec -i "$PG_CONTAINER" pg_restore --no-owner --username="$user" --dbname="$check_db" <"$file"; }
  admin_db="$live_db"
else
  : "${DATABASE_URL:?DATABASE_URL is required (or PG_CONTAINER for a local container)}"
  base="${DATABASE_URL%%\?*}"
  server="${base%/*}"
  sql() { psql "$server/$1" -v ON_ERROR_STOP=1 -tAc "$2"; }
  restore() { pg_restore --no-owner --dbname="$server/$check_db" "$file"; }
  admin_db="${base##*/}"
  live_db="$admin_db"
fi

cleanup() { sql "$admin_db" "DROP DATABASE IF EXISTS \"$check_db\"" >/dev/null || true; }
trap cleanup EXIT

sql "$admin_db" "CREATE DATABASE \"$check_db\"" >/dev/null
restore

status=0
for table in trees tree_members users people person_names events event_participants relationships sources citations documents claims revisions; do
  live="$(sql "$live_db" "SELECT count(*) FROM \"$table\"")"
  restored="$(sql "$check_db" "SELECT count(*) FROM \"$table\"")"
  if [[ "$live" == "$restored" ]]; then
    printf '  ok  %-20s %s\n' "$table" "$restored"
  else
    printf '  !!  %-20s live %s, restored %s\n' "$table" "$live" "$restored"
    status=1
  fi
done

if [[ $status -eq 0 ]]; then
  echo "backup restores: $file"
else
  echo "backup differs from the live database: $file" >&2
fi
exit $status
