import { getTranslations } from 'next-intl/server';

import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

/**
 * Projects: a placeholder until its feature arrives (see `PlaceholderPage`).
 * The layout has already admitted the member.
 */
export default async function ProjectsPage() {
    const tNav = await getTranslations('nav');
    const t = await getTranslations('placeholders');
    return <PlaceholderPage title={tNav('projects')} emptyTitle={t('title')} body={t('projects')} testId="placeholder-projects" />;
}
