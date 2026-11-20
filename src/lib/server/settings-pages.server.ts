/**
 * What every Settings page reads on the server (decision 55): the page's
 * own gate, `mayOpenSettings` (the sidebar gear's rule: `admin.view` on a
 * membership whose built-in role opens the admin console), asked through
 * `getTenantServerContext` (membership and the workspace MFA gate), and the
 * writes the page offers, `workConfigAffordances` (the predicates the work
 * configuration usecases assert). Anybody the gate refuses gets a 404, as
 * for a workspace they are not in.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { workConfigAffordances } from '@/app-layer/policies/work-config.policies';
import { mayOpenSettings } from '@/components/layout/nav-config';
import { getSessionOrThrow } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors/types';
import { getTenantServerContext } from '@/lib/server/tenant-context.server';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

export async function settingsPageAccess(tenantSlug: string): Promise<{ affordances: WorkConfigAffordances }> {
    const session = await getSessionOrThrow();
    let ctx;
    try {
        ctx = await getTenantServerContext({
            tenantSlug,
            userId: session.userId,
            session: {
                membershipTenantIds: session.membershipTenantIds,
                mfaPendingTenantIds: session.mfaPendingTenantIds,
            },
        });
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
    if (!mayOpenSettings(ctx.appPermissions, ctx.membershipRole)) notFound();
    return { affordances: workConfigAffordances(ctx) };
}
