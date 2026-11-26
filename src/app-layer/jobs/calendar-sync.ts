/**
 * Calendar sync's three jobs (roadmap 3.3b; ADR 0011; docs/porting/maps/3.3.md,
 * "Jobs"; decision 233). Each runs in `runJob`; the work is in
 * `usecases/calendar-sync-run.ts`.
 *
 *   - `calendar-sync-dispatch` (every 15 minutes, UTC): live connections and
 *     those being torn down, at most 5,000 of each, one job each;
 *   - `calendar-sync-connection` (on demand): one connection's push;
 *   - `calendar-teardown` (on demand): one connection's teardown.
 *
 * Nothing here reaches the NextAuth seam, `next/headers` or `server-only`
 * (the worker's import graph guard). Written fresh for Islestone, after
 * inflect-compliance's `jobs/calendar-push.ts` dispatcher shape at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import { dispatchCalendarSync, runCalendarSync, runCalendarTeardown } from '../usecases/calendar-sync-run';
import { runJob } from '@/lib/observability/job-runner';

export async function processCalendarSyncDispatch(input: { tenantId?: string }) {
    return runJob('calendar-sync-dispatch', () => dispatchCalendarSync({ tenantId: input.tenantId }));
}

export async function processCalendarSyncConnection(input: { tenantId: string; connectionId: string }) {
    return runJob('calendar-sync-connection', () => runCalendarSync(input));
}

export async function processCalendarTeardown(input: { tenantId: string; connectionId: string }) {
    return runJob('calendar-teardown', () => runCalendarTeardown(input));
}
