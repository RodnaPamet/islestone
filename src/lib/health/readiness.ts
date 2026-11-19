/**
 * Readiness: "should this replica receive traffic?" (`/api/readyz`).
 *
 * Checks the two dependencies every request path needs: PostgreSQL (through
 * the app's own client, so the probe uses the connection the app uses:
 * PgBouncer in production) and Redis (the job queue, the worker heartbeat
 * and, with `RATE_LIMIT_MODE=memory`, nothing else; with Upstash, the rate
 * limits are a separate REST store and are not checked here).
 *
 * Shape and rules ported from inflect-compliance `src/app/api/readyz/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (pattern; Islestone has no
 * storage backend, so the S3 check is not taken, and the checks live in this
 * module so the route handler holds no data access):
 *
 *   - Each check has its own timeout (CHECK_TIMEOUT_MS) and they run in
 *     parallel, so a hung dependency answers `timeout` within about two
 *     seconds instead of hanging the probe.
 *   - Error strings come from a closed set. A database driver's error message
 *     can carry the host, the port and the role; none of it reaches the body.
 *   - Redis is `skipped` when REDIS_URL is unset outside production. In
 *     production an unset REDIS_URL is a misconfiguration that got past the
 *     env schema (SKIP_ENV_VALIDATION leaking into the runtime), and the
 *     probe says `error` rather than a false "ready".
 *   - The probe never throws: every failure is a structured result.
 *
 * The production Compose file (deploy/docker-compose.prod.yml) points the
 * app container's healthcheck at `/api/readyz`, so `docker ps` shows a
 * replica that cannot reach its database as unhealthy.
 */

export const CHECK_TIMEOUT_MS = 2000;

export type CheckStatus = 'ok' | 'error' | 'skipped';

/** The closed set of error strings a check may report. */
export type CheckError = 'timeout' | 'connection_failed' | 'ping_failed' | 'unexpected_reply' | 'not_configured';

export interface CheckResult {
    readonly status: CheckStatus;
    readonly latencyMs: number;
    readonly error?: CheckError;
}

export interface ReadinessDeps {
    /** Runs `SELECT 1` (or equivalent) against the database. */
    readonly queryDatabase: () => Promise<unknown>;
    /** Pings Redis and returns its reply; `null` when REDIS_URL is unset. */
    readonly pingRedis: (() => Promise<string>) | null;
    /** NODE_ENV is production. */
    readonly production: boolean;
    /** The build being served (BUILD_SHA), or `dev`. */
    readonly version: string;
    /** Override for tests. */
    readonly timeoutMs?: number;
}

export interface ReadinessReport {
    readonly status: 'ready' | 'not_ready';
    readonly version: string;
    readonly checks: { readonly database: CheckResult; readonly redis: CheckResult };
    readonly failed: readonly string[];
    readonly latencyMs: number;
}

const TIMEOUT = Symbol('timeout');

/** Resolve the promise, or reject with TIMEOUT after `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(TIMEOUT), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function checkDatabase(deps: ReadinessDeps, ms: number): Promise<CheckResult> {
    const start = Date.now();
    try {
        await withTimeout(deps.queryDatabase(), ms);
        return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err) {
        return { status: 'error', latencyMs: Date.now() - start, error: err === TIMEOUT ? 'timeout' : 'connection_failed' };
    }
}

async function checkRedis(deps: ReadinessDeps, ms: number): Promise<CheckResult> {
    if (!deps.pingRedis) {
        return deps.production
            ? { status: 'error', latencyMs: 0, error: 'not_configured' }
            : { status: 'skipped', latencyMs: 0 };
    }
    const start = Date.now();
    try {
        const reply = await withTimeout(deps.pingRedis(), ms);
        if (reply !== 'PONG') return { status: 'error', latencyMs: Date.now() - start, error: 'unexpected_reply' };
        return { status: 'ok', latencyMs: Date.now() - start };
    } catch (err) {
        return { status: 'error', latencyMs: Date.now() - start, error: err === TIMEOUT ? 'timeout' : 'ping_failed' };
    }
}

/** Run both checks in parallel. `skipped` counts as ready; `error` does not. */
export async function checkReadiness(deps: ReadinessDeps): Promise<ReadinessReport> {
    const start = Date.now();
    const ms = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
    const [database, redis] = await Promise.all([checkDatabase(deps, ms), checkRedis(deps, ms)]);
    const checks = { database, redis };
    const failed = Object.entries(checks)
        .filter(([, result]) => result.status === 'error')
        .map(([name]) => name);
    return {
        status: failed.length === 0 ? 'ready' : 'not_ready',
        version: deps.version,
        checks,
        failed,
        latencyMs: Date.now() - start,
    };
}
