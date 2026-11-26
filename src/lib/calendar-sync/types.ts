/**
 * Calendar sync's client-safe shapes and limits (roadmap 3.3b; ADR 0011;
 * docs/porting/maps/3.3.md, "The push"). No server import: the settings and
 * the member's section read these.
 */

export const CALENDAR_PROVIDERS = ['GOOGLE', 'MICROSOFT'] as const;
export type CalendarProviderName = (typeof CALENDAR_PROVIDERS)[number];

/** Decision 226: a member's open assigned items due from 30 days ago to a year ahead, at most 1,000. */
export const CALENDAR_SYNC_ITEM_LIMIT = 1_000;
/** Decision 227: their projects' milestones in the same window, at most 200. */
export const CALENDAR_SYNC_MILESTONE_LIMIT = 200;
export const CALENDAR_SYNC_PAST_DAYS = 30;
export const CALENDAR_SYNC_FUTURE_DAYS = 365;

export type CalendarConnectionStateName = 'CONNECTED' | 'REVOKED' | 'DISCONNECTING' | 'CALENDAR_REMOVED';

/** Settings → Calendar sync (decision 234): counts, never who. */
export interface CalendarSyncSettingsView {
    syncEnabled: boolean;
    version: number;
    google: { configured: boolean; connected: number };
    microsoft: {
        configured: boolean;
        connected: number;
        consentGranted: boolean;
        consentGrantedAt: string | null;
        consentRevokedAt: string | null;
    };
    /** Connections whose events are being removed. */
    removing: number;
}

export type ProviderUnavailableReason = 'SYNC_OFF' | 'NOT_CONFIGURED' | 'MICROSOFT_NOT_AUTHORISED';

/** What the member asks of a connection (3.3c, decision 232): put deleted events back, or a deleted Islestone calendar. */
export const CALENDAR_CONNECTION_ACTIONS = ['resync', 'recreate'] as const;
export type CalendarConnectionAction = (typeof CALENDAR_CONNECTION_ACTIONS)[number];

/** The member's own section (decision 235). */
export interface MyCalendarSyncView {
    syncEnabled: boolean;
    /** No `work_items.edit`: changes made in the calendar are not sent back (decision 235). */
    readOnly: boolean;
    providers: Array<{ provider: CalendarProviderName; offered: boolean; unavailable: ProviderUnavailableReason | null }>;
    connections: Array<{
        provider: CalendarProviderName;
        state: CalendarConnectionStateName;
        connectedAt: string;
        lastSyncedAt: string | null;
        revokedReason: string | null;
        /** Events the member deleted in the calendar, not pushed again until their date changes or "Resync" (3.3c, decision 232). */
        removedInCalendar: number;
    }>;
    /** How many of the member's items are in the window (the read's count, never guessed), and the limit pushed. */
    items: { inWindow: number; limit: number };
}
