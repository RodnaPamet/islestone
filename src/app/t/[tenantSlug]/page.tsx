import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { Card } from '@inflect/ui/components/ui/card';
import { Heading } from '@inflect/ui/components/ui/typography';
import { getSession } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors/types';
import { getTenantServerContext } from '@/lib/server/tenant-context.server';

/**
 * The workspace landing page (`tenantLandingPath`) — a PLACEHOLDER of
 * sub-phase 1.4, so that sign-in, an accepted invitation and the workspace
 * picker land somewhere real. Sub-phase 1.7 builds the app shell and moves
 * the landing route to My Work.
 *
 * It resolves the workspace through `getTenantServerContext`, the page-side
 * gate: membership, the workspace MFA check, and a 404 for a workspace the
 * person cannot see.
 */
export default async function WorkspaceLandingPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const session = await getSession();
    if (!session) redirect(`/login?next=${encodeURIComponent(`/t/${tenantSlug}`)}`);

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

    const t = await getTranslations('workspaceHome');
    const tRoles = await getTranslations('roles');

    return (
        <main className="min-h-screen flex items-center justify-center bg-bg-page p-4">
            <Card className="w-full max-w-md space-y-default">
                <Heading level={1}>{ctx.tenant.name}</Heading>
                <p className="text-content-muted text-sm">{t('signedInAs', { role: tRoles(ctx.membershipRole) })}</p>
                <p className="text-sm">{t('placeholder')}</p>
                <nav aria-label={t('linksLabel')} className="flex flex-col gap-tight text-sm">
                    <Link href={`/t/${tenantSlug}/security/mfa`} className="underline">
                        {t('mfaLink')}
                    </Link>
                    <Link href="/account/security" className="underline">
                        {t('accountSecurityLink')}
                    </Link>
                    <Link href="/account/profile" className="underline">
                        {t('accountProfileLink')}
                    </Link>
                    <Link href="/tenants" className="underline">
                        {t('workspacesLink')}
                    </Link>
                </nav>
            </Card>
        </main>
    );
}
