/**
 * Enqueue an email into the NotificationOutbox.
 *
 * Copied from inflect-compliance `src/app-layer/notifications/enqueue.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, over Islestone's email types
 * and the react-email templates (rendering is async, awaited before the
 * insert). The first caller of `WORK_ITEM_ASSIGNED` is sub-phase 2.2.
 *
 * - Builds email content from templates.
 * - Computes dedupeKey to prevent duplicate sends for the same event.
 * - Uses Prisma's unique constraint to skip silently on duplicates.
 * - Logs with requestId for correlation.
 */

import type { PrismaTx } from '@/lib/db-context';
import type { EmailNotificationType } from '@prisma/client';
import { isNotificationsEnabled } from './settings';
import { logger } from '@/lib/observability/logger';
import { hashForLookup } from '@/lib/security/encryption';
import {
    buildIntakeRequesterEmail,
    buildNotificationDigestEmail,
    buildWorkItemAssignedEmail,
    buildWorkItemWaitingOnEmail,
    buildWorkItemMentionedEmail,
    buildWorkItemReviewEmail,
    type EmailTemplateResult,
    type IntakeConfirmAddressPayload,
    type IntakeDeclinedPayload,
    type IntakeRequesterPayload,
    type NotificationDigestPayload,
    type WorkItemAssignedPayload,
    type WorkItemWaitingOnPayload,
    type WorkItemMentionedPayload,
    type WorkItemReviewPayload,
} from './templates';

/**
 * The payload each email type takes. Exhaustive over
 * `EmailNotificationType`: a new enum value fails `tsc` here until it has a
 * payload and a builder.
 */
export interface EmailPayloadByType {
    WORK_ITEM_ASSIGNED: WorkItemAssignedPayload;
    /**
     * Retired (2.7c, owner decision 133): the daily `NOTIFICATION_DIGEST`
     * replaced it and nothing may write it. `never` makes an input of this
     * type unconstructible; the enum value stays only because Postgres
     * cannot drop it.
     */
    DUE_DIGEST: never;
    /** Sub-phase 2.6b: a public form's requester (outsiders; owner decision 89). */
    INTAKE_CONFIRM_ADDRESS: IntakeConfirmAddressPayload;
    INTAKE_ACCEPTED: IntakeRequesterPayload;
    INTAKE_DECLINED: IntakeDeclinedPayload;
    INTAKE_MERGED: IntakeRequesterPayload;
    /** Sub-phase 2.6c: an emailed request received, to an authenticated sender only (decision 123). */
    INTAKE_RECEIVED_ACK: IntakeRequesterPayload;
    /** Sub-phase 2.7c: the person an item now waits on, when their preference is IMMEDIATE. */
    WORK_ITEM_WAITING_ON: WorkItemWaitingOnPayload;
    /** Sub-phase 2.7c: the one daily digest (owner decision 133). */
    NOTIFICATION_DIGEST: NotificationDigestPayload;
    /** Sub-phase 2.7d: a person newly mentioned, when their preference is IMMEDIATE (decision 130: never the text). */
    WORK_ITEM_MENTIONED: WorkItemMentionedPayload;
    /** Sub-phase 2.8a: a review asked of you, when your preference is IMMEDIATE (decision 161: never the response text). */
    WORK_ITEM_REVIEW_REQUESTED: WorkItemReviewPayload;
    /** Sub-phase 2.8a: a reviewer returned the item, when your preference is IMMEDIATE. */
    WORK_ITEM_REVIEW_RETURNED: WorkItemReviewPayload;
}

type EmailPayloadMap = { [K in EmailNotificationType]: EmailPayloadByType[K] };

export type EnqueueEmailInput = {
    [K in EmailNotificationType]: {
        tenantId: string;
        type: K;
        toEmail: string;
        entityId: string;
        payload: EmailPayloadMap[K];
        sendAfter?: Date;
        requestId?: string;
        /** A Reply-To (2.6c: an emailed request's reply address). Not personal data. */
        replyTo?: string;
    };
}[EmailNotificationType];

/**
 * Build a dedupe key for idempotent email sending.
 *
 * Format: `{tenantId}:{type}:{recipientHash}:{entityId}:{YYYY-MM-DD}`
 *
 * ─── WHY THE RECIPIENT IS HASHED (#3577) ───────────────────────────────────
 *
 * In inflect-compliance this key once embedded the address itself: THE SAME
 * PERSONAL DATA IN A SECOND PLACE, which is what makes a deletion or a DSAR
 * incomplete — anything that redacts or encrypts `toEmail` (Islestone encrypts
 * it, src/lib/security/pii-middleware.ts) leaves the address intact in a
 * uniquely-indexed column with no retention rule of its own.
 *
 * ─── WHY `hashForLookup` AND NOT A NEW CONSTRUCTION ────────────────────────
 *
 * Because the repository already solved this exact problem. `hashForLookup` is
 * the blind-index primitive behind `User.emailHash`, which sign-in uses to find
 * a user without storing the address in the clear:
 * HMAC-SHA256 under an HKDF-derived subkey of `DATA_ENCRYPTION_KEY`, with the
 * production-required / dev-fallback handling already in place. Inventing a
 * second keyed hash here would have meant a second key to source, a second
 * rotation story and a second thing to get wrong.
 *
 * KEYED, not a bare digest, and that distinction is the whole value: an
 * unkeyed SHA-256 of a corporate address is reversible by dictionary attack
 * over a known user base, so it would pseudonymise nothing.
 *
 * ─── CASE ───────────────────────────────────────────────────────────────────
 *
 * `hashForLookup` lowercases and trims before hashing, so `Alice@acme.com` and
 * `alice@acme.com` produce the SAME key and the second is deduped away: one
 * mailbox, one notification.
 */
