import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/auth';
import { Heading } from '@inflect/ui/components/ui/typography';
import { AccountBackLink } from '@/app/account/AccountBackLink';

import { NameEditField } from './NameEditField';

/**
 * Account → Profile: the display name. A focused, standalone page in the
 * same shape as `/account/security`. The avatar upload arrives with file
 * storage in sub-phase 4.4.
 */
export default async function AccountProfilePage() {
    const session = await auth();
    if (!session?.user) redirect('/login?next=/account/profile');

    const t = await getTranslations('account.profile');

    return (
        <div className="min-h-screen flex items-center justify-center bg-bg-page p-4">
            {/* Background effects — matches /account/security. */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-[var(--brand-default)]/10 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-[var(--brand-emphasis)]/10 blur-3xl" />
            </div>

            <div className="relative w-full max-w-md">
                <div className="mb-4">
                    <AccountBackLink />
                </div>
                <div className="text-center mb-8 animate-fadeIn">
                    <Heading level={1}>{t('profileTitle')}</Heading>
                </div>

                <NameEditField initialName={session.user.name ?? null} />
            </div>
        </div>
    );
}
