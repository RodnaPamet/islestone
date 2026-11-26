/**
 * Public intake forms (sub-phase 2.6b; docs/porting/maps/2.6.md "Tenant
 * resolution and the public surface"; owner decisions 86, 88, 89 and 98).
 *
 * A form an admin published for "anyone with the link" is reached at
 * `/f/<publicId>` by someone with no session and no membership. Everything
 * here is built so that link reveals nothing and costs its abuser something:
 *
 * - **Resolution without disclosure.** `resolvePublicIntakeForm` reads one
 *   narrow row under `runWithoutRls({ reason: 'public-intake-resolve' })`
 *   (the one bypass of this surface, decision 98) and answers `null`, which
 *   every caller turns into one identical 404, for an unknown id, a members'
 *   form, an unpublished or archived form, an archived or deleted project, a
 *   project with intake off, a deleted workspace, and a deployment with
 *   public forms closed (`isPublicIntakeOpen`). Everything after it runs in
 *   `runInTenantContext` for the workspace it found, as that workspace's
 *   system user (`buildTenantSystemJobContext`): a request from outside is
 *   written for nobody.
 * - **Bot defence, all in-house (decision 88).** The page embeds a signed
 *   form token (`issueFormToken`): the submit refuses one older than a day,
 *   younger than three seconds, for another form or an older version of this
 *   one; its nonce makes at most one request (a unique column, so a replay
 *   fails inside the insert's own transaction). The browser solves a small
 *   proof-of-work bound to the token. A filled trap field answers the success
 *   screen and stores nothing, and so does an address blocked on the form's
 *   project or the workspace (2.6c). The per-IP limits and the size cap are the
 *   route's (`src/lib/intake/public/http.ts`); the daily caps are counted here
 *   from the database under the form's row lock, because production's
 *   in-memory limiter forgets on every deploy (decision 50).
 * - **The requester (decision 89).** The form may ask for a name and an
 *   address (personal data, encrypted in place by the PII extension; the
 *   address matched through its lookup hash). Ticking "Email me about this
 *   request" sends ONE email asking them to confirm the address (at most one
 *   per address per form per day, by the outbox's dedupe key); notices are
 *   sent only after they press the button on the confirmation page. An
 *   address confirmed once on a form is not asked again on that form.
 *
 * Audit entries name ids, the channel and booleans, never a name, address,
 * title, text or answer.
 *
 * Written fresh for Islestone; the narrow pre-tenant resolution follows the
 * discipline of inflect-compliance's trust-centre resolver
 * (`src/lib/trust-center/gated.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e;
 * pattern only, no code copied).
 */
