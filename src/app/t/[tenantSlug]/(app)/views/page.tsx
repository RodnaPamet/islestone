import { getTranslations } from 'next-intl/server';

import { getTenantCtx } from '@/app-layer/context';
import { assertCanReadSavedViews } from '@/app-layer/policies/saved-view.policies';
import { ViewsList } from '@/components/views/ViewsList';
import { orNotFound } from '@/lib/server/work-item-pages.server';

/**
 * Views (sub-phase 2.4): the saved views the member can see, each opening
 * its page with the view applied. Replaces 1.7's placeholder. The API decides
 * what each one sees; the page asks `views.view` on the server first, so a
 * caller without it (a GUEST until 8.4, owner decision 204) gets the 404
 * every other refused page gives, not a list that fails to load.
 */
export default async function ViewsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    await orNotFound(async () => assertCanReadSavedViews(await getTenantCtx({ tenantSlug })));
    const tNav = await getTranslations('nav');
    return <ViewsList title={tNav('views')} />;
}
