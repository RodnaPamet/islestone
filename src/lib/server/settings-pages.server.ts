/**
 * What every Settings page reads on the server (decision 55): the page's
 * own gate, `mayOpenSettings` (the sidebar gear's rule: `admin.view` on a
 * membership whose built-in role opens the admin console), asked through
 * `getTenantServerContext` (membership and the workspace MFA gate), and the
 * writes the page offers, `workConfigAffordances` (the predicates the work
 * configuration usecases assert), whether the notification settings are
 * the caller's to see (2.7c), and who manages recipient lists (2.7e).
 * Anybody the gate refuses gets a 404, as for a workspace they are not in.
 *
 * Written fresh for Islestone.
 */
import { goalAffordances } from '@/app-layer/policies/goal.policies';
import type { GoalAffordances } from '@/lib/goals/types';
import { notFound } from 'next/navigation';

import { mayManageNotificationSettings } from '@/app-layer/policies/notification-settings.policies';
import { recipientListAffordances } from '@/app-layer/policies/recipient-list.policies';
import { templateAffordances } from '@/app-layer/policies/template.policies';
import { workConfigAffordances } from '@/app-layer/policies/work-config.policies';
import { mayOpenSettings } from '@/components/layout/nav-config';
import { getSessionOrThrow } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors/types';
import { getTenantServerContext } from '@/lib/server/tenant-context.server';
import type { RecipientListAffordances } from '@/lib/recipient-lists/types';
import type { TemplateAffordances, WorkConfigAffordances } from '@/lib/work-items/types';

export async function settingsPageAccess(
    tenantSlug: string,
): Promise<{
    affordances: WorkConfigAffordances;
    templates: TemplateAffordances;
    manageNotificationSettings: boolean;
    recipientLists: RecipientListAffordances;
    goals: GoalAffordances;
}> {
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
    return {
        affordances: workConfigAffordances(ctx),
        templates: templateAffordances(ctx),
        // Settings → Notifications (2.7c): the 1.6 API's own gate.
        manageNotificationSettings: mayManageNotificationSettings(ctx),
        // Settings → Recipient lists (2.7e): the usecases' own predicates.
        recipientLists: recipientListAffordances(ctx),
        // A project's initiative (3.2a): the usecases' own predicates.
        goals: goalAffordances(ctx),
    };
}
