#!/usr/bin/env bash
#
# deploy/backup.sh — a pg_dump of Islestone's database, its off-host copy, and
# the restore drill.
#
#   deploy/backup.sh                          take a backup (custom format) into
#                                             /opt/islestone/backups/db, verify
#                                             it lists, upload it to the GCS
#                                             bucket, keep the newest BACKUP_KEEP
#   deploy/backup.sh --bucket gs://NAME       the same, naming the bucket
#   RESTORE_DRILL=1 deploy/backup.sh          restore the newest local backup (or
#                                             BACKUP_FILE) into a scratch database
#                                             in the same Postgres, compare it with
#                                             the live one, then drop it
#   RESTORE_DRILL=1 BACKUP_SOURCE=gcs deploy/backup.sh
#                                             the drill from the newest copy in the
#                                             bucket (or BACKUP_FILE=gs://…)
#
# Run from a workstation (over IAP, as root on the VM) or on the VM with
# ON_VM=1. The dump is taken inside islestone-postgres as the database
# superuser, through its local socket: no password crosses a command line.
# Each file is mode 600 under a mode-700 directory.
#
# OFF-HOST COPY (owner decision 48, 2026-11-19). A backup on the VM's disk
# does not survive the loss of the VM, so each kept dump is uploaded with
# `gcloud storage cp`, as the VM's own service account (no key file), to
# gs://BUCKET/db/<file>. The bucket is private, versioned and deletes old and
# noncurrent objects after 30 days (deploy/gcs/backup-lifecycle.json); the
# account may create objects and read them back for the drill, never delete
# them (docs/deployment.md, "Off-host copies"). The bucket comes from
# --bucket, else BACKUP_GCS_BUCKET in the environment, else BACKUP_GCS_BUCKET
# in /opt/islestone/.env.prod (the one value this script reads from it). With
# no bucket configured the upload is skipped with a warning and the local copy
# still counts; a configured upload that fails is a failure (exit 1), the
# local copy kept.
#
# The drill is what Hardening H1 asks for ("a restore performed once and
# documented"): it proves a file restores into a working schema, with the
# migrations table, every table and the row-level-security policies present.
# It never touches the live database.
#
# Exit: 0 done, 1 failed. Written fresh for Islestone (sub-phase 1.8).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAG=backup
# shellcheck source=deploy/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# --bucket gs://NAME (or NAME) sets BACKUP_GCS_BUCKET, so it is forwarded to
# the VM like the environment variable.
while [ "$#" -gt 0 ]; do
    case "$1" in
        --bucket) BACKUP_GCS_BUCKET="${2:-}"; shift 2 ;;
        --bucket=*) BACKUP_GCS_BUCKET="${1#--bucket=}"; shift ;;
        *) fail "unknown argument: $1 (usage: deploy/backup.sh [--bucket gs://NAME])" ;;
    esac
done

RESTORE_DRILL="${RESTORE_DRILL:-0}"
BACKUP_SOURCE="${BACKUP_SOURCE:-local}"
GCLOUD="${GCLOUD:-gcloud}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
BACKUP_DIR="${BACKUP_DIR:-${REMOTE_DIR}/backups/db}"
PG_CONTAINER="${PG_CONTAINER:-islestone-postgres}"
PG_USER="${PG_USER:-islestone}"
PG_DB="${PG_DB:-islestone}"
DRILL_DB="${DRILL_DB:-islestone_restore_drill}"

if [ "${ON_VM:-0}" != "1" ]; then
    run_on_vm backup.sh RESTORE_DRILL BACKUP_KEEP BACKUP_FILE BACKUP_GCS_BUCKET BACKUP_SOURCE
    exit $?
fi

# The bucket, as a bare name: from the flag or the environment, else from
# .env.prod. A malformed name is refused rather than guessed at.
resolve_bucket() {
    local bucket="${BACKUP_GCS_BUCKET:-}"
    if [ -z "$bucket" ] && [ -r "$ENV_FILE" ]; then
        env_value BACKUP_GCS_BUCKET
        bucket="$ENV_VALUE"
        ENV_VALUE=""
    fi
    bucket="${bucket#gs://}"
    bucket="${bucket%/}"
    if [ -n "$bucket" ] && ! [[ "$bucket" =~ ^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$ ]]; then
        fail "BACKUP_GCS_BUCKET is not a bucket name: ${bucket}"
    fi
    BUCKET="$bucket"
}
BUCKET=""
resolve_bucket

psql_in() { "$DOCKER" exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -X -q -At -U "$PG_USER" "$@"; }

if [ "$RESTORE_DRILL" != "1" ]; then
    install -d -m 0700 "$BACKUP_DIR"
    file="${BACKUP_DIR}/islestone-$(date -u +%Y%m%dT%H%M%SZ).dump"
    log "dumping ${PG_DB} to ${file}"
    umask 077
    if ! "$DOCKER" exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom --compress=6 > "${file}.partial"; then
        rm -f "${file}.partial"
        fail "pg_dump failed"
    fi
    # A file that does not list is not a backup.
    entries="$("$DOCKER" exec -i "$PG_CONTAINER" pg_restore --list < "${file}.partial" | grep -c ' TABLE DATA ' || true)"
    [ "${entries:-0}" -gt 0 ] || { rm -f "${file}.partial"; fail "the dump lists no table data; not kept"; }
    mv "${file}.partial" "$file"
    chmod 600 "$file"
    log "kept ${file} ($(du -h "$file" | cut -f1), ${entries} tables with data)"
    # The off-host copy, before local retention can remove anything.
    if [ -z "$BUCKET" ]; then
        warn "BACKUP_GCS_BUCKET is not configured: the backup stays on this VM only and does not survive its loss (docs/deployment.md, \"Off-host copies\")."
    else
        object="gs://${BUCKET}/db/$(basename "$file")"
        if ! "$GCLOUD" storage cp --quiet "$file" "$object"; then
            fail "the upload to ${object} failed; the local copy ${file} is kept. Check the VM's access to the bucket (docs/deployment.md, \"Off-host copies\")."
        fi
        log "uploaded ${object}"
    fi
    # Retention: the newest BACKUP_KEEP files.
    ls -1t "${BACKUP_DIR}"/islestone-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
        rm -f "$old"; log "removed ${old} (keeping ${BACKUP_KEEP})"
    done
    exit 0
