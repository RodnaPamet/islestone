/**
 * Email template builders, one per `EmailNotificationType`.
 *
 * Each returns `{ subject, bodyText, bodyHtml }` (`EmailTemplateResult`, the
 * contract the outbox stores), rendered from a react-email component in
 * `./email/`. Rendering is ASYNC, so every builder returns a promise and every
 * caller awaits it before writing the outbox row.
 *
 * Every link into the app goes through `appLink`, which makes it absolute
 * against the deployment's public origin (inflect-compliance #4130): a relative
 * href does not open from a mail client.
 *
 * Written for Islestone with react-email in place of inflect-compliance's
 * hand-built HTML templates (`templates.ts`, `digest-templates.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e; pattern only). React escapes every
 * interpolated value, so there is no `escapeHtml`.
 */
import { render } from '@react-email/components';
import { createElement } from 'react';

import { appLink } from './app-link';
import {
    DIGEST_DUE_LABEL,
    DIGEST_DUE_ORDER,
    digestSubject,
    dueLineText,
    NotificationDigestEmail,
    type DigestDueLine,
    type DigestNotificationLine,
    type NotificationDigestEmailProps,
} from './email/notification-digest';
import {
    INTAKE_REQUESTER_HEADING,
    IntakeRequesterEmail,
    intakeRequesterLines,
    type IntakeRequesterEmailKind,
} from './email/intake-requester';
import { PRODUCT_NAME } from './email/layout';
import { WorkItemAssignedEmail, workItemLabel } from './email/work-item-assigned';
import { WorkItemWaitingOnEmail, waitingOnLede } from './email/work-item-waiting-on';
import { WorkItemMentionedEmail, mentionedLede } from './email/work-item-mentioned';

export type { DigestDueGroup } from './email/notification-digest';

export interface EmailTemplateResult {
    subject: string;
    bodyText: string;
    bodyHtml: string;
}

// ─── Work item assigned ───

/** One work item in an assignment mail. */
export interface AssignedWorkItemLine {
    workItemTitle: string;
    workItemKey?: string | null;
    /** The item's type row's name, rendered as given ("assigned you a Bug"). */
    workItemTypeName?: string | null;
}

/** One item assigned (the single mail). */
export interface WorkItemAssignedSinglePayload extends AssignedWorkItemLine {
    assigneeName: string;
    assignerName?: string;
    /**
     * The item's path in the app (`/t/<slug>/…`). Sub-phase 2.3 owns the
     * route; the caller builds it with `workItemPath`.
     */
    linkPath: string;
}

/**
 * Several items handed over by one bulk assign (the digest): one mail for
 * everything the action newly gave the assignee (inflect-compliance #4278).
 */
export interface WorkItemAssignedDigestPayload {
    items: AssignedWorkItemLine[];
    assigneeName: string;
    assignerName?: string;
    /** The workspace's My Work page, `/t/<slug>/my-work`. */
    linkPath: string;
}

export type WorkItemAssignedPayload = WorkItemAssignedSinglePayload | WorkItemAssignedDigestPayload;

function lineText(line: AssignedWorkItemLine): string {
    const label = workItemLabel(line);
    return line.workItemTypeName ? `${label} (${line.workItemTypeName})` : label;
}

