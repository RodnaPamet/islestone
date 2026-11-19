/**
 * Readiness: "should this replica receive traffic?"
 *
 * 200 with `status: "ready"` when PostgreSQL and Redis both answer; 503 with
 * `status: "not_ready"` and the failing checks named in `failed` otherwise.
 * The checks, their timeouts and their closed set of error strings live in
 * `src/lib/health/readiness.ts`; this handler only wires the app's own clients
 * to them, so it holds no data access of its own. `version` is the commit the
 * image was built from (`BUILD_SHA`, baked in by the Dockerfile), or `dev`.
 *
 * Liveness (`/api/livez`) checks nothing on purpose; see that route.
 */
import { env } from '@/env';
import { checkReadiness } from '@/lib/health/readiness';
import { logger } from '@/lib/observability/logger';
import { prisma } from '@/lib/prisma';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
    const redis = getRedis();
    const report = await checkReadiness({
        queryDatabase: () => prisma.$queryRaw`SELECT 1`,
        pingRedis: redis ? () => redis.ping() : null,
        production: env.NODE_ENV === 'production',
        version: env.BUILD_SHA || 'dev',
    });
    if (report.status !== 'ready') {
        // The body carries only the closed error codes; never log a driver's
        // own message, which can carry the host and the role.
        logger.warn('readyz: dependency check failed', { component: 'readyz', failed: report.failed });
    }
    return Response.json(report, {
        status: report.status === 'ready' ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
    });
}
