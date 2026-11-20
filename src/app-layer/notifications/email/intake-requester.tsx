/**
 * The emails a public form's requester may receive (sub-phase 2.6b; owner
 * decision 89): the one asking them to confirm their address, then, once
 * confirmed, "accepted", "declined" (with the reason and the explanation the
 * triager chose to send) and "handled together with another request".
 *
 * Each names the form and the request's short reference only, never the
 * title, text or answers the requester typed: otherwise anyone could make the
 * workspace's sender deliver their words to a stranger's address. The
 * requester is not a member, so no email links into the app; the only link is
 * the confirmation page, which is outside it.
 *
 * Written fresh for Islestone, on the layout of the other react-email
 * templates.
 */
import { Button, Section, Text } from '@react-email/components';

import { EmailLayout, button, paragraph } from './layout';

export type IntakeRequesterEmailKind = 'CONFIRM' | 'ACCEPTED' | 'DECLINED' | 'MERGED' | 'RECEIVED';

export interface IntakeRequesterEmailProps {
    kind: IntakeRequesterEmailKind;
    /** The form it was sent through; `null` for a request that arrived by email (2.6c). */
    formName: string | null;
    reference: string;
    /** CONFIRM: the absolute confirmation page link. */
    confirmUrl?: string;
    /** DECLINED: the reason's label ("Not planned"). */
    reasonLabel?: string;
    /** DECLINED: the explanation the triager wrote for the requester, if any. */
    explanation?: string | null;
}

const callout = {
    backgroundColor: '#f4f6fa',
    borderLeft: '4px solid #4f46e5',
    padding: '12px 16px',
    margin: '16px 0',
    borderRadius: '4px',
};

export const INTAKE_REQUESTER_HEADING: Record<IntakeRequesterEmailKind, string> = {
    CONFIRM: 'Confirm your email address',
    ACCEPTED: 'Your request was accepted',
    DECLINED: 'Your request was declined',
    MERGED: 'Your request is being handled with another',
    RECEIVED: 'We received your request',
};

/** How a request came in, as a phrase: through its form, or by email. */
function via(p: Pick<IntakeRequesterEmailProps, 'formName'>): string {
    return p.formName ? `sent through the form "${p.formName}"` : 'sent by email';
}

export function intakeRequesterLines(p: IntakeRequesterEmailProps): string[] {
    switch (p.kind) {
        case 'CONFIRM':
            return [
                `You sent a request through the form "${p.formName}" (reference ${p.reference}) and asked to be emailed about it.`,
                'Confirm this address to get updates. If you did not send it, ignore this email: nothing more will be sent.',
            ];
        case 'ACCEPTED':
            return [`Your request ${p.reference}, ${via(p)}, was accepted and will be worked on.`];
        case 'DECLINED':
            return [
                `Your request ${p.reference}, ${via(p)}, was declined.`,
                `Reason: ${p.reasonLabel ?? 'Not given'}.`,
                ...(p.explanation ? [p.explanation] : []),
            ];
        case 'MERGED':
            return [
                `Your request ${p.reference}, ${via(p)}, is being handled together with an existing request.`,
            ];
        case 'RECEIVED':
            return [
                `We received your request. Its reference is ${p.reference}.`,
                'To add to it, reply to this email. You will hear from us when it is decided.',
            ];
    }
}

export function IntakeRequesterEmail(props: IntakeRequesterEmailProps) {
    const lines = intakeRequesterLines(props);
    return (
        <EmailLayout preview={INTAKE_REQUESTER_HEADING[props.kind]} heading={INTAKE_REQUESTER_HEADING[props.kind]}>
            <Text style={paragraph}>Hello,</Text>
            {props.kind === 'DECLINED' ? (
                <>
                    <Text style={paragraph}>{lines[0]}</Text>
                    <Section style={callout}>
                        {lines.slice(1).map((l, i) => (
                            <Text key={i} style={{ ...paragraph, margin: 0, whiteSpace: 'pre-wrap' }}>
                                {l}
                            </Text>
                        ))}
                    </Section>
                </>
            ) : (
                lines.map((l, i) => (
                    <Text key={i} style={paragraph}>
                        {l}
                    </Text>
                ))
            )}
            {props.kind === 'CONFIRM' && props.confirmUrl ? (
                <Button href={props.confirmUrl} style={button}>
                    Confirm my address
                </Button>
            ) : null}
        </EmailLayout>
    );
}
