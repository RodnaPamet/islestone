#!/usr/bin/env bash
# Start or stop the built app for the latency harness (Hardening H2b;
# docs/performance.md, "Latency").
#
#   scripts/perf/serve.sh start   # the standalone server in the background, ready before it returns
#   scripts/perf/serve.sh stop
#
# The server is the one the app image runs (scripts/start-standalone.mjs,
# `npm run build` first), on ${PERF_PORT:-3100}, against DATABASE_URL (the
# seeded database through PgBouncer), REDIS_URL and DATA_ENCRYPTION_KEY,
# which must be the key the seed was written under (a workspace's data key is
# wrapped by it, and sign-in matches the seed's email hashes). Rate limits are
# off (RATE_LIMIT_ENABLED=0: 200 samples a minute would trip the read tier),
# in memory as production runs them; nothing else is a test mode. Its log is
# ${PERF_SERVER_LOG:-perf-report/server.log}.
set -euo pipefail

port="${PERF_PORT:-3100}"
log="${PERF_SERVER_LOG:-perf-report/server.log}"
pidfile="${PERF_SERVER_PID:-.perf-cache/server.pid}"

case "${1:-}" in
    start)
        : "${DATABASE_URL:?DATABASE_URL (the seeded database) is required}"
        : "${REDIS_URL:?REDIS_URL is required}"
        : "${DATA_ENCRYPTION_KEY:?DATA_ENCRYPTION_KEY (the key the seed was written under) is required}"
        : "${AUTH_SECRET:?AUTH_SECRET is required}"
        origin="http://127.0.0.1:${port}"
        mkdir -p "$(dirname "$log")" "$(dirname "$pidfile")"
        HOSTNAME=127.0.0.1 PORT="$port" NEXTAUTH_URL="$origin" APP_URL="$origin" \
            NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-$origin}" \
            RATE_LIMIT_MODE=memory RATE_LIMIT_ENABLED=0 NEXT_TELEMETRY_DISABLED=1 LOG_LEVEL="${LOG_LEVEL:-warn}" \
            nohup node scripts/start-standalone.mjs >"$log" 2>&1 &
        echo $! >"$pidfile"
        for _ in $(seq 1 90); do
            if curl -sf "${origin}/api/readyz" >/dev/null; then
                echo "serve.sh: ready on ${origin}"
                exit 0
            fi
            if ! kill -0 "$(cat "$pidfile")" 2>/dev/null; then break; fi
            sleep 1
        done
        echo "serve.sh: the server did not become ready; its log:" >&2
        cat "$log" >&2
        exit 1
        ;;
    stop)
        if [ -f "$pidfile" ]; then
            kill "$(cat "$pidfile")" 2>/dev/null || true
            rm -f "$pidfile"
        fi
        ;;
    *)
        echo "usage: scripts/perf/serve.sh start|stop" >&2
        exit 2
        ;;
esac
