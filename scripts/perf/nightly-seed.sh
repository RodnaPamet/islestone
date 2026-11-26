#!/usr/bin/env bash
# The seed for one shape of the nightly performance run (Hardening H2b;
# .github/workflows/perf.yml; docs/performance.md, "The nightly run").
#
#   scripts/perf/nightly-seed.sh <10k|100k> <cache-hit>   # restore the cached dump (cache-hit = true) or seed and dump it; verify; install pg_stat_statements
#   scripts/perf/nightly-seed.sh reset                    # empty the database for the next shape
#
# Runs against the containers scripts/ci-postgres.sh started
# (`${CI_PG_PREFIX:-islestone-ci}-postgres` / `-pgbouncer`) and the database
# DIRECT_DATABASE_URL names. A fresh seed verifies itself; a restored one is
# verified here, so nothing is measured on a seed that is wrong.
set -euo pipefail

prefix="${CI_PG_PREFIX:-islestone-ci}"
user="${PG_USER:-islestone}"
db="${DIRECT_DATABASE_URL##*/}"
db="${db%%\?*}"

case "${1:?usage: nightly-seed.sh <10k|100k> <cache-hit> | reset}" in
    reset)
        docker exec "${prefix}-postgres" psql -q -U "$user" -d postgres \
            -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid()" \
            -c "DROP DATABASE IF EXISTS \"${db}\"" -c "CREATE DATABASE \"${db}\"" >/dev/null
        # PgBouncer's pooled connections named the dropped database.
        docker restart "${prefix}-pgbouncer" >/dev/null
        for _ in $(seq 1 30); do
            [ "$(docker inspect -f '{{.State.Health.Status}}' "${prefix}-pgbouncer")" = healthy ] && break
            sleep 1
        done
        echo "nightly-seed.sh: ${db} is empty"
        ;;
    10k | 100k)
        shape="$1"
        dump=".perf-cache/seed-${shape}.dump"
        if [ "${2:-}" = true ]; then
            scripts/seed-scale/cache.sh restore "$db" "$dump"
            npm run seed:scale -- --shape "$shape" --verify-only
        else
            npm run migrate:deploy
            npm run seed:scale -- --shape "$shape"
            scripts/seed-scale/cache.sh save "$db" "$dump"
        fi
        docker exec "${prefix}-postgres" psql -q -U "$user" -d "$db" -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
        ;;
    *)
        echo "nightly-seed.sh: unknown shape $1 (10k or 100k, or reset)" >&2
        exit 2
        ;;
esac
