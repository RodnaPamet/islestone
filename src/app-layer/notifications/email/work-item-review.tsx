/**
 * The two review emails (sub-phase 2.8a; ADR 0009; owner decision 161), each
 * mailed at once when the recipient's preference for the type is IMMEDIATE
 * (the default):
 *
 *   - "Review requested" (`EmailNotificationType.WORK_ITEM_REVIEW_REQUESTED`):
 *     a review step you are a reviewer of opened, or you were added to an
 *     open one;
 *   - "Work item returned" (`WORK_ITEM_REVIEW_RETURNED`): a reviewer returned
 *     a work item you are the assignee of, or whose round you sent.
 *
 * Each names the item, the step and who; never the response text (decision
 * 157) or the item's description.
 *
 * Written fresh for Islestone with react-email.
 */
import { Button, Section, Text } from '@react-email/components';

import { EmailLayout, button, paragraph } from './layout';
import { workItemLabel } from './work-item-assigned';

export type WorkItemReviewEmailKind = 'REQUESTED' | 'RETURNED';

export interface WorkItemReviewEmailProps {
    kind: WorkItemReviewEmailKind;
    recipientName: string;
    /** Who sent the round (requested) or returned it (returned); absent when not known. */
    actorName?: string;
    stepName: string;
    workItemTitle: string;
    workItemKey?: string | null;
    /** Absolute link to the item (built with `appLink`). */
    link: string;
}

export const REVIEW_EMAIL_HEADING: Record<WorkItemReviewEmailKind, string> = {
    REQUESTED: 'Your review is requested',
    RETURNED: 'A work item was returned',
};

const callout = {
    backgroundColor: '#f4f6fa',
    borderLeft: '4px solid #4f46e5',
    padding: '12px 16px',
    margin: '16px 0',
    borderRadius: '4px',
};

export function reviewEmailLede(kind: WorkItemReviewEmailKind, actorName: string | undefined, stepName: string): string {
    const who = actorName?.trim();
    if (kind === 'REQUESTED') {
        return `${who ? `${who} asks you` : 'You are asked'} to review a work item at the step "${stepName}":`;
    }
    return `${who || 'A reviewer'} returned a work item at the review step "${stepName}":`;
}

export function WorkItemReviewEmail(props: WorkItemReviewEmailProps) {
    const label = workItemLabel(props);
    return (
        <EmailLayout preview={`${REVIEW_EMAIL_HEADING[props.kind]}: ${label}`} heading={REVIEW_EMAIL_HEADING[props.kind]}>
            <Text style={paragraph}>Hi {props.recipientName},</Text>
            <Text style={paragraph}>{reviewEmailLede(props.kind, props.actorName, props.stepName)}</Text>
            <Section style={callout}>
                <Text style={{ ...paragraph, margin: 0, fontWeight: 600 }}>{label}</Text>
            </Section>
            <Button href={props.link} style={button}>
                Open the work item
            </Button>
        </EmailLayout>
    );
}
