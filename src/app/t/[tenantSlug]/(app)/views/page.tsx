import { getTranslations } from 'next-intl/server';

import { ViewsList } from '@/components/views/ViewsList';

/**
 * Views (sub-phase 2.4): the saved views the member can see, each opening
 * its page with the view applied. Replaces 1.7's placeholder. The layout has
 * already admitted the member; the API decides what each one sees.
 */
export default async function ViewsPage() {
    const tNav = await getTranslations('nav');
    return <ViewsList title={tNav('views')} />;
}
