import { unstable_noStore as noStore } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { auth } from '@/auth';
import { AppShell } from '@/components/layout/AppShell';
import { ClientProviders } from '@/components/layout/ClientProviders';
import { NavigationTracker } from '@/components/nav/NavigationTracker';
import { isAppError } from '@/lib/errors/types';
import { getTenantServerContext } from '@/lib/server/tenant-context.server';
import { TenantProvider } from '@/lib/tenant-context-provider';

/**
 * This layout depends on the session cookie and database reads; it is never
 * statically generated.
 */
export const dynamic = 'force-dynamic';

/**
 * The workspace app layout: the security boundary of every page under
 * `/t/<slug>/(app)`, and the application shell around it.
 *
 *   1. The session (`auth()`); none → `/login`.
 *   2. The workspace, through `getTenantServerContext`: the slug must name a
 *      workspace the person is an active member of, or the page is a 404 —
 *      never another workspace's shell — and a workspace that still wants
 *      this session's MFA code sends the page to its challenge.
 *   3. `TenantProvider` with the resolved context, then `AppShell` (sidebar,
 *      top chrome, mobile drawer) and `ClientProviders`.
 *
 * Merged from inflect-compliance's two layouts at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7):
 * `src/app/t/[tenantSlug]/layout.tsx` (the context, `noStore`, the 404) and
 * `src/app/t/[tenantSlug]/(app)/layout.tsx` (the shell). They are one layout
 * here because Islestone's page-side context runs the workspace MFA gate
 * (sub-phase 1.4), and the MFA challenge and enrolment pages, which a
 * session owing its code must reach, live beside this group in `(mfa)`,
 * outside it. Cut: the billing plan read (8.1), the currency and module bag,
 * and the assistant launcher (6.4 mounts it here).
 *
 * `noStore()` + `force-dynamic` guarantee per-request freshness: permissions
 * are never served from a stale cache. The sidebar's client-side filter is
 * a defence-in-depth layer, not the gate.
 */
export default async function WorkspaceAppLayout({
    children,
    params,
}: {
    children: ReactNode;
    params: Promise<{ tenantSlug: string }>;
}) {
    noStore();
    const { tenantSlug } = await params;

    const session = await auth();
    if (!session?.user?.id) {
        // The edge sends an unauthenticated request to /login first; this is
        // the backstop.
        redirect(`/login?next=${encodeURIComponent(`/t/${tenantSlug}`)}`);
    }
    const { user } = session;

    let ctx;
    try {
        ctx = await getTenantServerContext({
            tenantSlug,
            userId: user.id,
            session: {
                membershipTenantIds: (user.memberships ?? []).map((m) => m.tenantId),
                mfaPendingTenantIds: user.mfaPendingTenantIds ?? [],
            },
        });
    } catch (err) {
        // No such workspace, or no active membership: one 404 for both, so a
        // slug does not reveal whether the workspace exists. Anything else
        // (the MFA gate's redirect included) propagates.
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }

    const tc = await getTranslations('common');

    return (
        <TenantProvider
            value={{
                userId: user.id,
                tenantId: ctx.tenant.id,
                tenantSlug: ctx.tenant.slug,
                tenantName: ctx.tenant.name,
                role: ctx.role,
                membershipRole: ctx.membershipRole,
                permissions: ctx.permissions,
                appPermissions: ctx.appPermissions,
            }}
        >
            <AppShell
                user={{
                    name: user.name,
                    email: user.email,
                    image: user.image,
                    memberships: user.memberships,
                    orgMemberships: user.orgMemberships,
                }}
                appName={tc('appName')}
            >
                <ClientProviders userId={user.id}>
                    <NavigationTracker />
                    {children}
                </ClientProviders>
            </AppShell>
        </TenantProvider>
    );
}
