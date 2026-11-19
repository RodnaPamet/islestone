#!/bin/bash
# Postgres entrypoint init script, production only (deploy/docker-compose.prod.yml
# mounts it as /docker-entrypoint-initdb.d/02-runtime-role.sh, after
# prisma/init-roles.sh). Like every initdb script it runs on the first start
# of a fresh volume and never again.
#
# It creates the role the application CONNECTS as: a login role that is not
# a superuser, cannot bypass row-level security, cannot create databases or
# roles, and is a member of `app_user` (docs/rls-tenant-isolation.md, "The
# role model"). Migrations still run as POSTGRES_USER, the superuser that owns
# the tables, from the one-shot `migrate` service; the app, the worker and
# PgBouncer only ever see this role and its password.
#
# Inheriting `app_user` gives it exactly the table privileges the migrations
# grant, and nothing more: no TRUNCATE, no DDL, no UPDATE or DELETE on the
# audit trails. Without `SET ROLE app_user` the `superuser_bypass` policy
# admits it (the pre-tenant paths: sign-in, invites, sweeps), as it admits
# any session whose role is not app_user; with it, tenant isolation applies.
#
# The password is read with psql's \getenv, so it never appears in a process
# argument list. Generate it URL-safe (openssl rand -hex 32): Compose builds
# the connection URLs from it.
#
# Usage outside the image (a role created by hand, or the integration test):
#   APP_DB_PASSWORD=… [APP_DB_USER=islestone_app] POSTGRES_USER=… POSTGRES_DB=… \
#     PGHOST=… PGPORT=… PGPASSWORD=… bash deploy/postgres/init-runtime-role.sh
set -euo pipefail

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required: the password of the runtime role (openssl rand -hex 32)}"
export APP_DB_USER="${APP_DB_USER:-islestone_app}"
export APP_DB_PASSWORD

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
    \getenv runtime_role APP_DB_USER
    \getenv runtime_password APP_DB_PASSWORD

    -- app_user normally exists already (prisma/init-roles.sh runs first);
    -- created here too so this script stands on its own.
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
      END IF;
    END
    $$;

    SELECT format(
        'CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
        :'runtime_role', :'runtime_password')
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'runtime_role') \gexec

    -- An existing role is brought back to the same shape, so re-running the
    -- script (by hand, after a password rotation) converges rather than fails.
    SELECT format(
        'ALTER ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
        :'runtime_role', :'runtime_password') \gexec

    SELECT format('GRANT app_user TO %I', :'runtime_role') \gexec
    SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_role') \gexec
    SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_role') \gexec
EOSQL
