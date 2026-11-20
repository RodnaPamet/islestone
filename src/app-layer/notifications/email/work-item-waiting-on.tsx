/**
 * "A work item is waiting on you" (`EmailNotificationType.WORK_ITEM_WAITING_ON`,
 * sub-phase 2.7c): mailed at once to the person an item now waits on, when
 * their preference for the type is IMMEDIATE (owner decision 132; the
 * default). It names the item and who set it, never the item's description.
 *
 * Written fresh for Islestone with react-email.
 */
import { Button, Section, Text } from '@react-email/components';

import { EmailLayout, button, paragraph } from './layout';
import { workItemLabel } from './work-item-assigned';

export interface WorkItemWaitingOnEmailProps {
    recipientName: string;
    /** Who named them; absent when the name is not known. */
    setterName?: string;
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

export function waitingOnLede(setterName: string | undefined): string {
    return setterName ? `${setterName} marked a work item as waiting on you:` : 'A work item is now waiting on you:';
}

export function WorkItemWaitingOnEmail(props: WorkItemWaitingOnEmailProps) {
    const label = workItemLabel(props);
    return (
        <EmailLayout preview={`Waiting on you: ${label}`} heading="A work item is waiting on you">
            <Text style={paragraph}>Hi {props.recipientName},</Text>
            <Text style={paragraph}>{waitingOnLede(props.setterName)}</Text>
            <Section style={callout}>
                <Text style={{ ...paragraph, margin: 0, fontWeight: 600 }}>{label}</Text>
            </Section>
            <Button href={props.link} style={button}>
                Open the work item
            </Button>
        </EmailLayout>
    );
}
