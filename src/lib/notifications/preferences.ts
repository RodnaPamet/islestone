/**
 * Notification preferences (sub-phase 2.7c; owner decision 132): what a
 * member hears about, per notification type, and how the workspace's
 * settings cap it.
 *
 * Client-safe (types only from `@prisma/client`): the preferences page, the
 * Settings → Notifications page, the usecases and the writers read the same
 * table and the same resolution, so the grid never offers what the writers
 * would not do.
 *
 * Per type a member chooses:
 *   - the bell (`inApp`), on or off;
 *   - email: OFF, IMMEDIATE (only the direct types, `IMMEDIATE_EMAIL_TYPES`)
 *     or DAILY (the 08:10 digest, owner decision 133).
 *
 * The workspace is the ceiling (decision 132): a type it muted in-app rings
 * nobody, and with its email switched off nobody is mailed. A member's choice
 * only narrows. The digest lists a type's unread bell rows, so DAILY needs the
 * bell on, except for due dates, which the digest reads from the items
 * themselves (`DIGEST_READS_ITEMS`).
 *
 * Written fresh for Islestone; inflect-compliance's unused
 * `UserNotificationPreference` (`prisma/schema/automation.prisma` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e) was read as a pattern only.
 */
import type { EmailDelivery, NotificationType } from '@prisma/client';

/** The email choices, in the grid's order. */
export const EMAIL_DELIVERIES = ['OFF', 'IMMEDIATE', 'DAILY'] as const satisfies readonly EmailDelivery[];

/**
 * The types a member sets preferences for: every type a bell writer emits
 * (`listInAppNotificationTypes` in `src/app-layer/notifications/in-app-types.ts`;
 * a unit test holds the two equal). `GENERAL` has no writer and no row.
 */
export const PREFERENCE_TYPES = [
    'WORK_ITEM_ASSIGNED',
    'WORK_ITEM_WAITING_ON',
    'WORK_ITEM_MENTIONED',
    'WORK_ITEM_REVIEW_REQUESTED',
    'WORK_ITEM_REVIEW_RETURNED',
    'WORK_ITEM_REVIEW_COMPLETED',
    'WORK_ITEM_REVIEW_DUE',
    'WORK_ITEM_WATCH_UPDATE',
    'WORK_ITEM_DUE',
    'INTAKE_REQUEST_RECEIVED',
    'INTAKE_REQUEST_WOKEN',
    'CALENDAR_CHANGE_NOT_APPLIED',
    'TIMESHEET_SUBMITTED',
    'TIMESHEET_RETURNED',
    'TIMESHEET_APPROVED',
    'TIMESHEET_REMINDER',
    'TIME_OFF_CHANGED_BY_OTHER',
] as const satisfies readonly NotificationType[];

export type PreferenceType = (typeof PREFERENCE_TYPES)[number];

export function isPreferenceType(type: string): type is PreferenceType {
    return (PREFERENCE_TYPES as readonly string[]).includes(type);
}

/**
 * The types immediate email is offered for (decision 132: assigned, mentioned
 * and waiting on; mentions since 2.7d; review requested and returned since
 * 2.8a, decision 161; a returned timesheet since 3.4c, decision 276). The
 * CHECK `NotificationPreference_immediate_types` (migration
 * `20261222120500_timesheets`) holds the same list.
 */
export const IMMEDIATE_EMAIL_TYPES = [
    'WORK_ITEM_ASSIGNED',
    'WORK_ITEM_WAITING_ON',
    'WORK_ITEM_MENTIONED',
    'WORK_ITEM_REVIEW_REQUESTED',
    'WORK_ITEM_REVIEW_RETURNED',
    'TIMESHEET_RETURNED',
] as const satisfies readonly PreferenceType[];

export function offersImmediateEmail(type: NotificationType): boolean {
    return (IMMEDIATE_EMAIL_TYPES as readonly string[]).includes(type);
}

