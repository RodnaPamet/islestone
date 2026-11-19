#!/bin/bash
# Docker entrypoint init script for Postgres (docker-compose.yml mounts it
# into /docker-entrypoint-initdb.d). It runs on the first start of a fresh
# volume.
#
# It creates the NOLOGIN role `app_user` that runInTenantContext switches to
# (`SET LOCAL ROLE app_user`) so row-level security applies, and makes the
# login role a member of it, without which `SET ROLE` fails. The migrations
# also create the role if it is missing, but they never name a login role:
# granting it to one is this script's job here and the CI step's in CI.

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
        RAISE NOTICE 'Created role app_user';
      END IF;
    END
    \$\$;

    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
    GRANT app_user TO "$POSTGRES_USER";
EOSQL