export function buildDedupeKey(
    tenantId: string,
    type: string,
    email: string,
    entityId: string,
    date: Date = new Date(),
): string {
    const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
    return `${tenantId}:${type}:${hashForLookup(email)}:${entityId}:${day}`;
}

/**
 * Enqueue an email notification into the outbox.
 * Silently skips if dedupeKey already exists (idempotent).
 * Silently skips if tenant notifications are disabled.
 *
 * @returns The created record, or null if duplicate/disabled.
 */
export async function enqueueEmail(
    db: PrismaTx,
    input: EnqueueEmailInput,
): Promise<{ id: string; dedupeKey: string } | null> {
    const { tenantId, type, toEmail, entityId, sendAfter, requestId, replyTo } = input;

    // Check tenant settings — skip if disabled
    const enabled = await isNotificationsEnabled(db, tenantId);
    if (!enabled) {
        if (requestId) {
            logger.debug('notification skipped — disabled for tenant', { component: 'notifications' });
        }
        return null;
    }

    // Build email content from template
    const { subject, bodyText, bodyHtml }: EmailTemplateResult = await buildEmailContent(input);

    // Compute dedupe key
    const dedupeKey = buildDedupeKey(tenantId, type, toEmail, entityId);

    // ON CONFLICT DO NOTHING, never a caught P2002 (#5061). Callers pass
    // their interactive transaction, and a statement that fails inside one
    // aborts it in Postgres: the duplicate was swallowed here, then the
    // caller's next statement, or its commit, failed with 25P02 and rolled
    // back the assignment or approval request the email was about.
    const { count } = await db.notificationOutbox.createMany({
        data: [
            {
                tenantId,
                type,
                toEmail,
                subject,
                bodyText,
                bodyHtml,
                dedupeKey,
                ...(sendAfter ? { sendAfter } : {}),
                ...(replyTo ? { replyTo } : {}),
            },
        ],
        skipDuplicates: true,
    });
    if (count === 0) {
        if (requestId) {
            logger.debug('notification skipped — duplicate', { component: 'notifications', type });
        }
        return null;
    }
    const record = await db.notificationOutbox.findUnique({
        where: { dedupeKey },
        select: { id: true },
    });
    if (requestId) {
        logger.debug('notification enqueued', { component: 'notifications', type });
    }
    return record ? { id: record.id, dedupeKey } : null;
}

/**
 * Build email content based on notification type. Exhaustive: the `never` in
 * the default branch fails `tsc` for an unhandled type.
 */
async function buildEmailContent(input: EnqueueEmailInput): Promise<EmailTemplateResult> {
    switch (input.type) {
        case 'WORK_ITEM_ASSIGNED':
            return buildWorkItemAssignedEmail(input.payload);
        case 'DUE_DIGEST':
            throw new Error('DUE_DIGEST is retired (sub-phase 2.7c): the daily NOTIFICATION_DIGEST replaced it');
        case 'WORK_ITEM_WAITING_ON':
            return buildWorkItemWaitingOnEmail(input.payload);
        case 'NOTIFICATION_DIGEST':
            return buildNotificationDigestEmail(input.payload);
        case 'WORK_ITEM_MENTIONED':
            return buildWorkItemMentionedEmail(input.payload);
        case 'WORK_ITEM_REVIEW_REQUESTED':
            return buildWorkItemReviewEmail('REQUESTED', input.payload);
        case 'WORK_ITEM_REVIEW_RETURNED':
            return buildWorkItemReviewEmail('RETURNED', input.payload);
        case 'INTAKE_CONFIRM_ADDRESS':
            return buildIntakeRequesterEmail('CONFIRM', input.payload);
        case 'INTAKE_ACCEPTED':
            return buildIntakeRequesterEmail('ACCEPTED', input.payload);
        case 'INTAKE_DECLINED':
            return buildIntakeRequesterEmail('DECLINED', input.payload);
        case 'INTAKE_MERGED':
            return buildIntakeRequesterEmail('MERGED', input.payload);
        case 'INTAKE_RECEIVED_ACK':
            return buildIntakeRequesterEmail('RECEIVED', input.payload);
        default: {
            const unhandled: never = input;
            throw new Error(`Unknown notification type: ${(unhandled as { type: string }).type}`);
        }
    }
}