fi

# ── Restore drill ──────────────────────────────────────────────────────────
# From the bucket: BACKUP_FILE=gs://… names one object; BACKUP_SOURCE=gcs takes
# the newest under gs://BUCKET/db/ (the names carry a UTC timestamp, so the
# greatest name is the newest). It is downloaded to a private temporary file
# that is removed on exit.
DOWNLOADED=""
case "${BACKUP_FILE:-}" in
    gs://*) source_object="$BACKUP_FILE" ;;
    *) source_object="" ;;
esac
if [ -z "$source_object" ] && [ "$BACKUP_SOURCE" = "gcs" ]; then
    [ -n "$BUCKET" ] || fail "BACKUP_SOURCE=gcs needs a bucket (--bucket, or BACKUP_GCS_BUCKET)."
    source_object="$("$GCLOUD" storage ls "gs://${BUCKET}/db/" | grep -E '/islestone-[0-9TZ]+\.dump$' | sort | tail -n 1 || true)"
    [ -n "$source_object" ] || fail "no backup in gs://${BUCKET}/db/."
fi
if [ -n "$source_object" ]; then
    install -d -m 0700 "$BACKUP_DIR"
    DOWNLOADED="$(umask 077; mktemp "${BACKUP_DIR}/drill-XXXXXX.dump")"
    "$GCLOUD" storage cp --quiet "$source_object" "$DOWNLOADED" || fail "could not download ${source_object}."
    file="$DOWNLOADED"
    log "downloaded ${source_object} for the drill"
else
    file="${BACKUP_FILE:-$(ls -1t "${BACKUP_DIR}"/islestone-*.dump 2>/dev/null | head -n 1 || true)}"
fi
[ -n "$file" ] && [ -f "$file" ] || fail "no backup to restore in ${BACKUP_DIR}; take one first (deploy/backup.sh)."
log "restore drill: ${source_object:-$file} into the scratch database ${DRILL_DB}"

drop_drill_db() { psql_in -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)" >/dev/null 2>&1 || true; }
cleanup() {
    drop_drill_db
    if [ -n "$DOWNLOADED" ]; then rm -f "$DOWNLOADED"; fi
}
trap cleanup EXIT
drop_drill_db
psql_in -d postgres -c "CREATE DATABASE ${DRILL_DB}"
started="$(date +%s)"
"$DOCKER" exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$DRILL_DB" --exit-on-error --no-owner < "$file" \
    || fail "pg_restore failed; the backup does not restore."
log "restored in $(( $(date +%s) - started ))s"

# Compare the restored database with the live one: the newest applied
# migration, every table's existence and its forced row-level security, and
# row counts (the live counts can only have grown since the dump).
summary() {
    psql_in -d "$1" <<'SQL'
SELECT 'migration_head=' || coalesce(max(migration_name), '') FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT 'tables=' || count(*) FROM pg_tables WHERE schemaname = 'public';
SELECT 'rls_forced=' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity;
SELECT 'policies=' || count(*) FROM pg_policies WHERE schemaname = 'public';
SELECT 'triggers=' || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal;
SQL
}
restored="$(summary "$DRILL_DB")"
live="$(summary "$PG_DB")"
log "restored: $(echo "$restored" | tr '\n' ' ')"
log "live:     $(echo "$live" | tr '\n' ' ')"
[ "$restored" = "$live" ] || warn "the restored structure differs from the live one; a migration may have run since the dump. Read the two lines above."

counts() {
    psql_in -d "$1" <<'SQL'
SELECT format('SELECT %L || ''='' || count(*) FROM %I.%I;', tablename, schemaname, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename \gexec
SQL
}
log "row counts (restored | live):"
paste -d'|' <(counts "$DRILL_DB") <(counts "$PG_DB") | sed 's/^/      /'

# The audit chain must have restored whole: every AuditLog row's previous hash
# is another row's hash in the same workspace, or it is the workspace's first.
broken="$(psql_in -d "$DRILL_DB" -c 'SELECT count(*) FROM "AuditLog" a WHERE a."previousHash" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AuditLog" b WHERE b."tenantId" = a."tenantId" AND b."entryHash" = a."previousHash")' 2>/dev/null || echo unknown)"
case "$broken" in
    0) log "audit chain links intact in the restored copy" ;;
    unknown) warn "could not read the audit chain links in the restored copy" ;;
    *) fail "${broken} audit entries point at a previous hash the restored copy does not hold" ;;
esac
log "restore drill passed; ${DRILL_DB} is dropped on exit. Record the result in docs/deployment.md (\"Restore drills\")."
