#!/usr/bin/env bash
#
# deploy/apply.sh — put the repository's production stack on the VM.
#
# The repository is the source of truth for the stack's STRUCTURE. Watchtower
# moves the app, worker and migrate IMAGES; every other change (a service, a
# limit, a variable, the Caddy site) lands in the repository and reaches the
# VM through this script. deploy/check-drift.sh reports any divergence.
#
# WHAT IT INSTALLS
#   deploy/docker-compose.prod.yml        → /opt/islestone/docker-compose.prod.yml
#   prisma/init-roles.sh                  → /opt/islestone/init-roles.sh
#   deploy/postgres/init-runtime-role.sh  → /opt/islestone/init-runtime-role.sh
#   deploy/caddy/islestone.caddy          → /opt/caddy-sites/islestone.caddy
#
# WHAT IT NEVER TOUCHES: /opt/islestone/.env.prod (it reads the variable NAMES
# and checks each value's shape, and prints none), Agrent's Caddyfile, and any
# container outside the `islestone` Compose project except `agrent-caddy`,
# which it asks to validate and reload its configuration.
#
# USAGE (from a workstation signed in to gcloud; the script ships itself to the
# VM over IAP and runs there as root):
#   deploy/apply.sh                 preflight on the VM, print the plan, change nothing
#   CONFIRM=1 deploy/apply.sh       preflight, then apply
#   CADDY_ONLY=1 CONFIRM=1 deploy/apply.sh
#                                   install and reload only the Caddy site
# On the VM itself: ON_VM=1 [CONFIRM=1] bash deploy/apply.sh
#
# PREFLIGHT (always, before anything changes): Docker and Compose answer; the
# shared network exists; agrent-caddy runs, mounts /opt/caddy-sites read-only
# at /etc/caddy/sites, and Agrent's Caddyfile imports that directory; no other
# Watchtower is unscoped; .env.prod is private and complete; the compose file
# interpolates and parses with it; the Caddy site validates on its own.
#
# APPLY (CONFIRM=1): back up the live files, install the new ones, pull,
# `compose up -d` (migrate runs first; app and worker wait for it), wait for
# the app to be healthy, then install the Caddy site, validate Agrent's whole
# configuration with it inside agrent-caddy, and reload Caddy gracefully. A
# site that does not validate, or a reload that fails, is rolled back to the
# previous file and Caddy keeps serving what it served.
#
# Applying recreates the containers whose definition changed: expect a short
# window in which islestone.cloud answers 502. Postgres and Redis keep their
# volumes.
#
# Exit: 0 applied (or preflight passed), 1 failed, 2 refused (nothing changed).
# Written for Islestone (sub-phase 1.8), after inflect-compliance's
# deploy/apply.sh (PROVENANCE.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAG=apply
# shellcheck source=deploy/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

CONFIRM="${CONFIRM:-0}"
CADDY_ONLY="${CADDY_ONLY:-0}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-420}"

if [ "${ON_VM:-0}" != "1" ]; then
    run_on_vm apply.sh CONFIRM CADDY_ONLY HEALTH_TIMEOUT_SECONDS
    exit $?
fi

LOCAL_COMPOSE="${SCRIPT_DIR}/docker-compose.prod.yml"
LOCAL_INIT_ROLES="${REPO_ROOT}/prisma/init-roles.sh"
LOCAL_RUNTIME_ROLE="${SCRIPT_DIR}/postgres/init-runtime-role.sh"
LOCAL_SITE="${SCRIPT_DIR}/caddy/islestone.caddy"
LIVE_SITE="${CADDY_SITES_DIR}/islestone.caddy"
TS="$(date +%Y%m%d-%H%M%S)"

for f in "$LOCAL_COMPOSE" "$LOCAL_INIT_ROLES" "$LOCAL_RUNTIME_ROLE" "$LOCAL_SITE"; do
    [ -f "$f" ] || fail "the bundle is missing ${f}"
done

# ── Preflight ──────────────────────────────────────────────────────────────
log "preflight"
"$DOCKER" version >/dev/null 2>&1 || refuse "docker does not answer."
"$DOCKER" compose version >/dev/null 2>&1 || refuse "the docker compose plugin does not answer."
"$DOCKER" network inspect "$SHARED_NETWORK" >/dev/null 2>&1 \
    || refuse "the network ${SHARED_NETWORK} does not exist; it belongs to Agrent's stack, which must be up first."
check_shared_caddy
check_other_watchtowers
mkdir -p "$REMOTE_DIR"
check_env_file

# Stage the new compose file beside its two init scripts and let Compose
# interpolate and parse it against the real .env.prod. `config --quiet`
# prints nothing, so no value reaches the log.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$LOCAL_COMPOSE" "${STAGE}/docker-compose.prod.yml"
cp "$LOCAL_INIT_ROLES" "${STAGE}/init-roles.sh"
cp "$LOCAL_RUNTIME_ROLE" "${STAGE}/init-runtime-role.sh"
"$DOCKER" compose -p "$COMPOSE_PROJECT" --project-directory "$STAGE" \
    -f "${STAGE}/docker-compose.prod.yml" --env-file "$ENV_FILE" config --quiet \
    || refuse "deploy/docker-compose.prod.yml does not interpolate or parse with ${ENV_FILE} (see the message above)."

