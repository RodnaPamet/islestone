import { getTranslations } from 'next-intl/server';

import { InboxView } from '@/components/inbox/InboxView';

/**
 * Inbox (sub-phase 2.7c; owner decision 134): the member's own notifications
 * in this workspace. The layout has already admitted the member; every role
 * reads its own notifications, so the page asks nothing more.
 */
export default async function InboxPage() {
    const tNav = await getTranslations('nav');
    return <InboxView title={tNav('inbox')} />;
}