export async function buildWorkItemAssignedEmail(payload: WorkItemAssignedPayload): Promise<EmailTemplateResult> {
    const link = appLink(payload.linkPath);
    if ('items' in payload) {
        const element = createElement(WorkItemAssignedEmail, { ...payload, link });
        const lines = payload.items.map((i) => `  ${lineText(i)}`);
        return {
            subject: `${payload.items.length} work items assigned to you`,
            bodyText: [
                `Hi ${payload.assigneeName},`,
                '',
                payload.assignerName
                    ? `${payload.assignerName} assigned you ${payload.items.length} work items:`
                    : `You were assigned ${payload.items.length} work items:`,
                '',
                ...lines,
                '',
                `Open My Work: ${link}`,
                '',
                `— ${PRODUCT_NAME}`,
            ].join('\n'),
            bodyHtml: await render(element),
        };
    }
    const label = workItemLabel(payload);
    const element = createElement(WorkItemAssignedEmail, { ...payload, link });
    const what = payload.workItemTypeName ? `a ${payload.workItemTypeName}` : 'a work item';
    return {
        subject: `Assigned to you: ${label}`,
        bodyText: [
            `Hi ${payload.assigneeName},`,
            '',
            payload.assignerName ? `${payload.assignerName} assigned you ${what}:` : `You were assigned ${what}:`,
            '',
            `  ${label}`,
            '',
            `Open the work item: ${link}`,
            '',
            `— ${PRODUCT_NAME}`,
        ].join('\n'),
        bodyHtml: await render(element),
    };
}

// ─── Waiting on you (2.7c) ───

export interface WorkItemWaitingOnPayload {
    recipientName: string;
    setterName?: string;
    workItemTitle: string;
    workItemKey?: string | null;
    /** The item's path in the app (`/t/<slug>/…`, `tenantWorkItemPath`). */
    linkPath: string;
}

export async function buildWorkItemWaitingOnEmail(payload: WorkItemWaitingOnPayload): Promise<EmailTemplateResult> {
    const link = appLink(payload.linkPath);
    const label = workItemLabel(payload);
    return {
        subject: `Waiting on you: ${label}`,
        bodyText: [
            `Hi ${payload.recipientName},`,
            '',
            waitingOnLede(payload.setterName),
            '',
            `  ${label}`,
            '',
            `Open the work item: ${link}`,
            '',
            `— ${PRODUCT_NAME}`,
        ].join('\n'),
        bodyHtml: await render(createElement(WorkItemWaitingOnEmail, { ...payload, link })),
    };
}

// ─── Mentions (2.7d) ───

export interface WorkItemMentionedPayload {
    recipientName: string;
    mentionedByName?: string;
    where: 'comment' | 'description';
    workItemTitle: string;
    workItemKey?: string | null;
    /** The item's path in the app (`/t/<slug>/…`, `tenantWorkItemPath`). */
    linkPath: string;
}

/** Who mentioned them, on which item, and a link; never the text (decision 130). */
export async function buildWorkItemMentionedEmail(payload: WorkItemMentionedPayload): Promise<EmailTemplateResult> {
    const link = appLink(payload.linkPath);
    const label = workItemLabel(payload);
    return {
        subject: `Mentioned on ${label}`,
        bodyText: [
            `Hi ${payload.recipientName},`,
            '',
            mentionedLede(payload.mentionedByName, payload.where),
            '',
            `  ${label}`,
            '',
            `Open the work item: ${link}`,
            '',
            `— ${PRODUCT_NAME}`,
        ].join('\n'),
        bodyHtml: await render(createElement(WorkItemMentionedEmail, { ...payload, link })),
    };
}

// ─── The daily digest (2.7c) ───

/** A due item as the digest job hands it over; paths are made absolute here. */
export interface NotificationDigestDueItem extends Omit<DigestDueLine, 'link'> {
    linkPath: string;
}

/** A notification as the digest job hands it over (the bell row's stored copy). */
export interface NotificationDigestEntry extends Omit<DigestNotificationLine, 'link'> {
    linkPath: string | null;
}

export interface NotificationDigestPayload {
    recipientName: string;
    tenantSlug: string;
    due: NotificationDigestDueItem[];
    moreDue: number;
    notifications: NotificationDigestEntry[];
    moreNotifications: number;
}

