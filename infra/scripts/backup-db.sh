#!/usr/bin/env bash
#
# Chronolignée — PostgreSQL backup.
#
# A custom-format dump (compressed, restorable table by table) and its
# SHA-256, side by side. Run it daily at least; keep the files somewhere that
# is not the database's own disk, and test them with verify-backup.sh — a
# backup nobody has restored is a hope, not a backup (docs/DEPLOYMENT.md).
#
#   DATABASE_URL=postgresql://… infra/scripts/backup-db.sh
#   PG_CONTAINER=chronolignee-postgres infra/scripts/backup-db.sh   # local Docker
#
# Writes to $BACKUP_DIR (default ./backups) and prints the dump's path.

set -euo pipefail

out_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$out_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$out_dir/chronolignee-$stamp.dump"

if [[ -n "${PG_CONTAINER:-}" ]]; then
  # The tools inside the database's container: nothing to install on the host.
  docker exec "$PG_CONTAINER" pg_dump --format=custom --no-owner \
    --username="${PGUSER:-chronolignee}" --dbname="${PGDATABASE:-chronolignee}" >"$file"
else
  : "${DATABASE_URL:?DATABASE_URL is required (or PG_CONTAINER for a local container)}"
  # libpq refuses Prisma's ?schema= parameter; the dump covers every schema.
  pg_dump --format=custom --no-owner --dbname="${DATABASE_URL%%\?*}" --file="$file"
fi

# An empty or truncated dump must fail here, not on the day it is needed.
if [[ ! -s "$file" ]]; then
  echo "backup failed: $file is empty" >&2
  exit 1
fi

(cd "$out_dir" && sha256sum "$(basename "$file")" >"$(basename "$file").sha256")
echo "$file"
