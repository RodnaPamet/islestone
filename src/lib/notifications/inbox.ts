/**
 * The Inbox's client-safe shapes (sub-phase 2.7c; owner decision 134): its
 * three views, a row as the routes return it, and the preferences page's row.
 *
 * Written fresh for Islestone.
 */
import type { EmailDelivery, NotificationType } from '@prisma/client';

import type { PreferenceCap, PreferenceType } from './preferences';

/** The tabs: Unread, All (not Done) and Done (ADR 0006: the Inbox's archive verb). */
export const INBOX_VIEWS = ['unread', 'all', 'done'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** One notification as the bell and the Inbox read it. */
export interface NotificationRowData {
    id: string;
    type: NotificationType;
    title: string;
    body: string;
    read: boolean;
    readAt: string | null;
    archivedAt: string | null;
    linkUrl: string | null;
    workItemId: string | null;
    createdAt: string;
}

/** One Inbox page (docs/pagination.md's contract) and the unread count. */
export interface InboxPageData {
    items: NotificationRowData[];
    pageInfo: { nextCursor?: string; hasNextPage: boolean };
    unreadCount: number;
}

/** One row of the preferences grid, resolved on the server. */
export interface PreferenceRowData {
    type: PreferenceType;
    /** What the member chose (or the default). */
    inApp: boolean;
    email: EmailDelivery;
    isDefault: boolean;
    /** What the writers do, after the workspace's ceiling. */
    effectiveInApp: boolean;
    effectiveEmail: EmailDelivery;
    inAppCap: PreferenceCap | null;
    emailCap: PreferenceCap | null;
    /** The email choices this type offers (IMMEDIATE only for the direct types). */
    emailChoices: EmailDelivery[];
}

export interface PreferencesData {
    rows: PreferenceRowData[];
    /** The workspace's ceiling, shown on the page. */
    workspace: { emailEnabled: boolean; mutedInAppTypes: NotificationType[] };
}
