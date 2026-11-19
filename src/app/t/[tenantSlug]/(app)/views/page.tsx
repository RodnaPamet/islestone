import { getTranslations } from 'next-intl/server';

import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

/**
 * Views: a placeholder until its feature arrives (see `PlaceholderPage`).
 * The layout has already admitted the member.
 */
export default async function ViewsPage() {
    const tNav = await getTranslations('nav');
    const t = await getTranslations('placeholders');
    return <PlaceholderPage title={tNav('views')} emptyTitle={t('title')} body={t('views')} testId="placeholder-views" />;
}
