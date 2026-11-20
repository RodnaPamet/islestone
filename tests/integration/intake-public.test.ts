/**
 * Public intake forms against a real Postgres (sub-phase 2.6b;
 * docs/porting/maps/2.6.md "Tenant resolution and the public surface"; owner
 * decisions 86, 88, 89 and 98), driven through the two public route handlers
 * where the HTTP layer matters:
 *
 *   - one identical 404 for every form that is not open to the public
 *     (unknown, members only, unpublished, archived, intake off, a malformed
 *     id, public forms closed on the deployment);
 *   - a public request is stored once, as the workspace's system user, with
 *     the requester's name and address encrypted and the address hashed, its
 *     text sanitised, and nothing personal or typed in its audit entry; the
 *     notify list is rung;
 *   - the bot defence: a replayed token, a filled trap, a token too fast or
 *     for an older version of the form, a wrong proof-of-work;
 *   - the caps: the form's daily cap and the workspace's, counted in the
 *     database; the per-IP limit; the 64 KB body cap; JSON only; a
 *     cross-site post refused;
 *   - the requester (decision 89): one confirmation email that never repeats
 *     the request's text, the confirmation by POST (single use), an address
 *     confirmed once on a form, and the notices: accepted, declined (with the
 *     explanation, never for spam), merged, a decision made before the
 *     confirmation sent once it comes, nothing to an unconfirmed address;
 *   - a form is made public only while public forms are open;
 *   - the audit chain verifies.
 */
import { createHash } from 'node:crypto';

import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';

import { POST as confirmRoute } from '@/app/api/intake/confirm/route';
import { POST as submitRoute } from '@/app/api/intake/forms/[publicId]/route';
import { tenantSystemUserId } from '@/lib/tenant-system-user';
import type { RequestContext } from '@/app-layer/types';
import { createIntakeForm, listIntakeForms, updateIntakeForm } from '@/app-layer/usecases/intake-form';
import { acceptIntakeRequest, declineIntakeRequest, getIntakeRequest, mergeIntakeRequest } from '@/app-layer/usecases/intake-request';
import { getPublicIntakeForm, submitPublicIntakeRequest, WORKSPACE_PUBLIC_DAILY_CAP } from '@/app-layer/usecases/intake-public';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { verifyAuditChain } from '@/lib/audit';
import { solveProofOfWork } from '@/lib/intake/pow';
import { issueFormToken } from '@/lib/intake/public/form-token';
import { hashForLookup } from '@/lib/security/encryption';
import { clearAllRateLimits } from '@/lib/security/rate-limit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `ipub${Date.now().toString(36)}`;
const digest = async (s: string) => new Uint8Array(createHash('sha256').update(s).digest());

