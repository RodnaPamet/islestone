/**
 * Inbound email intake (sub-phase 2.6c; docs/porting/maps/2.6.md "Inbound
 * email"; owner decisions 87, 98, 99 and 120 to 123).
 *
 * Two halves, because Resend's `email.received` webhook carries metadata only
 * (decision 122):
 *
 * 1. `receiveInboundEmailEvent` — the webhook, after its route verified the
 *    Svix signature and capped the body. It resolves the intake address
 *    (`<token>@<domain>`, or a reply address `<token>+r<replyToken>@…`) under
 *    `runWithoutRls({ reason: 'webhook-ingest' })`, the surface's one
 *    pre-tenant read; an unknown or disabled address, or inbound email closed
 *    on the deployment, stores nothing and answers the same 200. Then, in the
 *    workspace's context as its system user: a repeat delivery (`svix-id`) or
 *    a repeat email (`email_id`) is a no-op (a still-pending one is enqueued
 *    again, so a lost enqueue heals on the provider's retry); the per-address
 *    and per-sender throttles and the blocked senders record a DROPPED row
 *    (counted, never fetched); anything else records a PENDING row and
 *    enqueues `intake-email-fetch`. Nothing is fetched inline.
 * 2. `processInboundEmail` — the job. It claims the row, retrieves the email
 *    from Resend's API, downloads the raw `.eml` from its signed URL (pinned
 *    hosts, `safeFetch`, a capped read), parses it, and makes the request or
 *    the follow-up in one transaction. Idempotent: a settled row is skipped,
 *    a message already stored (by its Message-ID's hash) is not stored twice.
 *
 * Sender authentication (decision 123): only the configured MTA's
 * `Authentication-Results` is believed; VERIFIED is acknowledged
 * (`INTAKE_RECEIVED_ACK`, with the request's reply address as Reply-To),
 * counts as a confirmed address for later notices, and attributes the request
 * to a member whose address it is (decision 99). Anything else is
 * unauthenticated: stored, never answered. Spam is a triage action and blocked
 * senders; nothing is scored automatically, so even FAILED is left for a person.
 * Auto-replies and bounces are dropped and never answered, which also keeps
 * another system's auto-responder from looping with ours.
 *
 * Audit entries name ids, the channel, codes and counts; never an address,
 * name, subject or text. Written fresh for Islestone.
 */
import { z } from 'zod';

import { emitAutomationEvent } from '../automation';
import { buildTenantSystemJobContext } from '../context-system';
import { logEvent } from '../events/audit';
import { enqueue } from '../jobs/queue';
import { IntakeEmailRepository, type InboundRow } from '../repositories/IntakeEmailRepository';
import { IntakeRepository } from '../repositories/IntakeRepository';
import { enqueueEmail } from '../notifications/enqueue';
import type { RequestContext } from '../types';
import { cleanText, cleanTitle, notifyIntakeReceived } from './intake-request';
import { env } from '@/env';
import { runInTenantContext } from '@/lib/db-context';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { addressesIn, mailboxOf, mintReplyToken, parseIntakeAddress, replyAddress, type IntakeAddress } from '@/lib/intake/email/address';
import { contentFromFields, contentFromRaw, type InboundContent } from '@/lib/intake/email/content';
import { retrieveReceivedEmail, ResendTerminalError } from '@/lib/intake/email/resend-api';
import { downloadRawEmail } from '@/lib/intake/email/resend-download';
import { intakeEmailDomain, isInboundEmailOpen } from '@/lib/intake/email/switch';
import { intakeReference } from '@/lib/intake/reference';
import { logger } from '@/lib/observability/logger';
import { hashForLookup } from '@/lib/security/encryption';
import { sanitizePlainText } from '@/lib/security/sanitize';

/** Per address: emails an hour and a day; per sender on an address: an hour (docs/porting/maps/2.6.md). */
export const INBOUND_THROTTLE = { addressPerHour: 30, addressPerDay: 300, senderPerHour: 10 } as const;
/** The fetch job's attempts before a delivery is settled FAILED. */
export const INBOUND_MAX_ATTEMPTS = 5;
export { INBOUND_RETENTION_DAYS } from '../domain/intake';

