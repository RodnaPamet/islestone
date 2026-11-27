/**
 * The returned-timesheet email (sub-phase 3.4c; docs/porting/maps/3.4.md,
 * "Notifications (decision 276)"; ADR 0012 §8): mailed at once when the
 * person's preference for `TIMESHEET_RETURNED` is IMMEDIATE (the default),
 * when an approver returns their week or reopens an approved one.
 *
 * It names the week and who decided, NEVER the explanation's text (the map:
 * "Your timesheet for the week of 23 November was returned. Open it to see
 * why.").
 *
 * Written fresh for Islestone with react-email.
 */
import { Button, Text } from '@react-email/components';

import { EmailLayout, button, paragraph } from './layout';

export interface TimesheetReturnedEmailProps {
    recipientName: string;
    /** Who returned or reopened it; absent when not known. */
    actorName?: string;
    /** "23 November 2026". */
    weekLabel: string;
    /** An approved week reopened, rather than a submitted week returned. */
    reopened: boolean;
    /** Absolute link to the person's week (built with `appLink`). */
    link: string;
}

export function timesheetReturnedHeading(reopened: boolean): string {
    return reopened ? 'Your timesheet was reopened' : 'Your timesheet was returned';
}

export function timesheetReturnedLede(p: Pick<TimesheetReturnedEmailProps, 'actorName' | 'weekLabel' | 'reopened'>): string {
    const who = p.actorName?.trim();
    const verb = p.reopened ? 'reopened your approved timesheet' : 'returned your timesheet';
    return `${who || 'An approver'} ${verb} for the week of ${p.weekLabel}. Open it to see why.`;
}

export function TimesheetReturnedEmail(props: TimesheetReturnedEmailProps) {
    const heading = timesheetReturnedHeading(props.reopened);
    return (
        <EmailLayout preview={`${heading}: the week of ${props.weekLabel}`} heading={heading}>
            <Text style={paragraph}>Hi {props.recipientName},</Text>
            <Text style={paragraph}>{timesheetReturnedLede(props)}</Text>
            <Button href={props.link} style={button}>
                Open your week
            </Button>
        </EmailLayout>
    );
}
