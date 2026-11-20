/**
 * The daily digest (`EmailNotificationType.NOTIFICATION_DIGEST`, sub-phase
 * 2.7c, owner decision 133): one email a day per member, at 08:10 in
 * `NOTIFICATIONS_TZ`, with their open work items due soon and the day's
 * unread notifications of the types they chose to receive daily. It replaces
 * 1.6's separate due digest.
 *
 * What it may say: an item's key, title and due date, and a notification's
 * stored title and body, which the bell writers generate from titles and
 * names. Never a description or a comment: those are encrypted at rest and
 * stay in the app (`tests/unit/notification-digest.test.ts`).
 *
 * Written fresh for Islestone with react-email.
 */
import { Button, Link, Section, Text } from '@react-email/components';

import { EmailLayout, button, paragraph } from './layout';

/** When a due item falls, from the member's today. */
export type DigestDueGroup = 'OVERDUE' | 'TODAY' | 'SOON';

export const DIGEST_DUE_ORDER: readonly DigestDueGroup[] = ['OVERDUE', 'TODAY', 'SOON'];

export const DIGEST_DUE_LABEL: Record<DigestDueGroup, string> = {
    OVERDUE: 'Overdue',
    TODAY: 'Due today',
    SOON: 'Due soon',
};

const GROUP_COLOR: Record<DigestDueGroup, string> = {
    OVERDUE: '#ef4444',
    TODAY: '#f59e0b',
    SOON: '#10b981',
};

/** One due work item, as the email shows it. */
export interface DigestDueLine {
    key: string;
    title: string;
    /** YYYY-MM-DD, date-only. */
    dueDate: string;
    group: DigestDueGroup;
    /** The member is the person it waits on (not, or not only, its assignee). */
    waitingOnYou: boolean;
    /** Absolute link to the item. */
    link: string;
}

/** One notification, as the bell stored it. */
export interface DigestNotificationLine {
    title: string;
    body: string;
    /** Absolute link, or `null` when the row had none. */
    link: string | null;
}

export interface NotificationDigestEmailProps {
    recipientName: string;
    due: DigestDueLine[];
    /** Due items past the cap, counted. */
    moreDue: number;
    notifications: DigestNotificationLine[];
    /** Notifications past the cap, counted. */
    moreNotifications: number;
    /** Absolute links: the Inbox and the preferences page. */
    inboxLink: string;
    preferencesLink: string;
}

export function dueLineText(line: DigestDueLine): string {
    return `[${line.key}] ${line.title} — due ${line.dueDate}${line.waitingOnYou ? ' (waiting on you)' : ''}`;
}

export function digestSubject(dueCount: number, notificationCount: number): string {
    const parts: string[] = [];
    if (dueCount > 0) parts.push(`${dueCount} work ${dueCount === 1 ? 'item' : 'items'} due`);
    if (notificationCount > 0) parts.push(`${notificationCount} ${notificationCount === 1 ? 'notification' : 'notifications'}`);
    return `Your daily digest: ${parts.join(', ')}`;
}

const groupHeading = { fontSize: '13px', fontWeight: 600, margin: '16px 0 4px' };
const sectionHeading = { fontSize: '15px', fontWeight: 600, color: '#1a1a2e', margin: '20px 0 4px' };
const itemLine = { ...paragraph, margin: '2px 0' };
const muted = { ...paragraph, color: '#777777', fontSize: '12px' };

export function NotificationDigestEmail(props: NotificationDigestEmailProps) {
    const dueTotal = props.due.length + props.moreDue;
    const notificationTotal = props.notifications.length + props.moreNotifications;
    return (
        <EmailLayout preview={digestSubject(dueTotal, notificationTotal)} heading="Your daily digest">
            <Text style={paragraph}>Hi {props.recipientName},</Text>
            {dueTotal > 0 && (
                <Section>
                    <Text style={sectionHeading}>Work items due</Text>
                    {DIGEST_DUE_ORDER.map((group) => {
                        const lines = props.due.filter((l) => l.group === group);
                        if (lines.length === 0) return null;
                        return (
                            <Section key={group}>
                                <Text style={{ ...groupHeading, color: GROUP_COLOR[group] }}>
                                    {DIGEST_DUE_LABEL[group]} ({lines.length})
                                </Text>
                                {lines.map((line) => (
                                    <Text key={line.key} style={itemLine}>
                                        <Link href={line.link}>{dueLineText(line)}</Link>
                                    </Text>
                                ))}
                            </Section>
                        );
                    })}
                    {props.moreDue > 0 && <Text style={muted}>And {props.moreDue} more.</Text>}
                </Section>
            )}
            {notificationTotal > 0 && (
                <Section>
                    <Text style={sectionHeading}>Notifications</Text>
                    {props.notifications.map((n, i) => (
                        <Text key={i} style={itemLine}>
                            <strong>{n.title}</strong> — {n.link ? <Link href={n.link}>{n.body}</Link> : n.body}
                        </Text>
                    ))}
                    {props.moreNotifications > 0 && <Text style={muted}>And {props.moreNotifications} more in your Inbox.</Text>}
                </Section>
            )}
            <Button href={props.inboxLink} style={button}>
                Open your Inbox
            </Button>
            <Text style={muted}>
                You receive this because your notification preferences send these daily.{' '}
                <Link href={props.preferencesLink}>Change your preferences</Link>.
            </Text>
        </EmailLayout>
    );
}
