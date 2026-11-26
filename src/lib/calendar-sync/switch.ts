/**
 * Calendar sync's deployment switch and the providers it offers (roadmap
 * 3.3b; ADR 0011; owner decisions 234 and 236).
 *
 *   CALENDAR_SYNC=1   open
 *   CALENDAR_SYNC=0   closed
 *   unset             closed when NODE_ENV is production, open otherwise
 *
 * The `INTAKE_EMAIL` shape. Closed, every calendar sync route is a 404 and no
 * calendar job runs. A provider is offered only when the sign-in app pair it
 * reuses is complete (decision 236). Server-only.
 */
import type { CalendarProvider } from '@prisma/client';

import { env } from '@/env';

export function isCalendarSyncOpen(): boolean {
    if (env.CALENDAR_SYNC === '1') return true;
    if (env.CALENDAR_SYNC === '0') return false;
    return env.NODE_ENV !== 'production';
}

/** Whether the sign-in app a provider's calendar flow reuses is configured. */
export function isProviderConfigured(provider: CalendarProvider): boolean {
    if (provider === 'GOOGLE') return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
}
