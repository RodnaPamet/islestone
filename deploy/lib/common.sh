# shellcheck shell=bash
#
# Shared by deploy/apply.sh, deploy/check-drift.sh and deploy/backup.sh.
#
# Every script does its work ON the VM. Run from a workstation (the default),
# a script ships the deploy bundle to the VM over IAP and runs itself there
# with ON_VM=1; run on the VM (ON_VM=1), it works directly. One code path
# either way, so what the tests exercise (tests/unit/deploy/apply-script.test.ts,
# with a stand-in `docker`) is what runs in production.
#
# Written fresh for Islestone; the transport and the "names, never values"
# reading of the env file follow inflect-compliance's deploy/apply.sh
# (PROVENANCE.md, "Copied: environments and delivery").

# ── Configuration (override through the environment) ───────────────────────
VM_NAME="${VM_NAME:-agrent}"
VM_ZONE="${VM_ZONE:-europe-west1-b}"
VM_PROJECT="${VM_PROJECT:-hazel-design-419410}"
REMOTE_DIR="${REMOTE_DIR:-/opt/islestone}"
ENV_FILE="${ENV_FILE:-${REMOTE_DIR}/.env.prod}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-islestone}"
CADDY_CONTAINER="${CADDY_CONTAINER:-agrent-caddy}"
CADDY_SITES_DIR="${CADDY_SITES_DIR:-/opt/caddy-sites}"
CADDY_SITES_MOUNT="${CADDY_SITES_MOUNT:-/etc/caddy/sites}"
AGRENT_CADDYFILE="${AGRENT_CADDYFILE:-/opt/agrent/Caddyfile}"
SHARED_NETWORK="${SHARED_NETWORK:-agrent_internal}"
SITE_HOST="${SITE_HOST:-islestone.cloud}"
DOCKER="${DOCKER:-docker}"

# The line Agrent's Caddyfile must carry (owner decision 44). Islestone never
# writes it; the runbook in docs/deployment.md does, once, in Agrent's repo.
CADDY_IMPORT_LINE="import ${CADDY_SITES_MOUNT}/*.caddy"

# Required in .env.prod: the `${VAR:?…}` references of the compose file.
REQUIRED_ENV=(
    POSTGRES_PASSWORD APP_DB_PASSWORD REDIS_PASSWORD AUTH_SECRET
    DATA_ENCRYPTION_KEY LOOKUP_HASH_KEY DERIVED_SUBKEY_KEY RATE_LIMIT_MODE
)
# Interpolated into connection URLs, so they must be URL-safe.
URL_SAFE_ENV=(POSTGRES_PASSWORD APP_DB_PASSWORD REDIS_PASSWORD)

if [ -t 1 ]; then C_INFO=$'\033[36m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_OFF=$'\033[0m'
else C_INFO=''; C_WARN=''; C_ERR=''; C_OFF=''; fi
TAG="${TAG:-deploy}"
log()  { printf '%s[%s]%s %s\n' "$C_INFO" "$TAG" "$C_OFF" "$*"; }
warn() { printf '%s[%s] WARN%s %s\n' "$C_WARN" "$TAG" "$C_OFF" "$*" >&2; }
fail() { printf '%s[%s] FAILED%s %s\n' "$C_ERR" "$TAG" "$C_OFF" "$*" >&2; exit 1; }
# A refusal is a precondition the operator must fix; nothing was changed.
refuse() { printf '%s[%s] REFUSED%s %s\n' "$C_ERR" "$TAG" "$C_OFF" "$*" >&2; exit 2; }

# The compose command every script uses: this project, the canonical file in
# REMOTE_DIR, interpolation from .env.prod only.
compose() {
    "$DOCKER" compose -p "$COMPOSE_PROJECT" --project-directory "$REMOTE_DIR" \
        -f "${REMOTE_DIR}/docker-compose.prod.yml" --env-file "$ENV_FILE" "$@"
}

# ── Running on the VM ──────────────────────────────────────────────────────
# Ship the bundle (deploy/ and prisma/init-roles.sh) to a temporary directory
# on the VM and run the named script there as root, forwarding the listed
# variables. gcloud runs with CLOUDSDK_AUTH_ACCESS_TOKEN unset, because a
# placeholder value there overrides the operator's own login, and over IAP,
# because port 22 is not open to the internet.
run_on_vm() {
    local script="$1"; shift
    local forward=""
    local name
    for name in "$@"; do
        if [ -n "${!name:-}" ]; then forward="${forward} ${name}=$(printf '%q' "${!name}")"; fi
    done
    local stage="/tmp/islestone-deploy-$(date +%Y%m%d%H%M%S)-$$"
    log "shipping the deploy bundle to ${VM_NAME}:${stage} and running ${script} there"
    tar czf - -C "$REPO_ROOT" deploy prisma/init-roles.sh |
        env -u CLOUDSDK_AUTH_ACCESS_TOKEN gcloud compute ssh "$VM_NAME" \
            --project "$VM_PROJECT" --zone "$VM_ZONE" --tunnel-through-iap --quiet \
            --command "set -e; mkdir -p ${stage}; tar xzf - -C ${stage}; rc=0; sudo env ON_VM=1${forward} bash ${stage}/deploy/${script} || rc=\$?; rm -rf ${stage}; exit \$rc"
}

# ── Reading .env.prod: names, never values ─────────────────────────────────
# Prints nothing it reads. `env_value NAME` sets ENV_VALUE for a check in this
# process only; callers test it and never echo it.
ENV_VALUE=""
env_value() {
    local name="$1" line
    ENV_VALUE=""
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            "${name}="*)
                ENV_VALUE="${line#*=}"
                # An unquoted value ends at an inline comment.
                ENV_VALUE="${ENV_VALUE%% #*}"
                ENV_VALUE="${ENV_VALUE%\"}"; ENV_VALUE="${ENV_VALUE#\"}"
                ENV_VALUE="${ENV_VALUE%\'}"; ENV_VALUE="${ENV_VALUE#\'}"
                ;;
        esac
    done < "$ENV_FILE"
}

