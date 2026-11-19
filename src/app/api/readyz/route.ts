/**
 * Readiness: "should this replica receive traffic?"
 *
 * The skeleton has no dependencies yet, so it always reports ready. Real
 * checks (database, Redis) arrive with sub-phase 1.8 (environments and
 * delivery), which also defines the failure shape (503 plus which check
 * failed). Until then this answers 200 with `{"status":"ok"}`.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
    return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
