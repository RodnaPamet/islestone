import { getTranslations } from 'next-intl/server';

import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

/**
 * Inbox: a placeholder until its feature arrives (see `PlaceholderPage`).
 * The layout has already admitted the member.
 */
export default async function InboxPage() {
    const tNav = await getTranslations('nav');
    const t = await getTranslations('placeholders');
    return <PlaceholderPage title={tNav('inbox')} emptyTitle={t('title')} body={t('inbox')} testId="placeholder-inbox" />;
}
