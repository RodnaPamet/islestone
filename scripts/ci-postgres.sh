#!/usr/bin/env bash
# Build Islestone's Postgres image and run it for a CI job (sub-phase 2.7f,
# owner decision 146).
#
#   scripts/ci-postgres.sh <database> [--pgbouncer]
#
# CI's Integration, E2E and DAST jobs run their database from THIS pull
# request's deploy/postgres/Dockerfile, so every change to it is tested before
# it is published (a `services:` container starts before checkout and can only
# pull an image). It starts:
#
#   - islestone-ci-postgres on 127.0.0.1:${PG_PORT:-5432}, the built image,
#     running prisma/init-roles.sh on its fresh volume (app_user, and the
#     login role a member of it), healthy before this script returns;
#   - with --pgbouncer, islestone-ci-pgbouncer on 127.0.0.1:${PGBOUNCER_PORT:-6432}
#     in transaction mode in front of it, as production runs.
#
# Credentials are CI's throwaway values. Also usable locally with other ports:
#   PG_PORT=55432 PGBOUNCER_PORT=56432 scripts/ci-postgres.sh islestone_test --pgbouncer
set -euo pipefail

db="${1:?usage: scripts/ci-postgres.sh <database> [--pgbouncer]}"
with_bouncer=0
if [ "${2:-}" = "--pgbouncer" ]; then with_bouncer=1; fi

root="$(cd "$(dirname "$0")/.." && pwd)"
image="islestone-postgres:ci"
network="islestone-ci"
user="${PG_USER:-islestone}"
password="${PG_PASSWORD:-islestone_ci}" # pragma: allowlist secret — CI's throwaway value, as ci.yml's URLs
pgbouncer_image="edoburu/pgbouncer:v1.26.1-p0"

docker build --quiet -t "$image" "$root/deploy/postgres" >/dev/null
docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null

docker run -d --name islestone-ci-postgres --network "$network" --network-alias postgres \
    -p "127.0.0.1:${PG_PORT:-5432}:5432" \
    -e POSTGRES_USER="$user" -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB="$db" \
    -v "$root/prisma/init-roles.sh:/docker-entrypoint-initdb.d/01-init-roles.sh:ro" \
    --health-cmd "pg_isready -h 127.0.0.1 -U $user -d $db" --health-interval 2s --health-timeout 5s --health-retries 90 \
    "$image" >/dev/null

wait_healthy() { # wait_healthy <container> <what>
    for _ in $(seq 1 90); do
        case "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null || echo missing)" in
            healthy) return 0 ;;
            unhealthy | missing) break ;;
        esac
        sleep 2
    done
    echo "ci-postgres: $2 did not become healthy; its log:" >&2
    docker logs "$1" >&2 || true
    exit 1
}
wait_healthy islestone-ci-postgres "Postgres"

# The image's own check: the dictionary the migration needs is present.
docker exec islestone-ci-postgres sh -c 'test -s "$(pg_config --sharedir)/tsearch_data/bulgarian.dict"' \
    || { echo "ci-postgres: the image carries no Bulgarian dictionary" >&2; exit 1; }

if [ "$with_bouncer" = 1 ]; then
    docker run -d --name islestone-ci-pgbouncer --network "$network" \
        -p "127.0.0.1:${PGBOUNCER_PORT:-6432}:5432" \
        -e DB_HOST=postgres -e DB_PORT=5432 -e DB_USER="$user" -e DB_PASSWORD="$password" -e DB_NAME="$db" \
        -e AUTH_TYPE=scram-sha-256 -e POOL_MODE=transaction -e MAX_CLIENT_CONN=200 \
        -e DEFAULT_POOL_SIZE=20 -e MAX_PREPARED_STATEMENTS=100 \
        --health-cmd "pg_isready -h 127.0.0.1 -p 5432" --health-interval 2s --health-timeout 5s --health-retries 30 \
        "$pgbouncer_image" >/dev/null
    wait_healthy islestone-ci-pgbouncer "PgBouncer"
fi

echo "ci-postgres: ${db} ready on 127.0.0.1:${PG_PORT:-5432}$([ "$with_bouncer" = 1 ] && echo ", PgBouncer on 127.0.0.1:${PGBOUNCER_PORT:-6432}")"