import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { emitAutomationEvent } from '../automation';
import { buildTenantSystemJobContext } from '../context-system';
import { logEvent } from '../events/audit';
import { IntakeEmailRepository } from '../repositories/IntakeEmailRepository';
import { IntakeRepository } from '../repositories/IntakeRepository';
import { appLink } from '../notifications/app-link';
import { enqueueEmail } from '../notifications/enqueue';
import type { RequestContext } from '../types';
import { cleanText, cleanTitle, enqueueRequesterNotices, notifyIntakeReceived, storedAnswersOf } from './intake-request';
import { runInTenantContext } from '@/lib/db-context';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { AppError, ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { compilePublicIntakeRequestSchema, readDefinition, type IntakeAnswer, type IntakeFormDefinition } from '@/lib/intake/form-definition';
import { cleanRequesterName } from '@/lib/intake/requester-name';
import { isPublicIntakeOpen } from '@/lib/intake/public-switch';
import { issueFormToken, verifyFormToken, verifyProofOfWork } from '@/lib/intake/public/form-token';
import { intakeReference } from '@/lib/intake/reference';
import { hashForLookup } from '@/lib/security/encryption';

/** A form's public id: 16 random bytes, base64url (`createIntakeForm`). */
const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;
/** A confirmation link's token: 32 random bytes, base64url. */
const CONFIRM_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** The window a daily cap counts over: the last 24 hours. */
const CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Public requests one workspace takes across its forms in 24 hours (docs/porting/maps/2.6.md). */
export const WORKSPACE_PUBLIC_DAILY_CAP = 2_000;
/** A confirmation link works this long after the request was sent. */
export const CONFIRM_LINK_DAYS = 7;

/** The one answer for every form that is not open to the public, whatever the reason. */
export function publicFormNotFound(): AppError {
    return notFound('Form not found');
}

export interface ResolvedPublicForm {
    id: string;
    tenantId: string;
    tenantSlug: string;
    projectId: string;
    projectKeyPrefix: string;
    name: string;
    definition: IntakeFormDefinition;
    definitionVersion: number;
    dailyCap: number;
}

/**
 * The open public form a link names, or `null` for every other case (see the
 * file's header). One indexed read on the global unique `publicId`.
 */
export async function resolvePublicIntakeForm(publicId: string): Promise<ResolvedPublicForm | null> {
    if (!isPublicIntakeOpen()) return null;
    if (typeof publicId !== 'string' || !PUBLIC_ID.test(publicId)) return null;
    const f = await runWithoutRls({ reason: 'public-intake-resolve' }, (db) =>
        db.intakeForm.findUnique({
            where: { publicId },
            select: {
                id: true,
                tenantId: true,
                projectId: true,
                name: true,
                access: true,
                publishedAt: true,
                archivedAt: true,
                definitionJson: true,
                definitionVersion: true,
                dailyCap: true,
                project: { select: { archivedAt: true, deletedAt: true, keyPrefix: true, intake: { select: { enabled: true } } } },
                tenant: { select: { slug: true, deletedAt: true } },
            },
        }),
    );
    if (
        !f ||
        f.access !== 'PUBLIC' ||
        f.publishedAt === null ||
        f.archivedAt !== null ||
        f.project.archivedAt !== null ||
        f.project.deletedAt !== null ||
        f.project.intake?.enabled !== true ||
        f.tenant.deletedAt !== null
    ) {
        return null;
    }
    return {
        id: f.id,
        tenantId: f.tenantId,
        tenantSlug: f.tenant.slug,
        projectId: f.projectId,
        projectKeyPrefix: f.project.keyPrefix,
        name: f.name,
        definition: readDefinition(f.definitionJson),
        definitionVersion: f.definitionVersion,
        dailyCap: f.dailyCap,
    };
}

/** What the public page renders: the form's own published text and a fresh signed token. Nothing about the workspace. */
export interface PublicIntakeFormView {
    publicId: string;
    name: string;
    definition: IntakeFormDefinition;
    token: string;
}

export async function getPublicIntakeForm(publicId: string): Promise<PublicIntakeFormView | null> {
    const form = await resolvePublicIntakeForm(publicId);
    if (!form) return null;
    return { publicId, name: form.name, definition: form.definition, token: issueFormToken(publicId, form.definitionVersion) };
}

const EnvelopeSchema = z
    .object({
        /** The signed form token the page embedded. */
        token: z.string().min(1).max(200),
        /** The proof-of-work's counter (`src/lib/intake/pow.ts`). */
        proof: z.number().int().nonnegative(),
        /** The trap: a person never sees or fills it. */
        website: z.string().max(500).optional(),
        /** The request itself, validated by the form's own compiled schema. */
        request: z.unknown(),
    })
    .strict();

/**
 * What the success screen says about email: nothing asked (`NONE`), "confirm
 * your address from the email we sent" (`CONFIRM_PENDING`; at most one email
 * per address per form per day, so a second request that day is confirmed by
 * the first one's link), or "you will get updates" (`CONFIRMED`: the address
 * was confirmed on this form before).
 */
export type PublicIntakeUpdates = 'NONE' | 'CONFIRM_PENDING' | 'CONFIRMED';

export interface PublicIntakeReceipt {
    reference: string;
    confirmation: string;
    updates: PublicIntakeUpdates;
}

function tokenRefused(): AppError {
    return new AppError('This form could not be sent. Reload the page and try again.', 'FORM_TOKEN_REFUSED', 400);
}

function formResting(): AppError {
    return new AppError('This form is not taking requests right now. Try again later.', 'FORM_RESTING', 429);
}

function isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

/**
 * Take one request through a public form. The route has already applied the
 * per-IP limits, the cross-site refusal and the size cap.
 */
export async function submitPublicIntakeRequest(publicId: string, raw: unknown, now: Date = new Date()): Promise<PublicIntakeReceipt> {
    const form = await resolvePublicIntakeForm(publicId);
    if (!form) throw publicFormNotFound();

    const envelope = EnvelopeSchema.safeParse(raw);
    if (!envelope.success) throw badRequest('The request is not valid.');
    const { token, proof, website, request } = envelope.data;

    const check = verifyFormToken(token, publicId, form.definitionVersion, now.getTime());
    if (!check.ok) {
        if (check.reason === 'STALE_FORM') {
            throw new ConflictError('This form changed since the page was opened. Reload the page to see it.', { reason: 'FORM_CHANGED' });
        }
        throw tokenRefused();
    }
    if (!verifyProofOfWork(token, proof)) throw tokenRefused();

    // The trap: the success screen, and nothing stored.
    if (website !== undefined && website.trim() !== '') {
        const claimed = (request ?? {}) as { requesterEmail?: unknown; wantsUpdates?: unknown };
        return {
            reference: randomBytes(6).toString('hex').slice(0, 8).toUpperCase(),
            confirmation: form.definition.confirmation,
            updates: claimed.wantsUpdates === true && typeof claimed.requesterEmail === 'string' && claimed.requesterEmail.length > 0 ? 'CONFIRM_PENDING' : 'NONE',
        };
    }

    const parsed = compilePublicIntakeRequestSchema(form.definition).safeParse(request);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw badRequest(issue?.message ?? 'The request is not valid.', { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) });
    }
    const input = parsed.data as {
        title: string;
        body?: string;
        answers: Partial<Record<string, IntakeAnswer>>;
        requesterName?: string;
        requesterEmail?: string;
        wantsUpdates?: boolean;
    };
    const name = cleanRequesterName(input.requesterName);
    const email = input.requesterEmail ? input.requesterEmail.trim() : null;
    const updatesRequested = input.wantsUpdates === true && email !== null;

    const ctx = await buildTenantSystemJobContext({ tenantId: form.tenantId, tenantSlug: form.tenantSlug, job: 'intake-public-submit' });
    const created = await runInTenantContext(ctx, async (db) => {
        // The daily caps, counted under the form's row lock so two submits
        // count one after the other.
        if (!(await IntakeRepository.lockForm(db, ctx, form.id))) throw publicFormNotFound();
        // A blocked sender (2.6c): answered like the trap, nothing stored or sent.
        if (email && (await IntakeEmailRepository.isBlocked(db, ctx, form.projectId, hashForLookup(email)))) return null;
        const since = new Date(now.getTime() - CAP_WINDOW_MS);
        if ((await IntakeRepository.countFormRequestsSince(db, ctx, form.id, since)) >= form.dailyCap) throw formResting();
        if ((await IntakeRepository.countChannelSince(db, ctx, 'PUBLIC_FORM', since)) >= WORKSPACE_PUBLIC_DAILY_CAP) throw formResting();

        const confirmedBefore = updatesRequested && email ? await IntakeRepository.addressConfirmedOnForm(db, ctx, form.id, hashForLookup(email)) : false;
        const confirmToken = updatesRequested && !confirmedBefore ? randomBytes(32).toString('base64url') : null;
        const stored = storedAnswersOf(form.definition, input.answers);

        let row;
        try {
            row = await IntakeRepository.createRequest(db, ctx, {
                projectId: form.projectId,
                channel: 'PUBLIC_FORM',
                formId: form.id,
                formDefinitionVersion: form.definitionVersion,
                title: cleanTitle(input.title),
                body: cleanText(input.body),
                answersJson: stored.length > 0 ? JSON.stringify(stored) : null,
                requesterUserId: null,
                requesterName: name,
                requesterEmail: email,
                updatesRequested,
                updatesConfirmedAt: confirmedBefore ? now : null,
                confirmTokenHash: confirmToken ? sha256Hex(confirmToken) : null,
                formTokenNonce: check.nonce,
            });
        } catch (err) {
            // The form token's nonce is unique per workspace: this token already made a request.
            if (isUniqueViolation(err)) throw new ConflictError('This form was already sent. Reload the page to send another request.', { reason: 'FORM_ALREADY_SENT' });
            throw err;
        }
        await logEvent(db, ctx, {
            action: 'INTAKE_REQUEST_RECEIVED',
            entityType: 'IntakeRequest',
            entityId: row.id,
            details: `Request received in project ${form.projectKeyPrefix} through public form ${form.id}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'IntakeRequest', operation: 'created', summary: 'INTAKE_REQUEST_RECEIVED' },
            metadata: {
                projectId: form.projectId,
                channel: 'PUBLIC_FORM',
                formId: form.id,
                formDefinitionVersion: form.definitionVersion,
                updatesRequested,
                addressConfirmedBefore: confirmedBefore,
            },
        });
        await emitAutomationEvent(ctx, {
            event: 'INTAKE_REQUEST_RECEIVED',
            entityType: 'IntakeRequest',
            entityId: row.id,
            actorUserId: ctx.userId,
            stableKey: row.id,
            data: { projectId: form.projectId, channel: 'PUBLIC_FORM', status: 'PENDING', formId: form.id, workItemId: null, declineReason: null },
        });
        if (confirmToken && email) {
            // At most one per address per form per day: the dedupe entity is
            // the form. The confirmation page is outside the app (the
            // requester is not a member), so it is the email's only link.
            await enqueueEmail(db, {
                tenantId: ctx.tenantId,
                type: 'INTAKE_CONFIRM_ADDRESS',
                toEmail: email,
                entityId: form.id,
                payload: { formName: form.name, reference: intakeReference(row.id), confirmUrl: appLink(`/f/confirm/${confirmToken}`) },
            });
        }
        const updates: PublicIntakeUpdates = !updatesRequested ? 'NONE' : confirmedBefore ? 'CONFIRMED' : 'CONFIRM_PENDING';
        return { row, updates };
    });
    if (created === null) {
        return { reference: randomBytes(6).toString('hex').slice(0, 8).toUpperCase(), confirmation: form.definition.confirmation, updates: updatesRequested ? 'CONFIRM_PENDING' : 'NONE' };
    }
    await notifyIntakeReceived(ctx, created.row, form.projectKeyPrefix);
    return { reference: intakeReference(created.row.id), confirmation: form.definition.confirmation, updates: created.updates };
}

/**
 * A requester presses "Confirm my address" (the POST behind the emailed
 * link's page; a GET never confirms, because mail scanners follow links).
 * Confirms the address on the request's form, the link's request and the
 * address's other requests on that form included, and sends any decision
 * already made on them. Every refusal is the same 404.
 */
export async function confirmIntakeRequesterAddress(rawToken: string, now: Date = new Date()): Promise<{ confirmed: true }> {
    if (!isPublicIntakeOpen()) throw publicFormNotFound();
    if (typeof rawToken !== 'string' || !CONFIRM_TOKEN.test(rawToken)) throw invalidLink();
    const tokenHash = sha256Hex(rawToken);
    const found = await runWithoutRls({ reason: 'public-intake-resolve' }, (db) =>
        db.intakeRequest.findUnique({ where: { confirmTokenHash: tokenHash }, select: { tenantId: true, tenant: { select: { slug: true, deletedAt: true } } } }),
    );
    if (!found || found.tenant.deletedAt !== null) throw invalidLink();

    const ctx: RequestContext = await buildTenantSystemJobContext({ tenantId: found.tenantId, tenantSlug: found.tenant.slug, job: 'intake-confirm-address' });
    await runInTenantContext(ctx, async (db) => {
        const r = await IntakeRepository.getByConfirmToken(db, ctx, tokenHash);
        if (!r || !r.formId || !r.requesterEmailHash) throw invalidLink();
        if (now.getTime() - r.createdAt.getTime() > CONFIRM_LINK_DAYS * 24 * 60 * 60 * 1000) throw invalidLink();
        const ids = await IntakeRepository.confirmAddressOnForm(db, ctx, r.formId, r.requesterEmailHash, now);
        if (ids.length === 0) throw invalidLink();
        await logEvent(db, ctx, {
            action: 'INTAKE_REQUEST_REQUESTER_CONFIRMED',
            entityType: 'IntakeRequest',
            entityId: r.id,
            details: `The requester confirmed their address for ${ids.length} request(s) on form ${r.formId}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'IntakeRequest', operation: 'updated', summary: 'INTAKE_REQUEST_REQUESTER_CONFIRMED', changedFields: ['updatesConfirmedAt'] },
            metadata: { formId: r.formId, requestIds: ids },
        });
        // A decision made before the address was confirmed is sent now.
        const decided = await IntakeRepository.listDecidedForNotice(db, ctx, ids);
        const accepted = decided.filter((d) => d.status === 'ACCEPTED').map((d) => d.id);
        const merged = decided.filter((d) => d.status === 'MERGED').map((d) => d.id);
        if (accepted.length > 0) await enqueueRequesterNotices(db, ctx, accepted, { kind: 'ACCEPTED' });
        if (merged.length > 0) await enqueueRequesterNotices(db, ctx, merged, { kind: 'MERGED' });
        for (const d of decided) {
            if (d.status !== 'DECLINED' || !d.declineReason || d.declineReason === 'SPAM') continue;
            // guardrail-allow: n+1 — the declined requests among one address's requests on one form, each its own reason.
            await enqueueRequesterNotices(db, ctx, [d.id], { kind: 'DECLINED', reason: d.declineReason, explanation: d.declineExplanation });
        }
    });
    return { confirmed: true };
}

function invalidLink(): AppError {
    return notFound('This link is not valid or has expired.');
}