/**
 * The types offered in the bell only, never by email (3.3c, owner decision
 * 230: "in-app only, no email"): a calendar change that was not applied; and
 * from 3.5a (decision 300) time off someone else changed for you. The CHECK
 * `NotificationPreference_in_app_only_types` (migrations
 * `20261219120100_calendar_read_back`, `20261222120100_workload`) holds the
 * same list.
 */
export const IN_APP_ONLY_TYPES = ['CALENDAR_CHANGE_NOT_APPLIED', 'TIME_OFF_CHANGED_BY_OTHER'] as const satisfies readonly PreferenceType[];

export function offersEmail(type: NotificationType): boolean {
    return !(IN_APP_ONLY_TYPES as readonly string[]).includes(type);
}

/** The email choices a type offers: OFF alone for an in-app-only type, IMMEDIATE only for the direct types. */
export function emailChoicesFor(type: NotificationType): EmailDelivery[] {
    if (!offersEmail(type)) return ['OFF'];
    return EMAIL_DELIVERIES.filter((d) => d !== 'IMMEDIATE' || offersImmediateEmail(type));
}

/**
 * The types whose digest section is read from the work items, not from bell
 * rows: due dates (the digest lists the member's open items due soon). Their
 * daily email works with the bell off.
 */
export const DIGEST_READS_ITEMS = ['WORK_ITEM_DUE'] as const satisfies readonly PreferenceType[];

export function digestReadsItems(type: NotificationType): boolean {
    return (DIGEST_READS_ITEMS as readonly string[]).includes(type);
}

export interface PreferenceChoice {
    inApp: boolean;
    email: EmailDelivery;
}

/**
 * The default per type, when a member has no row (the map's table): the bell
 * on for every type; email at once for the direct types, in the digest for due
 * dates and watched items, off for intake. Exhaustive over `NotificationType`
 * (`GENERAL` included, for a writer that might name it), so a new enum value
 * fails `tsc` here until it has a default.
 */
export const PREFERENCE_DEFAULTS: Record<NotificationType, PreferenceChoice> = {
    GENERAL: { inApp: true, email: 'OFF' },
    WORK_ITEM_ASSIGNED: { inApp: true, email: 'IMMEDIATE' },
    WORK_ITEM_WAITING_ON: { inApp: true, email: 'IMMEDIATE' },
    WORK_ITEM_MENTIONED: { inApp: true, email: 'IMMEDIATE' },
    // Sub-phase 2.8a (decision 161): a request and a return at once, the
    // reminders in the digest, a completion in the bell only.
    WORK_ITEM_REVIEW_REQUESTED: { inApp: true, email: 'IMMEDIATE' },
    WORK_ITEM_REVIEW_RETURNED: { inApp: true, email: 'IMMEDIATE' },
    WORK_ITEM_REVIEW_COMPLETED: { inApp: true, email: 'OFF' },
    WORK_ITEM_REVIEW_DUE: { inApp: true, email: 'DAILY' },
    WORK_ITEM_WATCH_UPDATE: { inApp: true, email: 'DAILY' },
    WORK_ITEM_DUE: { inApp: true, email: 'DAILY' },
    INTAKE_REQUEST_RECEIVED: { inApp: true, email: 'OFF' },
    INTAKE_REQUEST_WOKEN: { inApp: true, email: 'OFF' },
    // Sub-phase 3.3c (decision 230): in the bell only, never email.
    CALENDAR_CHANGE_NOT_APPLIED: { inApp: true, email: 'OFF' },
    // Sub-phase 3.4c (decision 276): a returned week at once by email, the
    // rest in the bell.
    TIMESHEET_SUBMITTED: { inApp: true, email: 'OFF' },
    TIMESHEET_RETURNED: { inApp: true, email: 'IMMEDIATE' },
    TIMESHEET_APPROVED: { inApp: true, email: 'OFF' },
    TIMESHEET_REMINDER: { inApp: true, email: 'OFF' },
    TIME_OFF_CHANGED_BY_OTHER: { inApp: true, email: 'OFF' },
};