# Refuse unless .env.prod exists, is private, and carries every required
# value in the right shape. Messages name variables, never values.
check_env_file() {
    [ -f "$ENV_FILE" ] || refuse "${ENV_FILE} does not exist. Create it from deploy/.env.prod.example (docs/deployment.md, \"First deploy\")."
    local mode
    mode="$(stat -c '%a' "$ENV_FILE")"
    case "$mode" in
        600|400) ;;
        *) refuse "${ENV_FILE} has mode ${mode}; it holds secrets and must be 600 (chmod 600 ${ENV_FILE})." ;;
    esac
    local missing=() bad=() name
    for name in "${REQUIRED_ENV[@]}"; do
        env_value "$name"
        [ -n "$ENV_VALUE" ] || missing+=("$name")
    done
    [ "${#missing[@]}" -eq 0 ] || refuse "${ENV_FILE} has no value for: ${missing[*]}."
    for name in "${URL_SAFE_ENV[@]}"; do
        env_value "$name"
        [[ "$ENV_VALUE" =~ ^[A-Za-z0-9_-]{24,}$ ]] || bad+=("$name")
    done
    [ "${#bad[@]}" -eq 0 ] || refuse "not URL-safe or shorter than 24 characters: ${bad[*]}. Generate each with: openssl rand -hex 32."
    env_value RATE_LIMIT_MODE
    case "$ENV_VALUE" in
        memory) ;;
        upstash)
            local up
            for up in UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN; do
                env_value "$up"
                [ -n "$ENV_VALUE" ] || refuse "RATE_LIMIT_MODE is upstash but ${up} is empty; set both Upstash values or RATE_LIMIT_MODE=memory."
            done
            ;;
        *) refuse "RATE_LIMIT_MODE must be upstash or memory." ;;
    esac
    ENV_VALUE=""
}

# ── The shared Caddy ───────────────────────────────────────────────────────
# Agrent's Caddyfile must import the sites directory, and agrent-caddy must
# mount CADDY_SITES_DIR there. Islestone installs neither; it refuses until the
# runbook step in docs/deployment.md ("The shared Caddy") has been done.
check_shared_caddy() {
    [ -f "$AGRENT_CADDYFILE" ] || refuse "${AGRENT_CADDYFILE} does not exist; is Agrent deployed on this host?"
    if ! grep -Eq "^[[:space:]]*import[[:space:]]+${CADDY_SITES_MOUNT//\//\\/}/\\*\\.caddy[[:space:]]*(#.*)?$" "$AGRENT_CADDYFILE"; then
        refuse "${AGRENT_CADDYFILE} does not carry the line '${CADDY_IMPORT_LINE}'. Islestone never edits Agrent's Caddyfile: add the line in Agrent's repository and deploy it (docs/deployment.md, \"The shared Caddy\", step 1)."
    fi
    local running
    running="$("$DOCKER" inspect -f '{{.State.Running}}' "$CADDY_CONTAINER" 2>/dev/null || true)"
    [ "$running" = "true" ] || refuse "the container ${CADDY_CONTAINER} is not running."
    local mounts
    mounts="$("$DOCKER" inspect -f '{{range .Mounts}}{{.Source}}:{{.Destination}}:{{.RW}} {{end}}' "$CADDY_CONTAINER")"
    case " ${mounts} " in
        *" ${CADDY_SITES_DIR}:${CADDY_SITES_MOUNT}:false "*) ;;
        *" ${CADDY_SITES_DIR}:${CADDY_SITES_MOUNT}:true "*)
            refuse "${CADDY_CONTAINER} mounts ${CADDY_SITES_DIR} read-write; mount it read-only (docs/deployment.md, \"The shared Caddy\", step 2)." ;;
        *)
            refuse "${CADDY_CONTAINER} does not mount ${CADDY_SITES_DIR} at ${CADDY_SITES_MOUNT}. Add the read-only volume in Agrent's compose file (docs/deployment.md, \"The shared Caddy\", step 2)." ;;
    esac
}

# Every other Watchtower on the host must be scoped, or it would roll
# Islestone's containers too (owner decision 45).
check_other_watchtowers() {
    local line name image config
    while IFS='|' read -r name image; do
        [ -n "$name" ] || continue
        case "$image" in *watchtower*) ;; *) continue ;; esac
        [ "$name" = "islestone-watchtower" ] && continue
        config="$("$DOCKER" inspect -f '{{json .Config.Env}} {{json .Args}}' "$name")"
        case "$config" in
            *WATCHTOWER_SCOPE=*|*'"--scope"'*) ;;
            *) refuse "the Watchtower container ${name} runs without a scope, so it would update Islestone's containers too. Scope it (WATCHTOWER_SCOPE) before deploying (docs/deployment.md, \"Watchtower\")." ;;
        esac
    done < <("$DOCKER" ps --format '{{.Names}}|{{.Image}}')
}