const HOUR = 60 * 60 * 1000;

// ─── The webhook ──────────────────────────────────────────────────────────

/**
 * Resend's `email.received` event, as far as intake reads it (field names from
 * Resend's documentation via search; re-check against resend.com before
 * go-live). Unknown fields are ignored; another event type is acknowledged and
 * ignored.
 */
const EventSchema = z
    .object({
        type: z.string(),
        data: z
            .object({
                email_id: z.string().min(1).max(200),
                from: z.string().max(2000).nullish(),
                to: z.union([z.array(z.string().max(2000)).max(100), z.string().max(20_000)]).nullish(),
                cc: z.union([z.array(z.string().max(2000)).max(100), z.string().max(20_000)]).nullish(),
            })
            .passthrough(),
    })
    .passthrough();

export type InboundOutcome = 'IGNORED' | 'CLOSED' | 'UNKNOWN_ADDRESS' | 'DUPLICATE' | 'REQUEUED' | 'THROTTLED' | 'THROTTLED_SENDER' | 'BLOCKED' | 'QUEUED';

interface ResolvedAddress extends IntakeAddress {
    tenantId: string;
    tenantSlug: string;
    projectId: string;
    projectKeyPrefix: string;
}

function recipientsOf(data: { to?: string[] | string | null; cc?: string[] | string | null }): string[] {
    const list = (v: string[] | string | null | undefined) => (Array.isArray(v) ? v.flatMap(addressesIn) : v ? addressesIn(v) : []);
    return [...list(data.to), ...list(data.cc)];
}

/** The first recipient that is an open intake address, or null (one indexed read per candidate, at most a few). */
async function resolveAddress(recipients: readonly string[]): Promise<ResolvedAddress | null> {
    const domain = intakeEmailDomain();
    const candidates = recipients.map((r) => parseIntakeAddress(r, domain)).filter((a): a is IntakeAddress => a !== null).slice(0, 5);
    if (candidates.length === 0) return null;
    const rows = await runWithoutRls({ reason: 'webhook-ingest' }, (db) =>
        db.projectIntake.findMany({
            where: { emailToken: { in: candidates.map((c) => c.token) } },
            take: candidates.length,
            select: {
                emailToken: true,
                enabled: true,
                emailEnabled: true,
                tenantId: true,
                projectId: true,
                project: { select: { keyPrefix: true, archivedAt: true, deletedAt: true } },
                tenant: { select: { slug: true, deletedAt: true } },
            },
        }),
    );
    for (const c of candidates) {
        const r = rows.find((x) => x.emailToken === c.token);
        if (!r || !r.enabled || !r.emailEnabled || r.project.archivedAt || r.project.deletedAt || r.tenant.deletedAt) continue;
        return { ...c, tenantId: r.tenantId, tenantSlug: r.tenant.slug, projectId: r.projectId, projectKeyPrefix: r.project.keyPrefix };
    }
    return null;
}

function isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

function jobIdFor(inboundId: string): string {
    return `intake-email-${inboundId}`;
}

/**
 * Take one verified webhook delivery. The answer to the provider is the same
 * 200 whatever the outcome; the outcome is for logs and tests.
 */
