/**
 * Liveness: "is this process able to answer HTTP at all?"
 *
 * Always 200, and deliberately checks no dependency. A liveness probe that
 * failed when the database was down would make the orchestrator restart every
 * healthy replica during a database outage. Dependency checks belong in
 * /api/readyz.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
    return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
