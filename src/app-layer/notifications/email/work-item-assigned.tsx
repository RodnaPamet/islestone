/**
 * "A work item was assigned to you" (`EmailNotificationType.WORK_ITEM_ASSIGNED`).
 * The first caller is sub-phase 2.2's assignment usecase.
 *
 * Written for Islestone with react-email; replaces inflect-compliance's
 * `buildTaskAssignedEmail` (pattern only).
 */
import { Button, Section, Text } from '@react-email/components';

import { EmailLayout, button, paragraph } from './layout';

export interface WorkItemAssignedEmailProps {
    workItemTitle: string;
    /** The item's key (`ISL-12`), when it has one. */
    workItemKey?: string | null;
    assigneeName: string;
    assignerName?: string;
    /** Absolute link to the item (built with `appLink`). */
    link: string;
}

export function workItemLabel(p: { workItemTitle: string; workItemKey?: string | null }): string {
    return `${p.workItemKey ? `[${p.workItemKey}] ` : ''}${p.workItemTitle}`;
}

const callout = {
    backgroundColor: '#f4f6fa',
    borderLeft: '4px solid #4f46e5',
    padding: '12px 16px',
    margin: '16px 0',
    borderRadius: '4px',
};

export function WorkItemAssignedEmail(props: WorkItemAssignedEmailProps) {
    const label = workItemLabel(props);
    return (
        <EmailLayout preview={`Assigned to you: ${label}`} heading="A work item was assigned to you">
            <Text style={paragraph}>Hi {props.assigneeName},</Text>
            <Text style={paragraph}>
                {props.assignerName ? `${props.assignerName} assigned you a work item:` : 'You were assigned a work item:'}
            </Text>
            <Section style={callout}>
                <Text style={{ ...paragraph, margin: 0, fontWeight: 600 }}>{label}</Text>
            </Section>
            <Button href={props.link} style={button}>
                Open the work item
            </Button>
        </EmailLayout>
    );
}