export async function receiveInboundEmailEvent(input: { svixId: string; payload: unknown }): Promise<InboundOutcome> {
    if (!isInboundEmailOpen()) return 'CLOSED';
    const parsed = EventSchema.safeParse(input.payload);
    if (!parsed.success || parsed.data.type !== 'email.received') return 'IGNORED';
    const data = parsed.data.data;
    const address = await resolveAddress(recipientsOf(data));
    if (!address) return 'UNKNOWN_ADDRESS';

    const sender = mailboxOf(data.from ?? '').address;
    const senderHash = sender ? hashForLookup(sender) : null;
    const ctx = await buildTenantSystemJobContext({ tenantId: address.tenantId, tenantSlug: address.tenantSlug, job: 'intake-email-webhook' });
    const now = Date.now();

    let result: { outcome: InboundOutcome; enqueueId: string | null };
    try {
        result = await runInTenantContext(ctx, async (db) => {
            const seen = await IntakeEmailRepository.findInbound(db, ctx, input.svixId, data.email_id);
            if (seen) return { outcome: seen.status === 'PENDING' ? 'REQUEUED' : 'DUPLICATE', enqueueId: seen.status === 'PENDING' ? seen.id : null };

            let dropped: Extract<InboundOutcome, 'THROTTLED' | 'THROTTLED_SENDER' | 'BLOCKED'> | null = null;
            if (
                (await IntakeEmailRepository.countInboundSince(db, ctx, address.projectId, new Date(now - HOUR))) >= INBOUND_THROTTLE.addressPerHour ||
                (await IntakeEmailRepository.countInboundSince(db, ctx, address.projectId, new Date(now - 24 * HOUR))) >= INBOUND_THROTTLE.addressPerDay
            ) {
                dropped = 'THROTTLED';
            } else if (senderHash && (await IntakeEmailRepository.countInboundSince(db, ctx, address.projectId, new Date(now - HOUR), senderHash)) >= INBOUND_THROTTLE.senderPerHour) {
                dropped = 'THROTTLED_SENDER';
            } else if (senderHash && (await IntakeEmailRepository.isBlocked(db, ctx, address.projectId, senderHash))) {
                dropped = 'BLOCKED';
            }
            const row = await IntakeEmailRepository.createInbound(db, ctx, {
                projectId: address.projectId,
                svixId: input.svixId,
                emailId: data.email_id,
                senderHash,
                replyToken: address.replyToken,
                status: dropped ? 'DROPPED' : 'PENDING',
                outcome: dropped,
            });
            return { outcome: dropped ?? 'QUEUED', enqueueId: dropped ? null : row.id };
        });
    } catch (err) {
        // Two deliveries of one email racing: the other recorded it.
        if (isUniqueViolation(err)) return 'DUPLICATE';
        throw err;
    }
    if (result.enqueueId) {
        // A failure here answers 500, so the provider retries; the retry finds
        // the pending row and enqueues it again (the job id is the row's, so
        // BullMQ keeps one).
        await enqueue('intake-email-fetch', { tenantId: address.tenantId, inboundId: result.enqueueId }, { jobId: jobIdFor(result.enqueueId) });
    }
    return result.outcome;
}

// ─── The job ──────────────────────────────────────────────────────────────

export type ProcessOutcome =
    | 'SKIPPED'
    | 'REQUEST_CREATED'
    | 'FOLLOW_UP_ADDED'
    | 'DUPLICATE'
    | 'AUTO_REPLY'
    | 'BLOCKED'
    | 'REQUEST_CLOSED'
    | 'ADDRESS_OFF'
    | 'NO_CONTENT'
    | 'FAILED';

async function settle(ctx: RequestContext, row: InboundRow, status: 'DROPPED' | 'FAILED', outcome: string): Promise<void> {
    await runInTenantContext(ctx, (db) => IntakeEmailRepository.finishInbound(db, ctx, row.id, { status, outcome }));
}

/** The message's content: the raw `.eml` when it can be read, else the API's parsed fields, unauthenticated. */
async function contentOf(row: InboundRow): Promise<InboundContent | null> {
    const received = await retrieveReceivedEmail(row.emailId);
    const fallback = () =>
        received.text || received.html || received.subject
            ? contentFromFields({
                  emailId: row.emailId,
                  subject: received.subject,
                  from: received.from,
                  text: received.text,
                  html: received.html,
                  messageId: received.messageId,
                  attachments: received.attachments,
              })
            : null;
    if (!received.downloadUrl) return fallback();
    const raw = await downloadRawEmail(received.downloadUrl);
    if (!raw.ok) {
        logger.warn('intake email: raw message not read, using the parsed fields', { component: 'intake-email', inboundId: row.id, reason: raw.reason });
        return fallback();
    }
    return contentFromRaw(raw.bytes, { emailId: row.emailId, authservId: env.INTAKE_EMAIL_AUTHSERV_ID });
}

