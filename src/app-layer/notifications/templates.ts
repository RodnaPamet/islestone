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

import type { DueItem } from '../jobs/types';

import { appLink } from './app-link';
import { DueDigestEmail, digestLede, summaryLine, URGENCY_LABEL, URGENCY_ORDER } from './email/due-digest';
import type { DigestAudience } from './email/due-digest';
import { PRODUCT_NAME } from './email/layout';
import { WorkItemAssignedEmail, workItemLabel } from './email/work-item-assigned';

export type { DigestAudience } from './email/due-digest';

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

// ─── Due digest ───

export interface DueDigestPayload {
    recipientName: string;
    tenantSlug: string;
    items: DueItem[];
    /** Why this reader was chosen — decides whether the copy claims the items are theirs. */
    audience: DigestAudience;
}

export async function buildDueDigestEmail(payload: DueDigestPayload): Promise<EmailTemplateResult> {
    // The workspace home until sub-phase 2.3 gives work items a route.
    const link = appLink(`/t/${payload.tenantSlug}`);
    const lede = digestLede(payload.audience, payload.items);
    const element = createElement(DueDigestEmail, {
        recipientName: payload.recipientName,
        items: payload.items,
        audience: payload.audience,
        link,
    });
    const groups = URGENCY_ORDER.flatMap((urgency) => {
        const group = payload.items.filter((i) => i.urgency === urgency);
        if (group.length === 0) return [];
        return [`${URGENCY_LABEL[urgency]} (${group.length})`, ...group.map((i) => `  ${i.name} — ${i.reason}`), ''];
    });
    return {
        subject: lede.subject,
        bodyText: [
            `Hi ${payload.recipientName},`,
            '',
            lede.intro,
            summaryLine(payload.items),
            '',
            ...groups,
            `Open the workspace: ${link}`,
            '',
            `— ${PRODUCT_NAME}`,
        ].join('\n'),
        bodyHtml: await render(element),
    };
}
