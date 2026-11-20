/**
 * Inbound email intake against a real Postgres (sub-phase 2.6c; owner
 * decisions 120 to 123). No real Resend call: the webhook deliveries are
 * recorded shapes signed here with a test secret, Resend's retrieve API is a
 * `global.fetch` fake, and the raw `.eml` download is a `safeFetch` fake.
 *
 *   - the webhook route: a verified delivery records a PENDING row and
 *     enqueues the fetch job, answering 200 and fetching nothing; a bad or
 *     stale signature is a 401 that stores nothing; an unknown, disabled or
 *     retired address answers the same 200 and stores nothing; a repeat
 *     delivery or email is a no-op; an oversized body is a 413;
 *   - the job: the email is retrieved with the API key and its raw message
 *     downloaded from the signed URL; a VERIFIED sender gets the request
 *     acknowledged (Reply-To the request's reply address) and its address
 *     counted as confirmed; an unauthenticated one is stored and never
 *     answered; a member's verified address attributes the request to them;
 *     a repeat is skipped; an auto-reply is dropped;
 *   - follow-ups through the reply address, from the requester only; a
 *     snoozed request wakes; a decided request's reply is dropped;
 *   - the per-sender throttle, blocked senders (webhook and job), "decline as
 *     spam and block" (intake.manage), Settings' address on, off and anew;
 *   - the purge of settled deliveries, and the audit chain.
 */
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';

const enqueueMock = jest.fn(async (..._a: unknown[]) => ({ id: 'job' }));
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: (...a: unknown[]) => enqueueMock(...a),
}));
const safeFetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
jest.mock('@/app-layer/automation/webhook-safety', () => ({
    ...jest.requireActual('@/app-layer/automation/webhook-safety'),
    safeFetch: (url: string, init?: RequestInit) => safeFetchMock(url, init),
}));