export async function buildNotificationDigestEmail(payload: NotificationDigestPayload): Promise<EmailTemplateResult> {
    const slug = encodeURIComponent(payload.tenantSlug);
    const props: NotificationDigestEmailProps = {
        recipientName: payload.recipientName,
        due: payload.due.map(({ linkPath, ...l }) => ({ ...l, link: appLink(linkPath) })),
        moreDue: payload.moreDue,
        notifications: payload.notifications.map(({ linkPath, ...n }) => ({ ...n, link: linkPath ? appLink(linkPath) : null })),
        moreNotifications: payload.moreNotifications,
        inboxLink: appLink(`/t/${slug}/inbox`),
        preferencesLink: appLink(`/t/${slug}/inbox/preferences`),
    };
    const dueTotal = props.due.length + props.moreDue;
    const notificationTotal = props.notifications.length + props.moreNotifications;
    const dueText = dueTotal === 0
        ? []
        : [
              'Work items due',
              '',
              ...DIGEST_DUE_ORDER.flatMap((group) => {
                  const lines = props.due.filter((l) => l.group === group);
                  if (lines.length === 0) return [];
                  return [`${DIGEST_DUE_LABEL[group]} (${lines.length})`, ...lines.map((l) => `  ${dueLineText(l)}: ${l.link}`), ''];
              }),
              ...(props.moreDue > 0 ? [`And ${props.moreDue} more.`, ''] : []),
          ];
    const notificationText = notificationTotal === 0
        ? []
        : [
              'Notifications',
              '',
              ...props.notifications.map((n) => `  ${n.title} — ${n.body}${n.link ? `: ${n.link}` : ''}`),
              ...(props.moreNotifications > 0 ? [`And ${props.moreNotifications} more in your Inbox.`] : []),
              '',
          ];
    return {
        subject: digestSubject(dueTotal, notificationTotal),
        bodyText: [
            `Hi ${payload.recipientName},`,
            '',
            ...dueText,
            ...notificationText,
            `Open your Inbox: ${props.inboxLink}`,
            `Change your preferences: ${props.preferencesLink}`,
            '',
            `— ${PRODUCT_NAME}`,
        ].join('\n'),
        bodyHtml: await render(createElement(NotificationDigestEmail, props)),
    };
}

// ─── A public form's requester (2.6b) ───

/** What every requester email names: the form and the short reference, never the request's own text. */
export interface IntakeRequesterPayload {
    /** `null` for a request that arrived by email (2.6c). */
    formName: string | null;
    reference: string;
}
export interface IntakeConfirmAddressPayload extends IntakeRequesterPayload {
    /** The confirmation page, absolute (`publicIntakeLink`). */
    confirmUrl: string;
}
export interface IntakeDeclinedPayload extends IntakeRequesterPayload {
    reasonLabel: string;
    explanation: string | null;
}

/** One line, for a subject: no CR, LF or other control character can reach a header. */
function oneLine(s: string): string {
    return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

const INTAKE_SUBJECT: Record<IntakeRequesterEmailKind, (p: IntakeRequesterPayload) => string> = {
    CONFIRM: (p) => `Confirm your email address for ${oneLine(p.formName ?? 'a form')}`,
    ACCEPTED: (p) => `Request ${p.reference} accepted`,
    DECLINED: (p) => `Request ${p.reference} declined`,
    MERGED: (p) => `Request ${p.reference} is being handled with another`,
    RECEIVED: (p) => `Request ${p.reference} received`,
};

export async function buildIntakeRequesterEmail(
    kind: IntakeRequesterEmailKind,
    payload: IntakeRequesterPayload & Partial<Omit<IntakeConfirmAddressPayload, keyof IntakeRequesterPayload>> & Partial<Omit<IntakeDeclinedPayload, keyof IntakeRequesterPayload>>,
): Promise<EmailTemplateResult> {
    const props = { kind, ...payload };
    const lines = intakeRequesterLines(props);
    return {
        subject: INTAKE_SUBJECT[kind](payload),
        bodyText: [
            'Hello,',
            '',
            ...lines.flatMap((l) => [l, '']),
            ...(kind === 'CONFIRM' && payload.confirmUrl ? [`Confirm my address: ${payload.confirmUrl}`, ''] : []),
            `— ${INTAKE_REQUESTER_HEADING[kind]}`,
        ].join('\n'),
        bodyHtml: await render(createElement(IntakeRequesterEmail, props)),
    };
}
