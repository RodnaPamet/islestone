#!/usr/bin/env bash
#
# deploy/check-drift.sh — does the VM run what the repository says?
#
# Read-only. Compares each file deploy/apply.sh installs with its repository
# copy, and checks the parts of the host Islestone depends on but does not own:
# the import line in Agrent's Caddyfile, agrent-caddy's read-only mount of the
# sites directory, the shared network, the scoping of every other Watchtower,
# and that the running containers are the ones the compose file declares.
# It never reads a value from .env.prod and never prints one; it reports the
# NAMES the compose file needs that the env file lacks.
#
# Usage: deploy/check-drift.sh            (from a workstation, over IAP)
#        ON_VM=1 bash deploy/check-drift.sh (on the VM)
#
# Exit: 0 in step, 1 drift found (each finding is printed), 2 could not check.
# Written for Islestone (sub-phase 1.8), after inflect-compliance's
# deploy/check-drift.sh (PROVENANCE.md).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAG=drift
# shellcheck source=deploy/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

if [ "${ON_VM:-0}" != "1" ]; then
    run_on_vm check-drift.sh
    exit $?
fi

"$DOCKER" version >/dev/null 2>&1 || { warn "docker does not answer"; exit 2; }

DRIFT=0
drift() { warn "DRIFT: $*"; DRIFT=1; }
ok() { log "ok: $*"; }

compare() {
    local repo="$1" live="$2"
    if [ ! -f "$live" ]; then
        drift "${live} is missing (repository: ${repo#"${REPO_ROOT}"/})"
    elif cmp -s "$repo" "$live"; then
        ok "${live} matches ${repo#"${REPO_ROOT}"/}"
    else
        drift "${live} differs from ${repo#"${REPO_ROOT}"/}:"
        diff -u "$live" "$repo" | sed 's/^/      /'
    fi
}

compare "${SCRIPT_DIR}/docker-compose.prod.yml" "${REMOTE_DIR}/docker-compose.prod.yml"
compare "${REPO_ROOT}/prisma/init-roles.sh" "${REMOTE_DIR}/init-roles.sh"
compare "${SCRIPT_DIR}/postgres/init-runtime-role.sh" "${REMOTE_DIR}/init-runtime-role.sh"
compare "${SCRIPT_DIR}/caddy/islestone.caddy" "${CADDY_SITES_DIR}/islestone.caddy"

# The host pieces the refusals in apply.sh guard, checked here without exiting.
( check_shared_caddy ) 2>/tmp/islestone-drift.$$ && ok "Agrent's Caddyfile imports ${CADDY_SITES_MOUNT} and ${CADDY_CONTAINER} mounts it read-only" \
    || drift "$(sed 's/^.*REFUSED[^ ]* //' /tmp/islestone-drift.$$)"
( check_other_watchtowers ) 2>/tmp/islestone-drift.$$ && ok "every other Watchtower is scoped" \
    || drift "$(sed 's/^.*REFUSED[^ ]* //' /tmp/islestone-drift.$$)"
rm -f /tmp/islestone-drift.$$
"$DOCKER" network inspect "$SHARED_NETWORK" >/dev/null 2>&1 && ok "network ${SHARED_NETWORK} exists" \
    || drift "network ${SHARED_NETWORK} does not exist"

if [ -f "$ENV_FILE" ]; then
    missing=()
    for name in "${REQUIRED_ENV[@]}"; do
        env_value "$name"
        [ -n "$ENV_VALUE" ] || missing+=("$name")
    done
    ENV_VALUE=""
    if [ "${#missing[@]}" -eq 0 ]; then ok "${ENV_FILE} has every required name"; else drift "${ENV_FILE} lacks: ${missing[*]}"; fi
    mode="$(stat -c '%a' "$ENV_FILE")"
    case "$mode" in 600|400) ok "${ENV_FILE} is private (${mode})" ;; *) drift "${ENV_FILE} has mode ${mode}, not 600" ;; esac
else
    drift "${ENV_FILE} does not exist"
fi

# Running containers against the declared services: one container per
# long-running service, and nothing else in the project.
declared="islestone-app islestone-pgbouncer islestone-postgres islestone-redis islestone-watchtower islestone-worker"
running="$("$DOCKER" ps --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" --format '{{.Names}}' | grep -v '^islestone-migrate$' | sort | tr '\n' ' ' | sed 's/ $//')"
if [ "$running" = "$declared" ]; then
    ok "running: ${running}"
else
    drift "running containers are '${running}', expected '${declared}'"
fi
for name in $declared; do
    health="$("$DOCKER" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo missing)"
    case "$health" in healthy|none) ;; *) drift "${name} is ${health}" ;; esac
done

if [ "$DRIFT" -eq 0 ]; then log "no drift"; exit 0; fi
warn "drift found; deploy/apply.sh brings the VM back to the repository"
exit 1