/** The `intake-email-fetch` job: fetch one delivery's email and make its request or follow-up. */
export async function processInboundEmail(input: { tenantId: string; inboundId: string }): Promise<ProcessOutcome> {
    const ctx = await buildTenantSystemJobContext({ tenantId: input.tenantId, job: 'intake-email-fetch' });
    const row = await runInTenantContext(ctx, (db) => IntakeEmailRepository.getInbound(db, ctx, input.inboundId));
    if (!row || row.status !== 'PENDING') return 'SKIPPED';
    const claimed = await runInTenantContext(ctx, (db) => IntakeEmailRepository.claimInbound(db, ctx, row.id, row.attempts));
    if (claimed === 0) return 'SKIPPED';
    const attempt = row.attempts + 1;

    let content: InboundContent | null;
    try {
        content = await contentOf(row);
    } catch (err) {
        if (err instanceof ResendTerminalError) {
            await settle(ctx, row, 'FAILED', `FETCH_${err.code}`);
            return 'FAILED';
        }
        if (attempt >= INBOUND_MAX_ATTEMPTS) {
            await settle(ctx, row, 'FAILED', 'FETCH_FAILED');
            return 'FAILED';
        }
        throw err; // retried by the queue
    }
    if (!content) {
        await settle(ctx, row, 'DROPPED', 'NO_CONTENT');
        return 'NO_CONTENT';
    }
    if (content.automated) {
        await settle(ctx, row, 'DROPPED', 'AUTO_REPLY');
        return 'AUTO_REPLY';
    }
    const c = content;
    const domain = intakeEmailDomain();

    const done = await runInTenantContext(ctx, async (db) => {
        const intake = await IntakeEmailRepository.getProjectEmail(db, ctx, row.projectId);
        if (!intake || !intake.enabled || !intake.emailEnabled || !intake.emailToken) {
            await IntakeEmailRepository.finishInbound(db, ctx, row.id, { status: 'DROPPED', outcome: 'ADDRESS_OFF' });
            return { outcome: 'ADDRESS_OFF' as const };
        }
        const fromHash = c.fromAddress ? hashForLookup(c.fromAddress) : null;
        if (fromHash && (await IntakeEmailRepository.isBlocked(db, ctx, row.projectId, fromHash))) {
            await IntakeEmailRepository.finishInbound(db, ctx, row.id, { status: 'DROPPED', outcome: 'BLOCKED' });
            return { outcome: 'BLOCKED' as const };
        }
        const body = cleanText(c.body);

        // A reply to a request's reply address, from its requester: a follow-up.
        if (row.replyToken) {
            const target = await IntakeEmailRepository.findRequestByReplyToken(db, ctx, row.projectId, row.replyToken);
            if (target && fromHash && target.requesterEmailHash === fromHash) {
                if (target.status !== 'PENDING' && target.status !== 'SNOOZED') {
                    await IntakeEmailRepository.finishInbound(db, ctx, row.id, { status: 'DROPPED', outcome: 'REQUEST_CLOSED' });
                    return { outcome: 'REQUEST_CLOSED' as const };
                }
                if (await IntakeEmailRepository.followUpByDedupeHash(db, ctx, c.dedupeHash)) {
                    await IntakeEmailRepository.finishInbound(db, ctx, row.id, { status: 'DROPPED', outcome: 'DUPLICATE' });
                    return { outcome: 'DUPLICATE' as const };
                }
                if (!body) {
                    await IntakeEmailRepository.finishInbound(db, ctx, row.id, { status: 'DROPPED', outcome: 'NO_CONTENT' });
                    return { outcome: 'NO_CONTENT' as const };
                }
                const follow = await IntakeEmailRepository.createFollowUp(db, ctx, {
                    requestId: target.id,
                    body,
                    sourceDedupeHash: c.dedupeHash,
                    attachmentsDropped: c.attachmentsDropped,
                });
                // A follow-up brings a snoozed request back (decision 90).
                const woke =
                    target.status === 'SNOOZED' &&
                    (await IntakeRepository.claimAndUpdate(db, ctx, target.id, ['SNOOZED'], target.version, { status: 'PENDING', snoozedUntil: null, snoozedByUserId: null })) === 1;
                await logEvent(db, ctx, {
                    action: 'INTAKE_FOLLOW_UP_RECEIVED',
                    entityType: 'IntakeRequest',
                    entityId: target.id,
                    details: `A follow-up email was added to request ${target.id}`,
                    detailsJson: { category: 'entity_lifecycle', entityName: 'IntakeFollowUp', operation: 'created', summary: 'INTAKE_FOLLOW_UP_RECEIVED' },
                    metadata: { followUpId: follow.id, inboundId: row.id, woke, attachmentsDropped: c.attachmentsDropped },
                });
                await IntakeEmailRepository.finishInbound(db, ctx, row.id, { status: 'PROCESSED', outcome: null, followUpId: follow.id, requestId: target.id });
                return { outcome: 'FOLLOW_UP_ADDED' as const };
            }
        }

        // A new request, once per message.
        if (await IntakeEmailRepository.requestByDedupeHash(db, ctx, c.dedupeHash)) {
            await IntakeEmailRepository.finishInbound(db, ctx, row.id, { status: 'DROPPED', outcome: 'DUPLICATE' });
            return { outcome: 'DUPLICATE' as const };
        }
        const authenticated = c.senderCheck === 'VERIFIED' && c.fromAddress !== null;
        const member = authenticated && fromHash ? await IntakeEmailRepository.activeMemberByEmailHash(db, ctx, fromHash) : null;
        const replyToken = mintReplyToken();
        const name = c.fromName ? sanitizePlainText(c.fromName).replace(/\s+/g, ' ').trim().slice(0, 100) || null : null;
        const created = await IntakeRepository.createRequest(db, ctx, {
            projectId: row.projectId,
            channel: 'EMAIL',
            formId: null,
            formDefinitionVersion: null,
            title: cleanTitle(c.title),
            body,
            answersJson: null,
            requesterUserId: member?.userId ?? null,
            requesterName: name,
            requesterEmail: c.fromAddress,
            // An authenticated sender's address counts as confirmed for later notices.
            updatesRequested: authenticated,
            updatesConfirmedAt: authenticated ? new Date() : null,
            senderCheck: c.senderCheck,
            replyToken,
            sourceDedupeHash: c.dedupeHash,
            attachmentsDropped: c.attachmentsDropped,
        });
        await logEvent(db, ctx, {
            action: 'INTAKE_REQUEST_RECEIVED',
            entityType: 'IntakeRequest',
            entityId: created.id,
            details: `Request received by email in project ${row.projectId}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'IntakeRequest', operation: 'created', summary: 'INTAKE_REQUEST_RECEIVED' },
            metadata: {
                projectId: row.projectId,
                channel: 'EMAIL',
                inboundId: row.id,
                senderCheck: c.senderCheck,
                attributedToMember: member !== null,
                attachmentsDropped: c.attachmentsDropped,
            },
        });
        await emitAutomationEvent(ctx, {
            event: 'INTAKE_REQUEST_RECEIVED',
            entityType: 'IntakeRequest',
            entityId: created.id,
            actorUserId: ctx.userId,
            stableKey: created.id,
            data: { projectId: row.projectId, channel: 'EMAIL', status: 'PENDING', formId: null, workItemId: null, declineReason: null },
        });
        if (authenticated && c.fromAddress) {
            await enqueueEmail(db, {
                tenantId: ctx.tenantId,
                type: 'INTAKE_RECEIVED_ACK',
                toEmail: c.fromAddress,
                entityId: created.id,
                replyTo: replyAddress(intake.emailToken, replyToken, domain),
                payload: { formName: null, reference: intakeReference(created.id) },
            });
        }
        await IntakeEmailRepository.finishInbound(db, ctx, row.id, { status: 'PROCESSED', outcome: null, requestId: created.id });
        return { outcome: 'REQUEST_CREATED' as const, created, keyPrefix: intake.project.keyPrefix };
    });
    // After the commit: the notify list's bell.
    if (done.outcome === 'REQUEST_CREATED' && 'created' in done) await notifyIntakeReceived(ctx, done.created, done.keyPrefix);
    return done.outcome;
}
