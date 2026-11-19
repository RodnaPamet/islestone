#!/usr/bin/env bash
#
# deploy/backup.sh — a pg_dump of Islestone's database, and the restore drill.
#
#   deploy/backup.sh                          take a backup (custom format) into
#                                             /opt/islestone/backups/db, verify
#                                             it lists, keep the newest BACKUP_KEEP
#   RESTORE_DRILL=1 deploy/backup.sh          restore the newest backup (or
#                                             BACKUP_FILE) into a scratch database
#                                             in the same Postgres, compare it with
#                                             the live one, then drop it
#
# Run from a workstation (over IAP, as root on the VM) or on the VM with
# ON_VM=1. The dump is taken inside islestone-postgres as the database
# superuser, through its local socket: no password crosses a command line and
# nothing reads .env.prod. Each file is mode 600 under a mode-700 directory.
#
# A backup on the VM's own disk does not survive the loss of the VM. Copying
# it off the host is a step of the runbook (docs/deployment.md, "Backups and
# the restore drill") until the owner picks a destination.
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

RESTORE_DRILL="${RESTORE_DRILL:-0}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
BACKUP_DIR="${BACKUP_DIR:-${REMOTE_DIR}/backups/db}"
PG_CONTAINER="${PG_CONTAINER:-islestone-postgres}"
PG_USER="${PG_USER:-islestone}"
PG_DB="${PG_DB:-islestone}"
DRILL_DB="${DRILL_DB:-islestone_restore_drill}"

if [ "${ON_VM:-0}" != "1" ]; then
    run_on_vm backup.sh RESTORE_DRILL BACKUP_KEEP BACKUP_FILE
    exit $?
fi

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
    # Retention: the newest BACKUP_KEEP files.
    ls -1t "${BACKUP_DIR}"/islestone-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
        rm -f "$old"; log "removed ${old} (keeping ${BACKUP_KEEP})"
    done
    exit 0
fi

# ── Restore drill ──────────────────────────────────────────────────────────
file="${BACKUP_FILE:-$(ls -1t "${BACKUP_DIR}"/islestone-*.dump 2>/dev/null | head -n 1 || true)}"
[ -n "$file" ] && [ -f "$file" ] || fail "no backup to restore in ${BACKUP_DIR}; take one first (deploy/backup.sh)."
log "restore drill: ${file} into the scratch database ${DRILL_DB}"

cleanup() { psql_in -d postgres -c "DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
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
