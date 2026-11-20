import { NotificationPreferencesView } from '@/components/inbox/NotificationPreferencesView';

/**
 * Inbox → Notification preferences (sub-phase 2.7c; owner decision 132): the
 * member's own choices per kind of notification, under the workspace's
 * settings. Every member manages their own; the layout has admitted them.
 */
export default function NotificationPreferencesPage() {
    return <NotificationPreferencesView />;
}
