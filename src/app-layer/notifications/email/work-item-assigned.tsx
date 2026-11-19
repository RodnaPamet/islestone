/**
 * "A work item was assigned to you" (`EmailNotificationType.WORK_ITEM_ASSIGNED`).
 * The first caller is sub-phase 2.2's assignment usecase.
 *
 * Written for Islestone with react-email; replaces inflect-compliance's
 * `buildTaskAssignedEmail` and `buildTaskAssignedDigestEmail` (`templates.ts`
 * lines 17–109 at 5528464fc54a8681956f3b9ce23ca9c075f0420e; pattern only):
 * one mail for one item, a digest for a bulk assign, the type row's name
 * rendered as given, no by-line without an assigner name, and no parent
 * product sign-off.
 */
import { Button, Section, Text } from '@react-email/components';

import { EmailLayout, button, paragraph } from './layout';

export interface AssignedLine {
    workItemTitle: string;
    /** The item's key (`ISL-12`), when it has one. */
    workItemKey?: string | null;
    /** The type row's name, as given ("Bug"). */
    workItemTypeName?: string | null;
}

export type WorkItemAssignedEmailProps = (AssignedLine | { items: AssignedLine[] }) & {
    assigneeName: string;
    assignerName?: string;
    /** Absolute link (built with `appLink`): the item, or My Work for a digest. */
    link: string;
};

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

function lineLabel(line: AssignedLine): string {
    const label = workItemLabel(line);
    return line.workItemTypeName ? `${label} (${line.workItemTypeName})` : label;
}

export function WorkItemAssignedEmail(props: WorkItemAssignedEmailProps) {
    if ('items' in props) {
        const n = props.items.length;
        return (
            <EmailLayout preview={`${n} work items assigned to you`} heading="Work items were assigned to you">
                <Text style={paragraph}>Hi {props.assigneeName},</Text>
                <Text style={paragraph}>
                    {props.assignerName ? `${props.assignerName} assigned you ${n} work items:` : `You were assigned ${n} work items:`}
                </Text>
                <Section style={callout}>
                    {props.items.map((line, i) => (
                        <Text key={i} style={{ ...paragraph, margin: 0, fontWeight: 600 }}>
                            {lineLabel(line)}
                        </Text>
                    ))}
                </Section>
                <Button href={props.link} style={button}>
                    Open My Work
                </Button>
            </EmailLayout>
        );
    }
    const label = workItemLabel(props);
    const what = props.workItemTypeName ? `a ${props.workItemTypeName}` : 'a work item';
    return (
        <EmailLayout preview={`Assigned to you: ${label}`} heading="A work item was assigned to you">
            <Text style={paragraph}>Hi {props.assigneeName},</Text>
            <Text style={paragraph}>
                {props.assignerName ? `${props.assignerName} assigned you ${what}:` : `You were assigned ${what}:`}
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