/** What the workspace's settings say (`TenantNotificationSettings`). */
export interface PreferenceCeiling {
    /** The workspace's email switch. */
    emailEnabled: boolean;
    /** The in-app types the workspace muted. */
    mutedInAppTypes: readonly NotificationType[];
}

/** Why a cell is capped below the member's choice. */
export type PreferenceCap = 'WORKSPACE_MUTED' | 'WORKSPACE_EMAIL_OFF' | 'BELL_OFF';

export interface ResolvedDelivery {
    /** What the member chose (or the default). */
    chosen: PreferenceChoice;
    /** Whether `chosen` is a stored row or the type's default. */
    isDefault: boolean;
    /** What the writers do. */
    inApp: boolean;
    email: EmailDelivery;
    /** Set when the bell is off although the member chose it on. */
    inAppCap: PreferenceCap | null;
    /** Set when email is narrower than the member chose. */
    emailCap: PreferenceCap | null;
}

/** A stored row's shape (`NotificationPreference`), or `null` for none. */
export interface StoredPreference {
    inApp: boolean;
    emailDelivery: EmailDelivery;
}

/**
 * The one resolution: the member's choice (or the default) under the
 * workspace's ceiling. Pure; the writers' batch read
 * (`memberDeliveries` in `src/app-layer/notifications/settings.ts`) and the
 * preferences page both call it.
 */
export function resolveDelivery(type: NotificationType, stored: StoredPreference | null, ceiling: PreferenceCeiling): ResolvedDelivery {
    const fallback = PREFERENCE_DEFAULTS[type] ?? { inApp: true, email: 'OFF' };
    let chosen: PreferenceChoice = stored ? { inApp: stored.inApp, email: stored.emailDelivery } : fallback;
    // A stored IMMEDIATE for a type that does not offer it (the CHECK refuses
    // one; a type moved off the list later would leave one) reads as DAILY:
    // never louder than the type allows, never silently off.
    if (chosen.email === 'IMMEDIATE' && !offersImmediateEmail(type)) chosen = { ...chosen, email: 'DAILY' };
    // An in-app-only type is never mailed, whatever a row says (the CHECK refuses one).
    if (!offersEmail(type) && chosen.email !== 'OFF') chosen = { ...chosen, email: 'OFF' };

    const muted = ceiling.mutedInAppTypes.includes(type);
    const inApp = chosen.inApp && !muted;
    const inAppCap: PreferenceCap | null = chosen.inApp && muted ? 'WORKSPACE_MUTED' : null;

    let email: EmailDelivery = chosen.email;
    let emailCap: PreferenceCap | null = null;
    if (email !== 'OFF' && !ceiling.emailEnabled) {
        email = 'OFF';
        emailCap = 'WORKSPACE_EMAIL_OFF';
    } else if (email === 'DAILY' && !inApp && !digestReadsItems(type)) {
        // The digest lists this type's unread bell rows; with no rows there is
        // nothing to send.
        email = 'OFF';
        emailCap = muted ? 'WORKSPACE_MUTED' : 'BELL_OFF';
    }
    return { chosen, isDefault: !stored, inApp, email, inAppCap, emailCap };
}

/**
 * Is a choice one the member may save? No email for an in-app-only type;
 * `IMMEDIATE` only for the direct types;
 * `DAILY` with the bell off only where the digest reads the items. Returns the
 * refusal's code, or `null`.
 */
export function choiceRefusal(type: PreferenceType, choice: PreferenceChoice): 'EMAIL_NOT_OFFERED' | 'IMMEDIATE_NOT_OFFERED' | 'DAILY_NEEDS_IN_APP' | null {
    if (choice.email !== 'OFF' && !offersEmail(type)) return 'EMAIL_NOT_OFFERED';
    if (choice.email === 'IMMEDIATE' && !offersImmediateEmail(type)) return 'IMMEDIATE_NOT_OFFERED';
    if (choice.email === 'DAILY' && !choice.inApp && !digestReadsItems(type)) return 'DAILY_NEEDS_IN_APP';
    return null;
}