# Validate the site on its own, inside the Caddy that will serve it, without
# touching the live configuration. The whole configuration is validated again
# at apply time, with the site in place, before any reload.
"$DOCKER" exec -i "$CADDY_CONTAINER" sh -c 'mkdir -p /tmp/islestone-preflight && cat > /tmp/islestone-preflight/islestone.caddy' < "$LOCAL_SITE"
if ! "$DOCKER" exec "$CADDY_CONTAINER" caddy validate --config /tmp/islestone-preflight/islestone.caddy --adapter caddyfile >/dev/null 2>"${STAGE}/caddy-validate.err"; then
    cat "${STAGE}/caddy-validate.err" >&2
    refuse "deploy/caddy/islestone.caddy does not validate in ${CADDY_CONTAINER}."
fi

log "preflight passed"
plan_diff() {
    local live="$1" new="$2" label="$3"
    if [ ! -f "$live" ]; then
        log "  ${label}: new"
    elif cmp -s "$live" "$new"; then
        log "  ${label}: unchanged"
    else
        log "  ${label}: changed"
        diff -u "$live" "$new" | sed 's/^/      /' || true
    fi
}
log "plan:"
if [ "$CADDY_ONLY" != "1" ]; then
    plan_diff "${REMOTE_DIR}/docker-compose.prod.yml" "$LOCAL_COMPOSE" "${REMOTE_DIR}/docker-compose.prod.yml"
    plan_diff "${REMOTE_DIR}/init-roles.sh" "$LOCAL_INIT_ROLES" "${REMOTE_DIR}/init-roles.sh"
    plan_diff "${REMOTE_DIR}/init-runtime-role.sh" "$LOCAL_RUNTIME_ROLE" "${REMOTE_DIR}/init-runtime-role.sh"
fi
plan_diff "$LIVE_SITE" "$LOCAL_SITE" "$LIVE_SITE"

if [ "$CONFIRM" != "1" ]; then
    log "nothing changed. Re-run with CONFIRM=1 to apply."
    exit 0
fi

# ── Apply ──────────────────────────────────────────────────────────────────
BACKUP_DIR="${REMOTE_DIR}/backups/config-${TS}"
mkdir -p "$BACKUP_DIR"
for f in docker-compose.prod.yml init-roles.sh init-runtime-role.sh; do
    if [ -f "${REMOTE_DIR}/${f}" ]; then cp -p "${REMOTE_DIR}/${f}" "${BACKUP_DIR}/${f}"; fi
done
if [ -f "$LIVE_SITE" ]; then cp -p "$LIVE_SITE" "${BACKUP_DIR}/islestone.caddy"; fi
log "backed up the live files to ${BACKUP_DIR}"

if [ "$CADDY_ONLY" != "1" ]; then
    install -m 0644 "$LOCAL_COMPOSE" "${REMOTE_DIR}/docker-compose.prod.yml"
    install -m 0755 "$LOCAL_INIT_ROLES" "${REMOTE_DIR}/init-roles.sh"
    install -m 0755 "$LOCAL_RUNTIME_ROLE" "${REMOTE_DIR}/init-runtime-role.sh"
    log "installed the compose file and the init scripts in ${REMOTE_DIR}"

    log "pulling images"
    compose pull --quiet
    log "starting the stack (migrate runs first)"
    if ! compose up -d --remove-orphans; then
        fail "docker compose up failed. If migrate failed: docker logs islestone-migrate. The previous compose file is in ${BACKUP_DIR}."
    fi

    log "waiting up to ${HEALTH_TIMEOUT_SECONDS}s for islestone-app to be healthy"
    deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
    while :; do
        status="$("$DOCKER" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' islestone-app 2>/dev/null || echo missing)"
        if [ "$status" = "healthy" ]; then break; fi
        if [ "$(date +%s)" -ge "$deadline" ]; then fail "islestone-app is '${status}' after ${HEALTH_TIMEOUT_SECONDS}s (docker logs islestone-app). The Caddy site was not changed."; fi
        sleep 5
    done
    log "islestone-app is healthy"
fi

# Install the site, validate the whole configuration with it, reload. Any
# failure puts the previous file back (or removes a first one).
restore_site() {
    if [ -f "${BACKUP_DIR}/islestone.caddy" ]; then
        install -m 0644 "${BACKUP_DIR}/islestone.caddy" "$LIVE_SITE"
    else
        rm -f "$LIVE_SITE"
    fi
}
mkdir -p "$CADDY_SITES_DIR"
install -m 0644 "$LOCAL_SITE" "$LIVE_SITE"
if ! "$DOCKER" exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    restore_site
    fail "the shared Caddy configuration does not validate with the new site; the previous site file is back and Caddy was not reloaded."
fi
if ! "$DOCKER" exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    restore_site
    "$DOCKER" exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
    fail "caddy reload failed; the previous site file is back and Caddy was reloaded with it."
fi
log "Caddy reloaded with ${LIVE_SITE}"

# The certificate is issued on the first request, so the first run can see a
# TLS error here for a few seconds; that is a warning, not a failure.
if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 20 --resolve "${SITE_HOST}:443:127.0.0.1" "https://${SITE_HOST}/api/readyz" >/dev/null 2>&1; then
        log "https://${SITE_HOST}/api/readyz answers through Caddy"
    else
        warn "https://${SITE_HOST}/api/readyz did not answer through Caddy yet; check DNS and the certificate (docker logs ${CADDY_CONTAINER})."
    fi
fi
log "applied"
