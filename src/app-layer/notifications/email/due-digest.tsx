/**
 * The due digest (`EmailNotificationType.DUE_DIGEST`): one email per
 * recipient listing the work items that are overdue, due soon or upcoming,
 * grouped by urgency. Built by `digest-dispatcher.ts`; sub-phase 2.7 writes
 * the monitor that feeds it.
 *
 * Written for Islestone with react-email. The audience rule and the urgency
 * grouping follow inflect-compliance's `digest-templates.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (pattern only).
 */
import { Button, Section, Text } from '@react-email/components';

import type { DueItem, DueItemUrgency } from '../../jobs/types';

import { EmailLayout, button, paragraph } from './layout';

/**
 * WHY the reader was chosen, which is not the same as what is in the digest.
 *
 * `OWNER` — every item is assigned to this person. `TENANT_ADMIN` — the items
 * have NO assignee, and the reader is receiving them because somebody has to
 * see work nobody has picked up (`digest-dispatcher`'s unowned fallback).
 *
 * In inflect-compliance both audiences got the same sentence, "You have N
 * item(s) that need your attention", so an admin on the fallback was told
 * that work nobody had picked up was theirs (its #3165). The copy says which
 * of the two it is; the unowned work is still shown, because unowned overdue
 * work is the gap the digest exists to make visible.
 */
export type DigestAudience = 'OWNER' | 'TENANT_ADMIN';

export const URGENCY_ORDER: readonly DueItemUrgency[] = ['OVERDUE', 'URGENT', 'UPCOMING'];

export const URGENCY_LABEL: Record<DueItemUrgency, string> = {
    OVERDUE: 'Overdue',
    URGENT: 'Due soon',
    UPCOMING: 'Upcoming',
};

const URGENCY_COLOR: Record<DueItemUrgency, string> = {
    OVERDUE: '#ef4444',
    URGENT: '#f59e0b',
    UPCOMING: '#10b981',
};

export interface DueDigestEmailProps {
    recipientName: string;
    items: DueItem[];
    audience: DigestAudience;
    /** Absolute link to the workspace (built with `appLink`). */
    link: string;
}

export function summaryLine(items: DueItem[]): string {
    return URGENCY_ORDER.map((u) => [u, items.filter((i) => i.urgency === u).length] as const)
        .filter(([, n]) => n > 0)
        .map(([u, n]) => `${n} ${URGENCY_LABEL[u].toLowerCase()}`)
        .join(', ');
}

export interface DigestLede {
    subject: string;
    heading: string;
    intro: string;
}

/** The subject, heading and opening line for an audience. */
export function digestLede(audience: DigestAudience, items: DueItem[]): DigestLede {
    const count = items.length;
    const marker = items.some((i) => i.urgency === 'OVERDUE') ? 'Overdue: ' : '';
    const one = count === 1;
    const noun = one ? 'work item' : 'work items';
    if (audience === 'TENANT_ADMIN') {
        return {
            subject: `${marker}${count} unassigned ${noun} ${one ? 'needs' : 'need'} an assignee`,
            heading: 'Unassigned work items',
            intro:
                `${count} ${noun} in this workspace ${one ? 'has' : 'have'} no assignee. You are receiving this as an admin ` +
                'of this workspace — not because these items are assigned to you. Assigning someone moves ' +
                'an item out of this list and into theirs.',
        };
    }
    return {
        subject: `${marker}${count} ${noun} due`,
        heading: 'Your due work items',
        intro: `You have ${count} ${noun} that ${one ? 'needs' : 'need'} your attention:`,
    };
}

const groupHeading = { fontSize: '13px', fontWeight: 600, margin: '16px 0 4px' };
const itemLine = { ...paragraph, margin: '2px 0' };

export function DueDigestEmail(props: DueDigestEmailProps) {
    const lede = digestLede(props.audience, props.items);
    return (
        <EmailLayout preview={summaryLine(props.items)} heading={lede.heading}>
            <Text style={paragraph}>Hi {props.recipientName},</Text>
            <Text style={paragraph}>{lede.intro}</Text>
            {URGENCY_ORDER.map((urgency) => {
                const group = props.items.filter((i) => i.urgency === urgency);
                if (group.length === 0) return null;
                return (
                    <Section key={urgency}>
                        <Text style={{ ...groupHeading, color: URGENCY_COLOR[urgency] }}>
                            {URGENCY_LABEL[urgency]} ({group.length})
                        </Text>
                        {group.map((item) => (
                            <Text key={`${item.entityType}:${item.entityId}`} style={itemLine}>
                                {item.name} — {item.reason}
                            </Text>
                        ))}
                    </Section>
                );
            })}
            <Button href={props.link} style={button}>
                Open the workspace
            </Button>
        </EmailLayout>
    );
}
