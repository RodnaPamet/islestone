/**
 * "You were mentioned" (`EmailNotificationType.WORK_ITEM_MENTIONED`,
 * sub-phase 2.7d): mailed at once to a person newly mentioned in a comment or
 * a description, when their preference for mentions is IMMEDIATE (owner
 * decisions 128, 130 and 132; the default). It names who mentioned them and
 * the item, and links to it; it never carries the comment's or the
 * description's text (decision 130).
 *
 * Written fresh for Islestone with react-email.
 */
import { Button, Section, Text } from '@react-email/components';

import { EmailLayout, button, paragraph } from './layout';
import { workItemLabel } from './work-item-assigned';

export interface WorkItemMentionedEmailProps {
    recipientName: string;
    /** Who mentioned them; absent when the name is not known. */
    mentionedByName?: string;
    /** Where: a comment, or the item's description. */
    where: 'comment' | 'description';
    workItemTitle: string;
    workItemKey?: string | null;
    /** Absolute link to the item (built with `appLink`). */
    link: string;
}

const callout = {
    backgroundColor: '#f4f6fa',
    borderLeft: '4px solid #4f46e5',
    padding: '12px 16px',
    margin: '16px 0',
    borderRadius: '4px',
};

export function mentionedLede(mentionedByName: string | undefined, where: 'comment' | 'description'): string {
    const who = mentionedByName?.trim() || 'Someone';
    return where === 'comment' ? `${who} mentioned you in a comment on a work item:` : `${who} mentioned you in the description of a work item:`;
}

export function WorkItemMentionedEmail(props: WorkItemMentionedEmailProps) {
    const label = workItemLabel(props);
    return (
        <EmailLayout preview={`Mentioned on ${label}`} heading="You were mentioned">
            <Text style={paragraph}>Hi {props.recipientName},</Text>
            <Text style={paragraph}>{mentionedLede(props.mentionedByName, props.where)}</Text>
            <Section style={callout}>
                <Text style={{ ...paragraph, margin: 0, fontWeight: 600 }}>{label}</Text>
            </Section>
            <Button href={props.link} style={button}>
                Open the work item
            </Button>
        </EmailLayout>
    );
}
