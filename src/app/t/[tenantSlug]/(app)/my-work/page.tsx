import { getTranslations } from 'next-intl/server';

import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

/**
 * My Work: a placeholder until its feature arrives (see `PlaceholderPage`).
 * The layout has already admitted the member.
 */
export default async function MyWorkPage() {
    const tNav = await getTranslations('nav');
    const t = await getTranslations('placeholders');
    return <PlaceholderPage title={tNav('myWork')} emptyTitle={t('title')} body={t('myWork')} testId="placeholder-my-work" />;
}
