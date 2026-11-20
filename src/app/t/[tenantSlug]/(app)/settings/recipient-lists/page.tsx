import { getTranslations } from 'next-intl/server';

import { RecipientListsView } from '@/components/recipient-lists/RecipientListsView';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/**
 * Settings → Recipient lists (sub-phase 2.7e; owner decisions 138 to 141):
 * the workspace's lists. The gate is the Settings page's own; whether the
 * viewer manages workspace lists (`admin.manage`, decision 140) is asked on
 * the server.
 */
export default async function RecipientListsSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { recipientLists } = await settingsPageAccess(tenantSlug);
    const t = await getTranslations('recipientLists');
    return (
        <RecipientListsView
            owner={{ kind: 'workspace' }}
            title={t('workspaceTitle')}
            description={t('workspaceDescription')}
            canManage={recipientLists.manageWorkspaceLists}
            readOnlyReason={t('readOnly')}
        />
    );
}
