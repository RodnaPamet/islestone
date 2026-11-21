#!/usr/bin/env bash
# Save or restore a seeded database as a custom-format dump (Hardening H2a,
# docs/performance.md; owner decision 171: the seed is cached as a dump).
#
#   scripts/seed-scale/cache.sh save    <database> <file>
#   scripts/seed-scale/cache.sh restore <database> <file>
#
# Runs pg_dump and pg_restore INSIDE the container scripts/ci-postgres.sh
# started (`${CI_PG_PREFIX:-islestone-ci}-postgres`), so the client tools are
# the server's own version (a runner's preinstalled pg_dump may be older than
# the image's PostgreSQL 17). `restore` expects the empty database
# ci-postgres.sh created and restores with four jobs.
set -euo pipefail

action="${1:?usage: cache.sh save|restore <database> <file>}"
db="${2:?usage: cache.sh save|restore <database> <file>}"
file="${3:?usage: cache.sh save|restore <database> <file>}"
container="${CI_PG_PREFIX:-islestone-ci}-postgres"
user="${PG_USER:-islestone}"
inside="/tmp/seed-scale.dump"

case "$action" in
    save)
        docker exec "$container" pg_dump --format=custom --compress=6 -U "$user" -d "$db" -f "$inside"
        mkdir -p "$(dirname "$file")"
        docker cp "$container:$inside" "$file"
        docker exec "$container" rm -f "$inside"
        echo "cache.sh: saved $db to $file ($(du -h "$file" | cut -f1))"
        ;;
    restore)
        test -s "$file" || { echo "cache.sh: no dump at $file" >&2; exit 1; }
        docker cp "$file" "$container:$inside"
        docker exec "$container" pg_restore --jobs=4 --exit-on-error -U "$user" -d "$db" "$inside"
        docker exec "$container" rm -f "$inside"
        # Planner statistics are not in a dump.
        docker exec "$container" psql -q -U "$user" -d "$db" -c 'ANALYZE'
        echo "cache.sh: restored $file into $db"
        ;;
    *)
        echo "cache.sh: unknown action $action (save or restore)" >&2
        exit 2
        ;;
esac