import { POST as webhookRoute } from '@/app/api/intake/email/resend/route';
import type { RequestContext } from '@/app-layer/types';
import { blockSender, listBlockedSenders } from '@/app-layer/usecases/intake-blocked-senders';
import { processInboundEmail } from '@/app-layer/usecases/intake-email';
import { purgeDecidedRequests } from '@/app-layer/usecases/intake-jobs';
import { declineIntakeRequest, getIntakeRequest, snoozeIntakeRequest } from '@/app-layer/usecases/intake-request';
import { listProjectIntakeSettings, rotateProjectIntakeAddress, setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { buildTenantSystemJobContext } from '@/app-layer/context-system';
import { verifyAuditChain } from '@/lib/audit';
import { svixSignature } from '@/lib/intake/email/svix';
import { intakeReference } from '@/lib/intake/reference';
import { hashForLookup } from '@/lib/security/encryption';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `imail${Date.now().toString(36)}`;
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'; // pragma: allowlist secret — Svix's published test vector
const AUTHSERV = 'mx.inbound.test';
const DOMAIN = 'in.islestone.cloud';
const DOWNLOAD = 'https://inbound.resend.com/raw/';

interface Message {
    from: string;
    subject: string;
    body: string;
    messageId: string;
    verified?: boolean;
    extraHeaders?: string[];
}

/** A received email as Resend keeps it: the API's metadata and the raw `.eml` behind a signed URL. */
const messages = new Map<string, Message>();

function eml(m: Message): string {
    return [
        ...(m.verified ? [`Authentication-Results: ${AUTHSERV}; spf=pass smtp.mailfrom=${m.from.split('@')[1]}; dkim=pass header.d=${m.from.split('@')[1]}; dmarc=pass header.from=${m.from.split('@')[1]}`] : []),
        `From: Requester <${m.from}>`,
        `Subject: ${m.subject}`,
        `Message-ID: <${m.messageId}>`,
        ...(m.extraHeaders ?? []),
        'Content-Type: text/plain; charset=utf-8',
        '',
        m.body,
    ].join('\r\n');
}

describeFn('inbound email intake', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let memberEmail = '';
    let projectId = '';
    let address = '';
    let seq = 0;
    const saved = { key: process.env.RESEND_API_KEY, secret: process.env.RESEND_WEBHOOK_SECRET, authserv: process.env.INTAKE_EMAIL_AUTHSERV_ID, flag: process.env.INTAKE_EMAIL };
    const realFetch = global.fetch;
    const fetchSpy = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

    beforeAll(async () => {
        process.env.RESEND_API_KEY = 're_test_key';
        process.env.RESEND_WEBHOOK_SECRET = SECRET;
        process.env.INTAKE_EMAIL_AUTHSERV_ID = AUTHSERV;
        delete process.env.INTAKE_EMAIL;
        global.fetch = fetchSpy as unknown as typeof fetch;
        fetchSpy.mockImplementation(async (input) => {
            const url = String(input);
            const id = decodeURIComponent(url.split('/emails/receiving/')[1] ?? '');
            const m = messages.get(id);
            if (!m) return new Response('{}', { status: 404 });
            return new Response(JSON.stringify({ id, from: `Requester <${m.from}>`, subject: m.subject, message_id: `<${m.messageId}>`, text: m.body, download_url: `${DOWNLOAD}${id}?sig=x` }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });
        safeFetchMock.mockImplementation(async (url) => {
            const id = url.slice(DOWNLOAD.length).split('?')[0]!;
            const m = messages.get(id);
            return m ? new Response(eml(m), { status: 200 }) : new Response('', { status: 404 });
        });

        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const o = await prisma.user.create({ data: { email: `olive-${TAG}@example.test` } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: o.id, role: 'OWNER' } });
        memberEmail = `mia-${TAG}@member.example`;
        const m = await prisma.user.create({ data: { email: memberEmail } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: m.id, role: 'MEMBER' } });
        owner = makeRequestContext('OWNER', { tenantId, userId: o.id, tenantSlug: TAG, requestId: `${TAG}-o` });
        member = makeRequestContext('MEMBER', { tenantId, userId: m.id, tenantSlug: TAG, requestId: `${TAG}-m` });
        const team = await createTeam(owner, { name: 'Core' });
        projectId = (await createProject(owner, { teamId: team.id, name: 'Support', keyPrefix: 'SUP' })).id;
        const settings = await setProjectIntake(owner, projectId, { enabled: true, emailEnabled: true });
        address = settings.emailAddress!;
    });

    afterAll(async () => {
        global.fetch = realFetch;
        for (const [k, v] of Object.entries({ RESEND_API_KEY: saved.key, RESEND_WEBHOOK_SECRET: saved.secret, INTAKE_EMAIL_AUTHSERV_ID: saved.authserv, INTAKE_EMAIL: saved.flag })) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        await resetDatabase(prisma);
    });

    beforeEach(() => {
        enqueueMock.mockClear();
        fetchSpy.mockClear();
        safeFetchMock.mockClear();
    });

    /** A signed `email.received` delivery, as Resend posts it. */
    function deliver(input: { emailId: string; to: string; from: string; svixId?: string; timestamp?: number; secret?: string; raw?: string }) {
        const svixId = input.svixId ?? `msg_${TAG}_${++seq}`;
        const ts = String(input.timestamp ?? Math.floor(Date.now() / 1000));
        const body = input.raw ?? JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: input.emailId, from: input.from, to: [input.to], subject: 'ignored here' } });
        return webhookRoute(
            new NextRequest('http://localhost/api/intake/email/resend', {
                method: 'POST',
                body,
                headers: {
                    'content-type': 'application/json',
                    'svix-id': svixId,
                    'svix-timestamp': ts,
                    'svix-signature': `v1,${svixSignature(input.secret ?? SECRET, svixId, ts, body)}`,
                    'x-forwarded-for': '198.51.100.9',
                },
            }),
        );
    }

    /** Receive a message end to end: the webhook, then the job it enqueued. */
    async function receive(m: Message, to = address) {
        const emailId = `em_${TAG}_${++seq}`;
        messages.set(emailId, m);
        const res = await deliver({ emailId, to, from: m.from });
        expect(res.status).toBe(200);
        const row = await prisma.intakeInboundEmail.findUnique({ where: { emailId } });
        const job = enqueueMock.mock.calls.find((c) => (c[1] as { inboundId: string }).inboundId === row?.id);
        const outcome = row && job ? await processInboundEmail(job[1] as { tenantId: string; inboundId: string }) : null;
        return { emailId, row, outcome, inbound: row ? await prisma.intakeInboundEmail.findUnique({ where: { id: row.id } }) : null };
    }

    const msg = (over: Partial<Message> = {}): Message => ({ from: 'ada@sender.example', subject: 'Printer on fire', body: 'It smokes.', messageId: `${TAG}-${++seq}@sender.example`, ...over });

    describe('the webhook', () => {
        it('records a PENDING delivery and enqueues the fetch, fetching nothing inline', async () => {
            const emailId = `em_${TAG}_hook`;
            messages.set(emailId, msg());
            const res = await deliver({ emailId, to: `Support <${address.toUpperCase()}>`, from: 'Ada <ada@sender.example>' });
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ received: true });
            const row = await prisma.intakeInboundEmail.findUnique({ where: { emailId } });
            expect(row).toMatchObject({ status: 'PENDING', projectId, senderHash: hashForLookup('ada@sender.example'), outcome: null });
            expect(enqueueMock).toHaveBeenCalledWith('intake-email-fetch', { tenantId, inboundId: row!.id }, { jobId: `intake-email-${row!.id}` });
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(safeFetchMock).not.toHaveBeenCalled();
            // The same delivery again, and the same email in another delivery: no second row; a pending one is enqueued again.
            const svix = (await prisma.intakeInboundEmail.findUnique({ where: { emailId } }))!.svixId;
            expect((await deliver({ emailId, to: address, from: 'ada@sender.example', svixId: svix })).status).toBe(200);
            expect((await deliver({ emailId, to: address, from: 'ada@sender.example' })).status).toBe(200);
            expect(await prisma.intakeInboundEmail.count({ where: { emailId } })).toBe(1);
            expect(enqueueMock).toHaveBeenCalledTimes(3);
            await processInboundEmail({ tenantId, inboundId: row!.id });
        });

        it('refuses a bad, stale or missing signature with a 401 and stores nothing', async () => {
            const before = await prisma.intakeInboundEmail.count();
            expect((await deliver({ emailId: 'em_bad', to: address, from: 'x@sender.example', secret: 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })).status).toBe(401); // pragma: allowlist secret — a wrong test secret
            expect((await deliver({ emailId: 'em_old', to: address, from: 'x@sender.example', timestamp: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
            const res = await webhookRoute(new NextRequest('http://localhost/api/intake/email/resend', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }));
            expect(res.status).toBe(401);
            expect(await prisma.intakeInboundEmail.count()).toBe(before);
            expect(enqueueMock).not.toHaveBeenCalled();
        });

        it('answers the same 200 and stores nothing for an unknown address, another domain, another event or a closed deployment', async () => {
            const before = await prisma.intakeInboundEmail.count();
            const answers = [
                await deliver({ emailId: 'em_u1', to: `zzzzzzzzzzzz@${DOMAIN}`, from: 'x@sender.example' }),
                await deliver({ emailId: 'em_u2', to: `${address.split('@')[0]}@elsewhere.example`, from: 'x@sender.example' }),
                await deliver({ emailId: 'em_u3', to: address, from: 'x@sender.example', raw: JSON.stringify({ type: 'email.sent', data: { email_id: 'em_u3' } }) }),
            ];
            process.env.INTAKE_EMAIL = '0';
            try {
                answers.push(await deliver({ emailId: 'em_u4', to: address, from: 'x@sender.example' }));
            } finally {
                delete process.env.INTAKE_EMAIL;
            }
            expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200]);
            expect(new Set(await Promise.all(answers.map((a) => a.text()))).size).toBe(1);
            expect(await prisma.intakeInboundEmail.count()).toBe(before);
        });

        it('refuses a body over the cap with a 413 before reading the signature', async () => {
            const raw = JSON.stringify({ type: 'email.received', data: { email_id: 'em_big', to: [address], pad: 'x'.repeat(300 * 1024) } });
            expect((await deliver({ emailId: 'em_big', to: address, from: 'x@sender.example', raw })).status).toBe(413);
        });
    });

    describe('the fetch job', () => {
        it('makes a request from a verified sender, acknowledged with the reply address, address confirmed, nothing personal in the audit entry', async () => {
            const { outcome, inbound, emailId } = await receive(msg({ verified: true, subject: '=?utf-8?B?UHJpbnRlciDwn5Sl?=', body: 'It smokes.\n\nOn Mon, Ada wrote:\n> older' }));
            expect(outcome).toBe('REQUEST_CREATED');
            expect(fetchSpy).toHaveBeenCalledWith(`https://api.resend.com/emails/receiving/${emailId}`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer re_test_key' }) }));
            expect(safeFetchMock).toHaveBeenCalledWith(`${DOWNLOAD}${emailId}?sig=x`, expect.objectContaining({ redirect: 'error' }));
            expect(inbound).toMatchObject({ status: 'PROCESSED', outcome: null, attempts: 1 });
            const request = await getIntakeRequest(owner, inbound!.requestId!);
            expect(request).toMatchObject({ channel: 'EMAIL', title: 'Printer 🔥', body: 'It smokes.', senderCheck: 'VERIFIED', requesterEmail: 'ada@sender.example', requesterName: 'Requester', requesterUpdates: 'CONFIRMED', senderBlockable: true, requesterUserId: null });
            const stored = await prisma.intakeRequest.findUnique({ where: { id: request.id } });
            // The address is ciphertext at rest (the test client decrypts, so read the column raw).
            const [cipher] = await prisma.$queryRaw<Array<{ requesterEmail: string }>>`SELECT "requesterEmail" FROM "IntakeRequest" WHERE "id" = ${request.id}`;
            expect(cipher!.requesterEmail).not.toContain('ada@');
            const ack = await prisma.notificationOutbox.findFirst({ where: { tenantId, type: 'INTAKE_RECEIVED_ACK', bodyText: { contains: intakeReference(request.id) } } });
            expect(ack!.replyTo).toBe(`${address.split('@')[0]}+r${stored!.replyToken}@${DOMAIN}`);
            const audit = await prisma.auditLog.findFirst({ where: { tenantId, action: 'INTAKE_REQUEST_RECEIVED', entityId: request.id } });
            expect(JSON.stringify(audit)).not.toMatch(/ada@|Printer|smokes|Requester/);
            // The job again: the row is settled, so nothing more.
            expect(await processInboundEmail({ tenantId, inboundId: inbound!.id })).toBe('SKIPPED');
            expect(await prisma.intakeRequest.count({ where: { tenantId, sourceDedupeHash: stored!.sourceDedupeHash } })).toBe(1);
        });

        it('stores an unauthenticated sender and never answers it', async () => {
            const { outcome, inbound } = await receive(msg({ from: 'forged@sender.example' }));
            expect(outcome).toBe('REQUEST_CREATED');
            const request = await getIntakeRequest(owner, inbound!.requestId!);
            expect(request).toMatchObject({ senderCheck: 'NONE', requesterUpdates: 'NONE' });
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_RECEIVED_ACK', bodyText: { contains: intakeReference(request.id) } } })).toBe(0);
        });

        it("attributes a member's verified address to the member (decision 99), never an unverified one", async () => {
            const verified = await receive(msg({ from: memberEmail, verified: true }));
            expect((await getIntakeRequest(owner, verified.inbound!.requestId!)).requesterUserId).toBe(member.userId);
            const forged = await receive(msg({ from: memberEmail }));
            expect((await getIntakeRequest(owner, forged.inbound!.requestId!)).requesterUserId).toBeNull();
        });

        it('stores a message once, and drops an auto-reply unanswered', async () => {
            const m = msg({ verified: true });
            expect((await receive(m)).outcome).toBe('REQUEST_CREATED');
            const again = await receive({ ...m });
            expect(again.outcome).toBe('DUPLICATE');
            expect(again.inbound).toMatchObject({ status: 'DROPPED', outcome: 'DUPLICATE' });
            const auto = await receive(msg({ verified: true, extraHeaders: ['Auto-Submitted: auto-replied'] }));
            expect(auto.inbound).toMatchObject({ status: 'DROPPED', outcome: 'AUTO_REPLY' });
            expect(await prisma.intakeRequest.count({ where: { tenantId, sourceDedupeHash: { not: null } } })).toBeGreaterThan(0);
        });

        it('settles a delivery FAILED when Resend does not know the email', async () => {
            const res = await deliver({ emailId: 'em_missing', to: address, from: 'x@sender.example' });
            expect(res.status).toBe(200);
            const row = await prisma.intakeInboundEmail.findUnique({ where: { emailId: 'em_missing' } });
            expect(await processInboundEmail({ tenantId, inboundId: row!.id })).toBe('FAILED');
            expect(await prisma.intakeInboundEmail.findUnique({ where: { id: row!.id } })).toMatchObject({ status: 'FAILED', outcome: 'FETCH_NOT_FOUND' });
        });
    });

    describe('follow-ups', () => {
        it('adds a reply from the requester to its request, wakes a snoozed one, and turns another sender into a new request', async () => {
            const first = await receive(msg({ from: 'bea@sender.example', verified: true }));
            const request = await getIntakeRequest(owner, first.inbound!.requestId!);
            const stored = await prisma.intakeRequest.findUnique({ where: { id: request.id } });
            const reply = `${address.split('@')[0]}+r${stored!.replyToken}@${DOMAIN}`;
            await snoozeIntakeRequest(owner, request.id, { until: '2099-01-01' }, request.version);

            const follow = await receive(msg({ from: 'bea@sender.example', body: 'Still smoking.\n\n> It smokes.' }), reply);
            expect(follow.outcome).toBe('FOLLOW_UP_ADDED');
            const after = await getIntakeRequest(owner, request.id);
            expect(after.status).toBe('PENDING');
            expect(after.followUps).toEqual([expect.objectContaining({ body: 'Still smoking.', attachmentsDropped: 0 })]);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'INTAKE_FOLLOW_UP_RECEIVED', entityId: request.id } })).toBe(1);

            const stranger = await receive(msg({ from: 'eve@sender.example' }), reply);
            expect(stranger.outcome).toBe('REQUEST_CREATED');
            expect(stranger.inbound!.requestId).not.toBe(request.id);

            await declineIntakeRequest(owner, request.id, { reason: 'NOT_PLANNED' }, after.version);
            const late = await receive(msg({ from: 'bea@sender.example', body: 'Hello?' }), reply);
            expect(late.inbound).toMatchObject({ status: 'DROPPED', outcome: 'REQUEST_CLOSED' });
            expect((await getIntakeRequest(owner, request.id)).followUps).toHaveLength(1);
        });
    });

    describe('throttles and blocked senders', () => {
        it('drops a sender past ten an hour on an address, counted, never fetched', async () => {
            const sender = 'flood@sender.example';
            const since = new Date(Date.now() - 30 * 60 * 1000);
            await prisma.intakeInboundEmail.createMany({
                data: Array.from({ length: 10 }, (_, i) => ({
                    tenantId,
                    projectId,
                    svixId: `flood-svix-${TAG}-${i}`,
                    emailId: `flood-email-${TAG}-${i}`,
                    senderHash: hashForLookup(sender),
                    status: 'PROCESSED' as const,
                    createdAt: since,
                })),
            });
            const { row } = await receive(msg({ from: sender }));
            expect(row).toMatchObject({ status: 'DROPPED', outcome: 'THROTTLED_SENDER' });
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('drops a blocked address at the webhook and, blocked meanwhile, at the job; across the workspace too', async () => {
            await blockSender(owner, { email: 'Spam@Sender.example', projectId });
            const atHook = await receive(msg({ from: 'spam@sender.example' }));
            expect(atHook.row).toMatchObject({ status: 'DROPPED', outcome: 'BLOCKED' });

            const emailId = `em_${TAG}_late_block`;
            messages.set(emailId, msg({ from: 'later@sender.example' }));
            await deliver({ emailId, to: address, from: 'later@sender.example' });
            const row = await prisma.intakeInboundEmail.findUnique({ where: { emailId } });
            expect(row!.status).toBe('PENDING');
            await blockSender(owner, { email: 'later@sender.example', projectId: null });
            expect(await processInboundEmail({ tenantId, inboundId: row!.id })).toBe('BLOCKED');

            const blocks = await listBlockedSenders(owner);
            expect(blocks.map((b) => b.projectId).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([projectId, null].sort((a, b) => String(a).localeCompare(String(b))));
            expect(await listBlockedSenders(owner, { email: 'LATER@sender.example' })).toEqual([expect.objectContaining({ projectId: null })]);
            // The address itself is never stored: the row holds its lookup hash only.
            const raw = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "IntakeBlockedSender" WHERE "tenantId" = ${tenantId}`;
            expect(JSON.stringify(raw)).not.toMatch(/sender\.example/);
        });

        it('declines as spam and blocks the sender (intake.manage); a member may decline but not block', async () => {
            const { inbound } = await receive(msg({ from: 'junk@sender.example' }));
            const request = await getIntakeRequest(owner, inbound!.requestId!);
            await expect(declineIntakeRequest(member, request.id, { reason: 'SPAM', blockSender: true }, request.version)).rejects.toMatchObject({ status: 403 });
            await expect(declineIntakeRequest(owner, request.id, { reason: 'OTHER', blockSender: true }, request.version)).rejects.toMatchObject({ status: 400 });
            const declined = await declineIntakeRequest(owner, request.id, { reason: 'SPAM', blockSender: true }, request.version);
            expect(declined).toMatchObject({ status: 'DECLINED', declineReason: 'SPAM' });
            expect(await listBlockedSenders(owner, { email: 'junk@sender.example' })).toEqual([expect.objectContaining({ projectId })]);
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'INTAKE_SENDER_BLOCKED' }, orderBy: { createdAt: 'desc' } });
            expect(JSON.stringify(entry)).not.toMatch(/junk|sender\.example/);
            expect((await receive(msg({ from: 'junk@sender.example' }))).row).toMatchObject({ status: 'DROPPED', outcome: 'BLOCKED' });
        });
    });

    describe('the address in Settings', () => {
        it('generates a new address that retires the old one; turned off, the address takes nothing; on needs the deployment open', async () => {
            const old = address;
            const rotated = await rotateProjectIntakeAddress(owner, projectId);
            expect(rotated.emailAddress).toMatch(new RegExp(`^[a-z2-9]{12}@${DOMAIN.replace(/\./g, '\\.')}$`));
            expect(rotated.emailAddress).not.toBe(old);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'INTAKE_ADDRESS_ROTATED' } })).toBe(1);
            const before = await prisma.intakeInboundEmail.count();
            await receive(msg(), old);
            expect(await prisma.intakeInboundEmail.count()).toBe(before);
            address = rotated.emailAddress!;
            expect((await receive(msg())).outcome).toBe('REQUEST_CREATED');

            await setProjectIntake(owner, projectId, { enabled: true, emailEnabled: false });
            const off = await prisma.intakeInboundEmail.count();
            await receive(msg());
            expect(await prisma.intakeInboundEmail.count()).toBe(off);
            process.env.INTAKE_EMAIL = '0';
            try {
                await expect(setProjectIntake(owner, projectId, { enabled: true, emailEnabled: true })).rejects.toMatchObject({ status: 409 });
            } finally {
                delete process.env.INTAKE_EMAIL;
            }
            const back = await setProjectIntake(owner, projectId, { enabled: true, emailEnabled: true });
            // Turning it back on keeps the address.
            expect(back.emailAddress).toBe(address);
            expect((await listProjectIntakeSettings(owner)).find((p) => p.projectId === projectId)).toMatchObject({ emailEnabled: true, emailAddress: address });
            await expect(rotateProjectIntakeAddress(member, projectId)).rejects.toMatchObject({ status: 403 });
        });
    });

    describe('the purge and the chain', () => {
        it('purges settled deliveries past 30 days, keeping pending ones', async () => {
            const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
            await prisma.intakeInboundEmail.createMany({
                data: [
                    { tenantId, projectId, svixId: `old-1-${TAG}`, emailId: `old-1-${TAG}`, status: 'PROCESSED', createdAt: old },
                    { tenantId, projectId, svixId: `old-2-${TAG}`, emailId: `old-2-${TAG}`, status: 'PENDING', createdAt: old },
                ],
            });
            const ctx = await buildTenantSystemJobContext({ tenantId, tenantSlug: TAG, job: 'intake-purge' });
            await purgeDecidedRequests(ctx, new Date());
            expect(await prisma.intakeInboundEmail.count({ where: { svixId: `old-1-${TAG}` } })).toBe(0);
            expect(await prisma.intakeInboundEmail.count({ where: { svixId: `old-2-${TAG}` } })).toBe(1);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'INTAKE_INBOUND_EMAILS_PURGED' } })).toBe(1);
        });

        it('the audit chain verifies', async () => {
            expect((await verifyAuditChain(tenantId)).valid).toBe(true);
        });
    });
});
