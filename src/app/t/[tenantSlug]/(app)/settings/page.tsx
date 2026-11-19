import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { mayOpenSettings } from '@/components/layout/nav-config';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';
import { getSessionOrThrow } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors/types';
import { getTenantServerContext } from '@/lib/server/tenant-context.server';

/**
 * Settings: a placeholder until the workspace settings pages arrive (see
 * `PlaceholderPage`). Asserted on the server with the sidebar's own rule,
 * `mayOpenSettings` (`admin.view`, on a membership whose built-in role opens
 * the admin console): anybody else gets a 404, as for a workspace they are
 * not in, rather than a page that names what they may not do.
 */
export default async function SettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
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

    const tNav = await getTranslations('nav');
    const t = await getTranslations('placeholders');
    return <PlaceholderPage title={tNav('settings')} emptyTitle={t('title')} body={t('settings')} testId="placeholder-settings" />;
}