describeFn('public intake forms', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let projectId = '';
    let typeId = '';
    let formId = '';
    let publicId = '';
    const hidden: Record<string, string> = {};
    const saved = { flag: process.env.INTAKE_PUBLIC_FORMS, rl: process.env.RATE_LIMIT_ENABLED };

    const definition = (over: Record<string, unknown> = {}) => ({
        intro: 'Tell us what broke.',
        confirmation: 'We read every request.',
        fields: [{ id: 'f1', kind: 'SHORT_TEXT', label: 'Where', required: false }],
        requester: { name: 'OPTIONAL', email: 'OPTIONAL' },
        ...over,
    });

    beforeAll(async () => {
        process.env.INTAKE_PUBLIC_FORMS = '1';
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const u = await prisma.user.create({ data: { email: `olive-${TAG}@example.test`, name: 'Olive' } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } });
        owner = makeRequestContext('OWNER', { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-o` });
        const team = await createTeam(owner, { name: 'Core' });
        projectId = (await createProject(owner, { teamId: team.id, name: 'Support', keyPrefix: 'SUP' })).id;
        const quietProjectId = (await createProject(owner, { teamId: team.id, name: 'Quiet', keyPrefix: 'QUI' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        await setProjectIntake(owner, projectId, { enabled: true });

        const form = await createIntakeForm(owner, { projectId, name: 'Report a problem', access: 'PUBLIC', definition: definition() });
        formId = form.id;
        publicId = form.publicId!;
        await createIntakeForm(owner, { projectId, name: 'Members', definition: definition() });
        const draft = await createIntakeForm(owner, { projectId, name: 'Draft', access: 'PUBLIC', published: false, definition: definition() });
        const archived = await createIntakeForm(owner, { projectId, name: 'Old', access: 'PUBLIC', definition: definition() });
        await updateIntakeForm(owner, archived.id, { archived: true });
        const quiet = await createIntakeForm(owner, { projectId: quietProjectId, name: 'Quiet', access: 'PUBLIC', definition: definition() });
        const rows = await prisma.intakeForm.findMany({ where: { tenantId }, select: { name: true, publicId: true } });
        const byName = new Map(rows.map((r) => [r.name, r.publicId]));
        hidden.members = byName.get('Members')!;
        hidden.draft = draft.publicId!;
        hidden.archived = archived.publicId!;
        hidden.quiet = quiet.publicId!;
    });

    afterAll(async () => {
        process.env.INTAKE_PUBLIC_FORMS = saved.flag;
        process.env.RATE_LIMIT_ENABLED = saved.rl;
        clearAllRateLimits();
        await resetDatabase(prisma);
    });

    /** An envelope as the page would send it: a token minted ten seconds ago, its proof solved. */
    async function envelope(request: unknown, opts: { id?: string; version?: number; extra?: Record<string, unknown> } = {}) {
        const id = opts.id ?? publicId;
        const version = opts.version ?? (await prisma.intakeForm.findUnique({ where: { publicId: id }, select: { definitionVersion: true } }))?.definitionVersion ?? 1;
        const token = issueFormToken(id, version, Date.now() - 10_000);
        const proof = await solveProofOfWork(token, digest, { batch: 1 << 30, yieldNow: async () => undefined });
        return { token, proof, request, ...opts.extra };
    }

    function submit(id: string, body: unknown, headers: Record<string, string> = {}, raw?: string) {
        return submitRoute(
            new NextRequest(`http://localhost/api/intake/forms/${id}`, {
                method: 'POST',
                body: raw ?? JSON.stringify(body),
                headers: { 'content-type': 'application/json', 'x-request-id': 'fixed-request-id', 'x-forwarded-for': '203.0.113.7', ...headers },
            }),
            { params: Promise.resolve({ publicId: id }) },
        );
    }

    function confirm(token: string) {
        return confirmRoute(
            new NextRequest('http://localhost/api/intake/confirm', {
                method: 'POST',
                body: JSON.stringify({ token }),
                headers: { 'content-type': 'application/json', 'x-request-id': 'fixed-request-id' },
            }),
        );
    }

    const countRequests = () => prisma.intakeRequest.count({ where: { tenantId, channel: 'PUBLIC_FORM' } });
    const confirmLinkIn = (bodyText: string) => /\/f\/confirm\/([A-Za-z0-9_-]{43})/.exec(bodyText)?.[1];

    describe('resolution without disclosure', () => {
        it('every form that is not open to the public is the same 404', async () => {
            const req = { title: 'Hello' };
            const answers: Array<{ status: number; body: string }> = [];
            for (const id of ['A'.repeat(22), hidden.members!, hidden.draft!, hidden.archived!, hidden.quiet!, 'not-a-public-id']) {
                const res = await submit(id, await envelope(req, { id: id.length === 22 ? id : publicId }));
                answers.push({ status: res.status, body: await res.text() });
                expect(await getPublicIntakeForm(id)).toBeNull();
            }
            process.env.INTAKE_PUBLIC_FORMS = '0';
            try {
                const res = await submit(publicId, await envelope(req));
                answers.push({ status: res.status, body: await res.text() });
                expect(await getPublicIntakeForm(publicId)).toBeNull();
            } finally {
                process.env.INTAKE_PUBLIC_FORMS = '1';
            }
            expect(new Set(answers.map((a) => a.status))).toEqual(new Set([404]));
            expect(new Set(answers.map((a) => a.body)).size).toBe(1);
            expect(await countRequests()).toBe(0);
        });

        it("the page view carries the form's own text and a token, and nothing about the workspace", async () => {
            const view = await getPublicIntakeForm(publicId);
            expect(view).toMatchObject({ publicId, name: 'Report a problem', definition: { confirmation: 'We read every request.' } });
            expect(JSON.stringify(view)).not.toMatch(new RegExp(`${TAG}|Support|SUP|${tenantId}|${projectId}`));
        });
    });

    describe('a public request', () => {
        let firstId = '';
        let firstEnvelope: Awaited<ReturnType<typeof envelope>>;

        it('is stored once, as the system user, encrypted, sanitised, and audited without anything personal', async () => {
            firstEnvelope = await envelope({
                title: 'Printer ‮on fire <script>alert(1)</script>',
                body: 'It smokes <img src=x onerror=alert(1)>',
                answers: { f1: 'Floor 3' },
                requesterName: 'Ada <b>Lovelace</b>',
                requesterEmail: 'Ada@Example.com',
                wantsUpdates: true,
            });
            const res = await submit(publicId, firstEnvelope);
            expect(res.status).toBe(201);
            const receipt = (await res.json()) as { reference: string; confirmation: string; updates: string };
            expect(receipt).toMatchObject({ confirmation: 'We read every request.', updates: 'CONFIRM_PENDING' });
            expect(receipt.reference).toMatch(/^[A-Z0-9]{8}$/);

            const [raw] = await prisma.$queryRaw<
                Array<{ id: string; title: string; body: string; requesterName: string; requesterEmail: string; requesterEmailHash: string; requesterUserId: string | null; formTokenNonce: string | null; confirmTokenHash: string | null }>
            >`SELECT "id", "title", "body", "requesterName", "requesterEmail", "requesterEmailHash", "requesterUserId", "formTokenNonce", "confirmTokenHash"
                FROM "IntakeRequest" WHERE "tenantId" = ${tenantId} AND "channel" = 'PUBLIC_FORM'`;
            firstId = raw!.id;
            expect(firstId.slice(-8).toUpperCase()).toBe(receipt.reference);
            expect(raw!.requesterUserId).toBeNull();
            expect(raw!.title).not.toMatch(/‮|<script/i);
            expect(raw!.requesterName).not.toContain('Ada');
            expect(raw!.requesterEmail).not.toContain('xample');
            expect(raw!.body).not.toContain('smokes');
            expect(raw!.requesterEmailHash).toBe(hashForLookup('ada@example.com'));
            expect(raw!.formTokenNonce).toBe(firstEnvelope.token.split('.')[3]);
            expect(raw!.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);

            const detail = await getIntakeRequest(owner, firstId);
            expect(detail).toMatchObject({ channel: 'PUBLIC_FORM', requesterName: 'Ada Lovelace', requesterEmail: 'Ada@Example.com', requesterUpdates: 'ASKED' });
            expect(detail.body).not.toMatch(/<img|onerror/i);

            const audit = await prisma.auditLog.findFirst({ where: { tenantId, entityId: firstId, action: 'INTAKE_REQUEST_RECEIVED' } });
            expect(audit?.userId).toBe(tenantSystemUserId(tenantId));
            const auditText = JSON.stringify(audit);
            for (const leak of ['Ada', 'xample', 'Printer', 'smokes', 'Floor']) expect(auditText).not.toContain(leak);
            expect(audit?.detailsJson).toBeTruthy();

            const bell = await prisma.notification.findFirst({ where: { tenantId, userId: owner.userId, type: 'INTAKE_REQUEST_RECEIVED' } });
            expect(bell).toBeTruthy();
        });

        it('sends ONE confirmation email, naming the form and the reference and never the request text', async () => {
            const out = await prisma.notificationOutbox.findMany({ where: { tenantId, type: 'INTAKE_CONFIRM_ADDRESS' } });
            expect(out).toHaveLength(1);
            expect(out[0]!.toEmail).toBe('Ada@Example.com');
            expect(out[0]!.subject).toBe('Confirm your email address for Report a problem');
            expect(out[0]!.bodyText).toContain(firstId.slice(-8).toUpperCase());
            expect(confirmLinkIn(out[0]!.bodyText)).toBeTruthy();
            for (const typed of ['Printer', 'smokes', 'Floor', 'Lovelace']) {
                expect(out[0]!.bodyText).not.toContain(typed);
                expect(out[0]!.bodyHtml).not.toContain(typed);
            }
        });

        it('the same token cannot make a second request', async () => {
            const res = await submit(publicId, firstEnvelope);
            expect(res.status).toBe(409);
            expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CONFLICT');
            expect(await countRequests()).toBe(1);
        });

        it('a filled trap answers the success screen and stores nothing', async () => {
            const res = await submit(publicId, await envelope({ title: 'Buy now', requesterEmail: 'bot@example.com', wantsUpdates: true }, { extra: { website: 'http://spam.example' } }));
            expect(res.status).toBe(201);
            expect(await res.json()).toMatchObject({ updates: 'CONFIRM_PENDING', confirmation: 'We read every request.' });
            expect(await countRequests()).toBe(1);
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_CONFIRM_ADDRESS' } })).toBe(1);
        });

        it('refuses a token too fast, a wrong proof, a token for another form, and an older form version', async () => {
            const fresh = issueFormToken(publicId, 1, Date.now());
            const proof = await solveProofOfWork(fresh, digest, { batch: 1 << 30, yieldNow: async () => undefined });
            const tooFast = await submit(publicId, { token: fresh, proof, request: { title: 'x' } });
            expect(tooFast.status).toBe(400);
            const good = await envelope({ title: 'x' });
            expect((await submit(publicId, { ...good, proof: (good.proof ?? 0) + 1 })).status).toBe(400);
            expect((await submit(publicId, await envelope({ title: 'x' }, { id: hidden.quiet! }))).status).toBe(400);
            const stale = await envelope({ title: 'x' });
            const form = (await listIntakeForms(owner)).find((f) => f.id === formId)!;
            await updateIntakeForm(owner, formId, { definition: definition({ intro: 'Changed.' }) }, form.version);
            const res = await submit(publicId, stale);
            expect(res.status).toBe(409);
            expect(await countRequests()).toBe(1);
        });

        it("refuses a request that breaks the form's own schema, field by field", async () => {
            const res = await submit(publicId, await envelope({ title: 'x', requesterEmail: 'not an address' }));
            expect(res.status).toBe(400);
            const res2 = await submit(publicId, await envelope({ title: 'x', answers: { nope: 'y' } }));
            expect(res2.status).toBe(400);
            expect(await countRequests()).toBe(1);
        });
    });

    describe('caps and request hygiene', () => {
        it("the form's daily cap is counted in the database", async () => {
            const taken = await prisma.intakeRequest.count({ where: { tenantId, formId } });
            await prisma.intakeForm.update({ where: { id: formId }, data: { dailyCap: taken + 1 } });
            try {
                expect((await submit(publicId, await envelope({ title: 'Within the cap' }))).status).toBe(201);
                const over = await submit(publicId, await envelope({ title: 'Over the cap' }));
                expect(over.status).toBe(429);
                expect(((await over.json()) as { error: { message: string } }).error.message).toMatch(/not taking requests/);
            } finally {
                await prisma.intakeForm.update({ where: { id: formId }, data: { dailyCap: 200 } });
            }
        });

        it("the workspace's daily cap on public requests is counted across its forms", async () => {
            const have = await countRequests();
            const filler = Array.from({ length: WORKSPACE_PUBLIC_DAILY_CAP - have }, (_, i) => ({
                tenantId,
                projectId,
                channel: 'PUBLIC_FORM' as const,
                formId: formId,
                title: `filler ${i}`,
            }));
            await prisma.intakeRequest.createMany({ data: filler });
            try {
                const res = await submitPublicIntakeRequest(publicId, await envelope({ title: 'One too many' })).catch((e: { status?: number }) => e);
                expect(res).toMatchObject({ status: 429 });
            } finally {
                await prisma.intakeRequest.deleteMany({ where: { tenantId, title: { startsWith: 'filler ' } } });
            }
        });

        it('refuses a body over 64 KB, anything but JSON, and a cross-site post, storing nothing', async () => {
            const before = await countRequests();
            const big = await submit(publicId, null, {}, JSON.stringify({ token: 'x', proof: 0, request: { title: 'x'.repeat(70_000) } }));
            expect(big.status).toBe(413);
            const text = await submit(publicId, await envelope({ title: 'x' }), { 'content-type': 'text/plain' });
            expect(text.status).toBe(415);
            const cross = await submit(publicId, await envelope({ title: 'x' }), { 'sec-fetch-site': 'cross-site' });
            expect(cross.status).toBe(403);
            expect(await countRequests()).toBe(before);
        });

        it('limits one address to five submits a minute on a form', async () => {
            process.env.RATE_LIMIT_ENABLED = '1';
            clearAllRateLimits();
            try {
                const statuses: number[] = [];
                for (let i = 0; i < 6; i++) {
                    // guardrail-allow: n+1 — six sequential posts, the limiter's budget is the subject.
                    const res = await submit(publicId, { token: 'x', proof: 0, request: {} }, { 'x-forwarded-for': '198.51.100.9' });
                    statuses.push(res.status);
                }
                expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
                expect(statuses[5]).toBe(429);
            } finally {
                process.env.RATE_LIMIT_ENABLED = saved.rl;
                clearAllRateLimits();
            }
        });
    });

    describe('the requester', () => {
        let confirmedId = '';

        it('confirms their address by POST, once; a second use and a made-up token are refused', async () => {
            const out = await prisma.notificationOutbox.findFirst({ where: { tenantId, type: 'INTAKE_CONFIRM_ADDRESS' } });
            const token = confirmLinkIn(out!.bodyText)!;
            expect((await confirm(token)).status).toBe(200);
            const row = await prisma.intakeRequest.findFirst({ where: { tenantId, requesterEmailHash: hashForLookup('ada@example.com') }, orderBy: { createdAt: 'asc' } });
            confirmedId = row!.id;
            expect(row).toMatchObject({ confirmTokenHash: null });
            expect(row!.updatesConfirmedAt).toBeInstanceOf(Date);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'INTAKE_REQUEST_REQUESTER_CONFIRMED' } })).toBe(1);
            expect((await confirm(token)).status).toBe(404);
            expect((await confirm('A'.repeat(43))).status).toBe(404);
            expect((await confirm('short')).status).toBe(404);
        });

        it('an address confirmed on a form is not asked again on that form', async () => {
            const res = await submit(publicId, await envelope({ title: 'Again', requesterEmail: 'ada@example.com', wantsUpdates: true }));
            expect(await res.json()).toMatchObject({ updates: 'CONFIRMED' });
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_CONFIRM_ADDRESS' } })).toBe(1);
        });

        it('a confirmed requester is told accepted, declined (with the explanation) and merged; spam and an unconfirmed address hear nothing', async () => {
            const accepted = await getIntakeRequest(owner, confirmedId);
            await acceptIntakeRequest(owner, confirmedId, { typeId }, accepted.version);
            const acc = await prisma.notificationOutbox.findMany({ where: { tenantId, type: 'INTAKE_ACCEPTED' } });
            expect(acc).toHaveLength(1);
            expect(acc[0]!.subject).toBe(`Request ${confirmedId.slice(-8).toUpperCase()} accepted`);
            expect(acc[0]!.bodyText).not.toContain('Printer');

            const second = (await prisma.intakeRequest.findFirst({ where: { tenantId, title: 'Again' } }))!;
            const d2 = await getIntakeRequest(owner, second.id);
            await declineIntakeRequest(owner, second.id, { reason: 'NOT_PLANNED', explanation: 'Not <b>this</b> quarter.' }, d2.version);
            const dec = await prisma.notificationOutbox.findMany({ where: { tenantId, type: 'INTAKE_DECLINED' } });
            expect(dec).toHaveLength(1);
            expect(dec[0]!.bodyText).toContain('Reason: Not planned.');
            expect(dec[0]!.bodyText).toContain('Not this quarter.');
            expect(dec[0]!.bodyText).not.toContain('<b>');

            // Spam on a confirmed address sends nothing.
            const spamRes = await submit(publicId, await envelope({ title: 'Spam', requesterEmail: 'ada@example.com', wantsUpdates: true }));
            expect(spamRes.status).toBe(201);
            const spam = (await prisma.intakeRequest.findFirst({ where: { tenantId, title: 'Spam' } }))!;
            await declineIntakeRequest(owner, spam.id, { reason: 'SPAM', explanation: 'ignored' }, (await getIntakeRequest(owner, spam.id)).version);
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_DECLINED' } })).toBe(1);

            // Merged, into a work item.
            const mergeRes = await submit(publicId, await envelope({ title: 'Merge me', requesterEmail: 'ada@example.com', wantsUpdates: true }));
            expect(mergeRes.status).toBe(201);
            const toMerge = (await prisma.intakeRequest.findFirst({ where: { tenantId, title: 'Merge me' } }))!;
            const item = await createWorkItem(owner, { projectId, typeId, title: 'Existing work' });
            await mergeIntakeRequest(owner, toMerge.id, { workItemId: item.id }, (await getIntakeRequest(owner, toMerge.id)).version);
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_MERGED' } })).toBe(1);

            // An address that never asked for updates hears nothing.
            const quietRes = await submit(publicId, await envelope({ title: 'Quiet one', requesterEmail: 'quiet@example.com' }));
            expect(await quietRes.json()).toMatchObject({ updates: 'NONE' });
            const quiet = (await prisma.intakeRequest.findFirst({ where: { tenantId, title: 'Quiet one' } }))!;
            await acceptIntakeRequest(owner, quiet.id, { typeId }, (await getIntakeRequest(owner, quiet.id)).version);
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_ACCEPTED' } })).toBe(1);
        });

        it('a decision made before the address was confirmed is sent once it is', async () => {
            const res = await submit(publicId, await envelope({ title: 'Late', requesterEmail: 'late@example.com', wantsUpdates: true }));
            expect(await res.json()).toMatchObject({ updates: 'CONFIRM_PENDING' });
            const late = (await prisma.intakeRequest.findFirst({ where: { tenantId, title: 'Late' } }))!;
            await acceptIntakeRequest(owner, late.id, { typeId }, (await getIntakeRequest(owner, late.id)).version);
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_ACCEPTED' } })).toBe(1);
            const mail = (await prisma.notificationOutbox.findMany({ where: { tenantId, type: 'INTAKE_CONFIRM_ADDRESS' } })).find((m) => m.toEmail === 'late@example.com')!;
            expect((await confirm(confirmLinkIn(mail.bodyText)!)).status).toBe(200);
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_ACCEPTED' } })).toBe(2);
        });
    });

    describe('the switch', () => {
        it('a form is made public only while public forms are open', async () => {
            process.env.INTAKE_PUBLIC_FORMS = '0';
            try {
                await expect(createIntakeForm(owner, { projectId, name: 'Closed', access: 'PUBLIC', definition: definition() })).rejects.toMatchObject({ status: 409 });
                const members = await createIntakeForm(owner, { projectId, name: 'Still members', definition: definition() });
                await expect(updateIntakeForm(owner, members.id, { access: 'PUBLIC' }, members.version)).rejects.toMatchObject({ status: 409 });
                expect((await confirm('A'.repeat(43))).status).toBe(404);
            } finally {
                process.env.INTAKE_PUBLIC_FORMS = '1';
            }
        });

        it('the audit chain verifies', async () => {
            const result = await verifyAuditChain(tenantId);
            expect(result.valid).toBe(true);
        });
    });
});
