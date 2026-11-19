'use client';

import type { ReactNode } from 'react';

import { WebVitalsReporter } from '@/components/observability/WebVitalsReporter';

/**
 * Client-only providers for the tenant app.
 *
 * This wrapper isolates all client-runtime providers from server-rendered
 * layouts, making the server/client boundary explicit and clean. It is the
 * seam later sub-phases mount into (the onboarding tour, 8.2; the
 * assistant, 6.4), which is why it keeps the `userId` prop no current
 * child reads.
 *
 * Currently wraps:
 *   - WebVitalsReporter — beacons Core Web Vitals to `/api/telemetry/vitals`
 *     (sub-phase 1.6). Renders nothing.
 *
 * NOT included here (and why):
 *   - NextIntlClientProvider — lives in the root layout, driven by
 *     server-resolved locale/messages
 *   - TenantProvider — lives in the workspace app layout
 *     (src/app/t/[tenantSlug]/(app)/layout.tsx), driven by server-resolved
 *     tenant context
 *
 * @example
 * ```tsx
 * // In a server layout:
 * <ClientProviders userId={session.user.id}>
 *   {children}
 * </ClientProviders>
 * ```
 */
export function ClientProviders({
    children,
}: {
    children: ReactNode;
    /** Authenticated user id, passed in from the server layout. Null on
     *  routes rendered before authentication completes. */
    userId?: string | null;
}) {
    return (
        <>
            {children}
            <WebVitalsReporter />
        </>
    );
}
