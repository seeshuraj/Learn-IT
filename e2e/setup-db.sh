#!/usr/bin/env bash
# Build the throwaway end-to-end database: Supabase shim, every migration in
# order, then the e2e seed. Usage: PGURL=postgres://... e2e/setup-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGURL:?set PGURL}"

psql "$PGURL" -q -v ON_ERROR_STOP=1 -c "alter database $(psql "$PGURL" -Atc 'select current_database()') set search_path = public, extensions"
psql "$PGURL" -q -v ON_ERROR_STOP=1 -f e2e/supabase-shim.sql

# The seed migrations' emails are redacted in the repo; give each placeholder a
# unique address so their ON CONFLICT clauses behave as they did originally.
i=0
for f in supabase/migrations/*.sql; do
  i=$((i + 1))
  perl -pe 'BEGIN{$n=0} s/'"'"'<redacted-email>'"'"'/"'"'"'seed'"$i"'_".(++$n)."\@e2e.invalid'"'"'"/ge' "$f" \
    | psql "$PGURL" -q -v ON_ERROR_STOP=1 -1 -f - > /dev/null \
    || { echo "migration failed: $f"; exit 1; }
done
psql "$PGURL" -q -v ON_ERROR_STOP=1 -f e2e/seed.sql
echo "e2e database ready ($i migrations)"
