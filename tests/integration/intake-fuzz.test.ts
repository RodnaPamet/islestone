/**
 * Route fuzzing of public intake and inbound email against a real Postgres
 * (Hardening H2f; docs/porting/maps/H2.md part 6, "Route fuzzing"; owner
 * decision 178), through the real handlers and usecases:
 *
 *   - injection: script, SVG and event-handler payloads, `javascript:` URLs,
 *     SQL-looking strings, bidirectional and zero-width characters and CR/LF
 *     in a public request's title, text, answers, requester's name and
 *     address, and in an email's subject and sender: stored sanitised (no
 *     element survives, no control or bidirectional character in a title or
 *     a name), and no CR or LF in any outbox email's header fields;
 *   - oversized and malformed bodies: at the cap, one byte past it, chunked
 *     with no `Content-Length`, an endless stream, gzip, JSON nested 10,000
 *     deep, 10,000 answer keys: the typed 413 or 400, never a 500, and the
 *     handler never reads past the cap and one chunk;
 *   - floods: 200 concurrent submissions take exactly the form's daily cap;
 *     the per-IP limits answer 429 with `Retry-After`, and no forwarding
 *     header the app does not trust mints a new budget; 100 concurrent
 *     webhooks with one `svix-id` record one delivery; the per-sender and
 *     per-address throttles hold under concurrency; a blocked sender's flood
 *     stores no request and enqueues nothing.
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';

const enqueueMock = jest.fn(async (..._a: unknown[]) => ({ id: 'job' }));
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: (...a: unknown[]) => enqueueMock(...a),
}));
const safeFetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
jest.mock('@/app-layer/automation/webhook-safety', () => ({
    ...jest.requireActual('@/app-layer/automation/webhook-safety'),
    safeFetch: (url: string, init?: RequestInit) => safeFetchMock(url, init),
}));

import { POST as confirmRoute } from '@/app/api/intake/confirm/route';
import { POST as webhookRoute } from '@/app/api/intake/email/resend/route';
import { POST as submitRoute } from '@/app/api/intake/forms/[publicId]/route';
import type { RequestContext } from '@/app-layer/types';
import { blockSender } from '@/app-layer/usecases/intake-blocked-senders';
import { INBOUND_THROTTLE, processInboundEmail } from '@/app-layer/usecases/intake-email';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { getIntakeRequest } from '@/app-layer/usecases/intake-request';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { solveProofOfWork } from '@/lib/intake/pow';
import { svixSignature } from '@/lib/intake/email/svix';
import { CONFIRM_MAX_BYTES, PUBLIC_SUBMIT_MAX_BYTES } from '@/lib/intake/public/http';
import { issueFormToken } from '@/lib/intake/public/form-token';
import { clearAllRateLimits } from '@/lib/security/rate-limit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `ifuzz${Date.now().toString(36)}`;
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'; // pragma: allowlist secret — Svix's published test vector
const AUTHSERV = 'mx.inbound.test';
const DOWNLOAD = 'https://inbound.resend.com/raw/';
const digest = async (s: string) => new Uint8Array(createHash('sha256').update(s).digest());

/** Payloads a hostile sender types into every field. */
const PAYLOADS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)><circle/></svg>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '<a href="javascript:alert(1)">x</a>',
    'javascript:alert(1)',
    `Robert'); DROP TABLE "IntakeRequest";--`,
    "' OR '1'='1",
    'right‮to left‬ and ⁦isolated⁩',
    'zero​width‍join﻿',
    'line\r\nBcc: victim@example.com\r\n\r\nInjected body',
    'tab\tand\u0000nul\u0085next',
];

/** How many elements an HTML reading of `text` holds. */
function elementsIn(text: string | null | undefined): number {
    if (!text) return 0;
    let n = 0;
    sanitizeHtml(text, {
        allowedTags: false,
        allowedAttributes: false,
        allowVulnerableTags: true,
        transformTags: {
            '*': (tagName, attribs) => {
                n++;
                return { tagName, attribs };
            },
        },
    });
    return n;
}

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;

describeFn('intake fuzzing at the routes (H2f)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let projectId = '';
    let formId = '';
    let publicId = '';
    let address = '';
    /** A second project's address, with an hour of its own for the address throttle. */
    let quietAddress = '';
    /** A third project's address, for the per-sender throttle alone. */
    let noisyAddress = '';
    let seq = 0;
    const saved = {
        flag: process.env.INTAKE_PUBLIC_FORMS,
        rl: process.env.RATE_LIMIT_ENABLED,
        key: process.env.RESEND_API_KEY,
        secret: process.env.RESEND_WEBHOOK_SECRET,
        authserv: process.env.INTAKE_EMAIL_AUTHSERV_ID,
        email: process.env.INTAKE_EMAIL,
    };
    const realFetch = global.fetch;
    const messages = new Map<string, string>();

    beforeAll(async () => {
        process.env.INTAKE_PUBLIC_FORMS = '1';
        process.env.RESEND_API_KEY = 're_test_key';
        process.env.RESEND_WEBHOOK_SECRET = SECRET;
        process.env.INTAKE_EMAIL_AUTHSERV_ID = AUTHSERV;
        delete process.env.INTAKE_EMAIL;
        delete process.env.RATE_LIMIT_ENABLED;
        global.fetch = (async (input: RequestInfo | URL) => {
            const id = decodeURIComponent(String(input).split('/emails/receiving/')[1] ?? '');
            if (!messages.has(id)) return new Response('{}', { status: 404 });
            return new Response(JSON.stringify({ id, from: 'x@example.com', subject: 'x', text: 'x', download_url: `${DOWNLOAD}${id}?sig=x` }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }) as typeof fetch;
        safeFetchMock.mockImplementation(async (url) => {
            const raw = messages.get(url.slice(DOWNLOAD.length).split('?')[0]!);
            return raw === undefined ? new Response('', { status: 404 }) : new Response(Buffer.from(raw, 'utf8'), { status: 200 });
        });

        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const u = await prisma.user.create({ data: { email: `olive-${TAG}@example.test`, name: 'Olive' } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } });
        owner = makeRequestContext('OWNER', { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-o` });
        const team = await createTeam(owner, { name: 'Core' });
        projectId = (await createProject(owner, { teamId: team.id, name: 'Support', keyPrefix: 'SUP' })).id;
        address = (await setProjectIntake(owner, projectId, { enabled: true, emailEnabled: true })).emailAddress!;
        const quietId = (await createProject(owner, { teamId: team.id, name: 'Quiet', keyPrefix: 'QUI' })).id;
        quietAddress = (await setProjectIntake(owner, quietId, { enabled: true, emailEnabled: true })).emailAddress!;
        const noisyId = (await createProject(owner, { teamId: team.id, name: 'Noisy', keyPrefix: 'NOI' })).id;
        noisyAddress = (await setProjectIntake(owner, noisyId, { enabled: true, emailEnabled: true })).emailAddress!;
        const form = await createIntakeForm(owner, {
            projectId,
            name: 'Report a problem',
            access: 'PUBLIC',
            definition: {
                intro: '',
                confirmation: 'Thanks.',
                fields: [
                    { id: 'f1', kind: 'SHORT_TEXT', label: 'Where', required: false },
                    { id: 'f2', kind: 'LONG_TEXT', label: 'Details', required: false },
                    { id: 'f3', kind: 'URL', label: 'Link', required: false },
                ],
                requester: { name: 'OPTIONAL', email: 'OPTIONAL' },
            },
        });
        formId = form.id;
        publicId = form.publicId!;
    });

    afterAll(async () => {
        global.fetch = realFetch;
        for (const [k, v] of Object.entries({
            INTAKE_PUBLIC_FORMS: saved.flag,
            RATE_LIMIT_ENABLED: saved.rl,
            RESEND_API_KEY: saved.key,
            RESEND_WEBHOOK_SECRET: saved.secret,
            INTAKE_EMAIL_AUTHSERV_ID: saved.authserv,
            INTAKE_EMAIL: saved.email,
        })) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        clearAllRateLimits();
        await resetDatabase(prisma);
    });

    beforeEach(() => {
        enqueueMock.mockClear();
        clearAllRateLimits();
    });

    /** An envelope as the page sends it: a token minted ten seconds ago, its proof solved. */
    async function envelope(request: unknown) {
        const version = (await prisma.intakeForm.findUnique({ where: { id: formId }, select: { definitionVersion: true } }))!.definitionVersion;
        const token = issueFormToken(publicId, version, Date.now() - 10_000);
        const proof = await solveProofOfWork(token, digest, { batch: 1 << 30, yieldNow: async () => undefined });
        return { token, proof, request };
    }

    function submit(body: BodyInit, headers: Record<string, string> = {}) {
        return submitRoute(
            new NextRequest(`http://localhost/api/intake/forms/${publicId}`, {
                method: 'POST',
                body,
                headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
                // A stream body (the chunked case) needs the half-duplex flag.
                ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
            } as ConstructorParameters<typeof NextRequest>[1]),
            { params: Promise.resolve({ publicId }) },
        );
    }

    /** A signed `email.received` delivery, as Resend posts it. */
    function deliver(input: { emailId: string; from: string; svixId?: string; to?: string }) {
        const svixId = input.svixId ?? `msg_${TAG}_${++seq}`;
        const ts = String(Math.floor(Date.now() / 1000));
        const body = JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: input.emailId, from: input.from, to: [input.to ?? address], subject: 'x' } });
        return webhookRoute(
            new NextRequest('http://localhost/api/intake/email/resend', {
                method: 'POST',
                body,
                headers: { 'content-type': 'application/json', 'svix-id': svixId, 'svix-timestamp': ts, 'svix-signature': `v1,${svixSignature(SECRET, svixId, ts, body)}`, 'x-forwarded-for': '198.51.100.9' },
            }),
        );
    }

    /** Every outbox row's header fields: none may hold CR or LF. */
    async function expectOutboxHeadersClean() {
        const rows = await prisma.notificationOutbox.findMany({ where: { tenantId }, select: { toEmail: true, subject: true, replyTo: true } });
        for (const r of rows) {
            expect(r.toEmail).not.toMatch(/[\r\n]/);
            expect(r.subject).not.toMatch(/[\r\n]/);
            expect(r.replyTo ?? '').not.toMatch(/[\r\n]/);
        }
        return rows.length;
    }

    describe('injection', () => {
        it('stores every payload of a public request sanitised, and no CR or LF reaches an outbox header', async () => {
            const ids: string[] = [];
            for (const [i, p] of PAYLOADS.entries()) {
                // guardrail-allow: n+1 — one submission per payload, each its own request.
                const env = await envelope({
                    title: `T${i} ${p}`,
                    body: `Body ${p}`,
                    answers: { f1: `Where ${p}`.slice(0, 500), f2: `Details ${p}` },
                    requesterName: `Name ${p}`.slice(0, 100),
                    requesterEmail: `ada${i}@example.com`,
                    wantsUpdates: true,
                });
                const res = await submit(JSON.stringify(env));
                expect(res.status).toBe(201);
                const row = await prisma.intakeRequest.findFirst({ where: { tenantId, formTokenNonce: env.token.split('.')[3] }, select: { id: true } });
                ids.push(row!.id);
            }
            for (const id of ids) {
                // guardrail-allow: n+1 — each stored request is read back through the usecase.
                const r = await getIntakeRequest(owner, id);
                expect(r.title).not.toMatch(CONTROL_OR_BIDI);
                expect(elementsIn(r.title)).toBe(0);
                expect(elementsIn(r.body)).toBe(0);
                expect(r.requesterName ?? '').not.toMatch(CONTROL_OR_BIDI);
                expect(elementsIn(r.requesterName)).toBe(0);
                for (const a of r.answers ?? []) expect(elementsIn(String(a.value))).toBe(0);
            }
            // A SQL-looking string is text: stored literally, and the table is still there.
            const sql = await getIntakeRequest(owner, ids[PAYLOADS.indexOf(`Robert'); DROP TABLE "IntakeRequest";--`)]!);
            expect(sql.title).toBe(`T7 Robert'); DROP TABLE "IntakeRequest";--`);
            expect(await prisma.intakeRequest.count({ where: { tenantId } })).toBeGreaterThanOrEqual(PAYLOADS.length);
            // One confirmation email per address, none with CR or LF in a header field.
            expect(await expectOutboxHeadersClean()).toBeGreaterThanOrEqual(PAYLOADS.length);
        });

        it('refuses an address carrying CR or LF, and a javascript: link in a URL answer, with a typed 400', async () => {
            for (const requesterEmail of ['ada@example.com\r\nBcc: victim@example.com', 'ada@example.com\n', 'a\r\n@example.com']) {
                // guardrail-allow: n+1 — one refused submission per address.
                const res = await submit(JSON.stringify(await envelope({ title: 'x', requesterEmail })));
                expect(res.status).toBe(400);
            }
            const res = await submit(JSON.stringify(await envelope({ title: 'x', answers: { f3: 'javascript:alert(1)' } })));
            expect(res.status).toBe(400);
        });

        it('stores an emailed subject and sender sanitised, and the acknowledgement carries no CR or LF in a header', async () => {
            const before = await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_RECEIVED_ACK' } });
            for (const [i, p] of PAYLOADS.entries()) {
                const emailId = `em_${TAG}_inj_${i}`;
                const from = `grace${i}@sender.example`;
                const subject = `S${i} ${p}`.replace(/\r\n/g, '\r\n '); // folded, as a header must be
                messages.set(
                    emailId,
                    [
                        `Authentication-Results: ${AUTHSERV}; dmarc=pass header.from=sender.example`,
                        `From: "Grace ${p.replace(/[\r\n"]/g, ' ')}" <${from}>`,
                        `Subject: ${subject}`,
                        `Message-ID: <${TAG}-inj-${i}@sender.example>`,
                        'Content-Type: text/html; charset=utf-8',
                        '',
                        `<p>Text ${p}</p>`,
                    ].join('\r\n'),
                );
                // guardrail-allow: n+1 — one delivery and its job per payload.
                expect((await deliver({ emailId, from })).status).toBe(200);
                const row = await prisma.intakeInboundEmail.findUnique({ where: { emailId } });
                expect(await processInboundEmail({ tenantId, inboundId: row!.id })).toBe('REQUEST_CREATED');
            }
            const stored = await prisma.intakeRequest.findMany({ where: { tenantId, channel: 'EMAIL' }, select: { id: true } });
            expect(stored.length).toBe(PAYLOADS.length);
            for (const { id } of stored) {
                // guardrail-allow: n+1 — each stored request is read back through the usecase.
                const r = await getIntakeRequest(owner, id);
                expect(r.title).not.toMatch(CONTROL_OR_BIDI);
                expect(elementsIn(r.title)).toBe(0);
                expect(elementsIn(r.body)).toBe(0);
                expect(r.requesterName ?? '').not.toMatch(CONTROL_OR_BIDI);
                expect(elementsIn(r.requesterName)).toBe(0);
            }
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'INTAKE_RECEIVED_ACK' } })).toBe(before + PAYLOADS.length);
            await expectOutboxHeadersClean();
        });
    });

    describe('oversized and malformed bodies', () => {
        /** A JSON envelope of exactly `size` bytes (the title padded). */
        function bodyOfSize(size: number): string {
            const shell = JSON.stringify({ token: 'x', proof: 0, request: { title: '' } });
            return shell.replace('"title":""', `"title":"${'a'.repeat(size - shell.length)}"`);
        }

        it('reads a body at the cap and one byte under it, and refuses one byte over with the typed 413', async () => {
            for (const size of [PUBLIC_SUBMIT_MAX_BYTES - 1, PUBLIC_SUBMIT_MAX_BYTES]) {
                const body = bodyOfSize(size);
                expect(Buffer.byteLength(body)).toBe(size);
                // guardrail-allow: n+1 — two sizes. The token is refused: read, parsed, then 400.
                const res = await submit(body);
                expect(res.status).toBe(400);
            }
            const over = await submit(bodyOfSize(PUBLIC_SUBMIT_MAX_BYTES + 1));
            expect(over.status).toBe(413);
            expect(((await over.json()) as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
        });

        it('refuses an endless chunked body with no Content-Length at the cap, having read no more than the cap and one chunk', async () => {
            let pulled = 0;
            let cancelled = false;
            const chunk = new Uint8Array(4_096).fill(0x61);
            const endless = new ReadableStream<Uint8Array>(
                {
                    pull(controller) {
                        pulled += chunk.byteLength;
                        controller.enqueue(chunk);
                    },
                    cancel() {
                        cancelled = true;
                    },
                },
                { highWaterMark: 0 },
            );
            const res = await submit(endless);
            expect(res.status).toBe(413);
            expect(pulled).toBeLessThanOrEqual(PUBLIC_SUBMIT_MAX_BYTES + 2 * chunk.byteLength);
            expect(cancelled).toBe(true);
        });

        it('answers a typed 400 or 413, never a 500, for gzip, deep nesting, many keys, bad UTF-8, junk and nothing', async () => {
            const valid = JSON.stringify(await envelope({ title: 'Packed' }));
            const cases: Array<{ name: string; body: BodyInit; headers?: Record<string, string>; expect: number[] }> = [
                // Read as bytes, never inflated: gzip bytes are not JSON.
                { name: 'gzip', body: gzipSync(Buffer.from(valid)), headers: { 'content-encoding': 'gzip' }, expect: [400] },
                { name: 'nested 10,000 deep', body: `{"token":"x","proof":0,"request":${'['.repeat(10_000)}${']'.repeat(10_000)}}`, expect: [400] },
                { name: 'nested objects 10,000 deep', body: `${'{"a":'.repeat(10_000)}1${'}'.repeat(10_000)}`, expect: [400] },
                {
                    name: '10,000 answer keys',
                    body: JSON.stringify({ token: 'x', proof: 0, request: { title: 'x', answers: Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [i.toString(36), 1])) } }),
                    expect: [400, 413],
                },
                { name: 'invalid UTF-8', body: Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), expect: [400] },
                { name: 'not JSON', body: 'token=x&proof=0', expect: [400] },
                { name: 'empty', body: '', expect: [400] },
                { name: 'a JSON string', body: '"just a string"', expect: [400] },
                { name: 'a lying Content-Length', body: valid, headers: { 'content-length': '5' }, expect: [400, 201, 409] },
            ];
            for (const c of cases) {
                // guardrail-allow: n+1 — one malformed body per case.
                const res = await submit(c.body, c.headers ?? {});
                expect({ name: c.name, status: res.status, ok: c.expect.includes(res.status) }).toMatchObject({ ok: true });
            }
            expect(await prisma.intakeRequest.count({ where: { tenantId, title: 'Packed' } })).toBeLessThanOrEqual(1);
        });

        it('refuses a confirmation body past its 4 KB cap with the typed 413', async () => {
            const res = await confirmRoute(
                new NextRequest('http://localhost/api/intake/confirm', {
                    method: 'POST',
                    body: JSON.stringify({ token: 'a'.repeat(CONFIRM_MAX_BYTES) }),
                    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.8' },
                }),
            );
            expect(res.status).toBe(413);
        });

        it('makes one request from a 1 MB email of 2,000 parts, its attachments counted, in bounded time', async () => {
            const emailId = `em_${TAG}_parts`;
            let raw = `From: big@sender.example\r\nSubject: Many parts\r\nMessage-ID: <${TAG}-parts@sender.example>\r\nContent-Type: multipart/mixed; boundary="p"\r\n\r\n--p\r\nContent-Type: text/plain\r\n\r\nSee attached.\r\n`;
            const filler = 'x'.repeat(500);
            for (let i = 1; i < 2_000; i++) raw += `--p\r\nContent-Type: application/octet-stream\r\n\r\n${filler}\r\n`;
            raw += '--p--\r\n';
            expect(raw.length).toBeGreaterThan(1_000_000);
            messages.set(emailId, raw);
            expect((await deliver({ emailId, from: 'big@sender.example' })).status).toBe(200);
            const row = await prisma.intakeInboundEmail.findUnique({ where: { emailId } });
            const t0 = Date.now();
            expect(await processInboundEmail({ tenantId, inboundId: row!.id })).toBe('REQUEST_CREATED');
            expect(Date.now() - t0).toBeLessThan(10_000);
            const stored = await prisma.intakeRequest.findFirst({ where: { tenantId, title: 'Many parts' }, select: { attachmentsDropped: true } });
            expect(stored!.attachmentsDropped).toBe(1_999);
        });
    });

    describe('floods', () => {
        it(
            'takes exactly the daily cap from 200 concurrent submissions, and answers the rest 429',
            async () => {
                const taken = await prisma.intakeRequest.count({ where: { tenantId, formId } });
                const cap = taken + 25;
                await prisma.intakeForm.update({ where: { id: formId }, data: { dailyCap: cap } });
                try {
                    const envelopes = await Promise.all(Array.from({ length: 200 }, (_, i) => envelope({ title: `Flood ${i}` })));
                    const responses = await Promise.all(envelopes.map((e) => submit(JSON.stringify(e))));
                    const statuses = responses.map((r) => r.status);
                    expect(statuses.filter((s) => s === 201)).toHaveLength(25);
                    expect(statuses.filter((s) => s !== 201 && s !== 429)).toEqual([]);
                    expect(await prisma.intakeRequest.count({ where: { tenantId, formId } })).toBe(cap);
                } finally {
                    await prisma.intakeForm.update({ where: { id: formId }, data: { dailyCap: 200 } });
                }
            },
            180_000,
        );

        it('limits one address to five submits a minute with a 429 and Retry-After, and no untrusted forwarding header mints a budget', async () => {
            process.env.RATE_LIMIT_ENABLED = '1';
            try {
                const ip = '198.51.100.23';
                const first = await Promise.all(Array.from({ length: 8 }, () => submit('{}', { 'x-forwarded-for': ip })));
                const statuses = first.map((r) => r.status);
                expect(statuses.filter((s) => s !== 429)).toHaveLength(5);
                const limited = first.find((r) => r.status === 429)!;
                expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
                // The app trusts the first X-Forwarded-For entry, which the proxy sets from the
                // connection (deploy/caddy/islestone.caddy; tests/unit/deploy/caddy-snippet.test.ts).
                // Whatever a client appends after it, or sends in other headers, is not a new budget.
                const spoofs: Array<Record<string, string>> = [
                    { 'x-forwarded-for': `${ip}, 192.0.2.1` },
                    { 'x-forwarded-for': `${ip},10.0.0.1, 10.0.0.2` },
                    { 'x-forwarded-for': ip, 'x-real-ip': '192.0.2.77' },
                    { 'x-forwarded-for': ip, 'x-client-ip': '192.0.2.78', 'true-client-ip': '192.0.2.79', forwarded: 'for=192.0.2.80' },
                ];
                for (const headers of spoofs) {
                    // guardrail-allow: n+1 — one spoof per header shape.
                    expect((await submit('{}', headers)).status).toBe(429);
                }
            } finally {
                delete process.env.RATE_LIMIT_ENABLED;
            }
        });

        it('records one delivery for 100 concurrent webhooks with the same svix-id', async () => {
            const emailId = `em_${TAG}_dup`;
            messages.set(emailId, 'From: dup@sender.example\r\nSubject: Dup\r\n\r\nx');
            const svixId = `msg_${TAG}_dup`;
            const responses = await Promise.all(Array.from({ length: 100 }, () => deliver({ emailId, from: 'dup@sender.example', svixId })));
            const statuses = responses.map((r) => r.status);
            expect(new Set(statuses)).toEqual(new Set([200]));
            expect(await prisma.intakeInboundEmail.count({ where: { svixId } })).toBe(1);
            expect(await prisma.intakeInboundEmail.count({ where: { emailId } })).toBe(1);
        }, 120_000);

        it('holds the per-sender throttle under 30 concurrent deliveries from one sender', async () => {
            const sender = `noisy-${TAG}@sender.example`;
            const statuses = (await Promise.all(Array.from({ length: 30 }, (_, i) => deliver({ emailId: `em_${TAG}_noisy_${i}`, from: sender, to: noisyAddress })))).map((r) => r.status);
            expect(new Set(statuses)).toEqual(new Set([200]));
            const rows = await prisma.intakeInboundEmail.findMany({ where: { emailId: { startsWith: `em_${TAG}_noisy_` } }, select: { status: true, outcome: true } });
            expect(rows).toHaveLength(30);
            expect(rows.filter((r) => r.status === 'PENDING')).toHaveLength(INBOUND_THROTTLE.senderPerHour);
            expect(rows.filter((r) => r.status === 'DROPPED' && r.outcome === 'THROTTLED_SENDER')).toHaveLength(30 - INBOUND_THROTTLE.senderPerHour);
        }, 120_000);

        it("holds the per-address throttle under 50 concurrent deliveries from different senders", async () => {
            const since = new Date(Date.now() - 60 * 60 * 1000);
            const already = await prisma.intakeInboundEmail.count({ where: { projectId, createdAt: { gte: since } } });
            const room = Math.max(0, INBOUND_THROTTLE.addressPerHour - already);
            const statuses = (await Promise.all(Array.from({ length: 50 }, (_, i) => deliver({ emailId: `em_${TAG}_many_${i}`, from: `s${i}-${TAG}@many.example` })))).map((r) => r.status);
            expect(new Set(statuses)).toEqual(new Set([200]));
            const rows = await prisma.intakeInboundEmail.findMany({ where: { emailId: { startsWith: `em_${TAG}_many_` } }, select: { status: true, outcome: true } });
            expect(rows.filter((r) => r.status === 'PENDING').length).toBe(room);
            expect(rows.filter((r) => r.outcome === 'THROTTLED')).toHaveLength(50 - room);
        }, 120_000);

        it("stores no request and enqueues nothing for a blocked sender's flood, by email or by public form", async () => {
            const blocked = `blocked-${TAG}@sender.example`;
            // Across the workspace, so the second project's address (an hour of its own) is covered too.
            await blockSender(owner, { email: blocked, projectId: null });
            const before = await prisma.intakeRequest.count({ where: { tenantId } });
            const mailsBefore = await prisma.notificationOutbox.count({ where: { tenantId } });
            // Public form: answered like the trap, 201 and nothing stored.
            const envelopes = await Promise.all(Array.from({ length: 30 }, (_, i) => envelope({ title: `Blocked ${i}`, requesterEmail: blocked, wantsUpdates: true })));
            const statuses = (await Promise.all(envelopes.map((e) => submit(JSON.stringify(e))))).map((r) => r.status);
            expect(new Set(statuses)).toEqual(new Set([201]));
            // Email: every delivery recorded DROPPED as blocked, nothing fetched or enqueued.
            enqueueMock.mockClear();
            const hooks = (await Promise.all(Array.from({ length: 10 }, (_, i) => deliver({ emailId: `em_${TAG}_blocked_${i}`, from: `Blocked <${blocked}>`, to: quietAddress })))).map((r) => r.status);
            expect(new Set(hooks)).toEqual(new Set([200]));
            const rows = await prisma.intakeInboundEmail.findMany({ where: { emailId: { startsWith: `em_${TAG}_blocked_` } }, select: { status: true, outcome: true } });
            expect(rows.map((r) => `${r.status}:${r.outcome}`)).toEqual(Array(10).fill('DROPPED:BLOCKED'));
            expect(enqueueMock).not.toHaveBeenCalled();
            expect(await prisma.intakeRequest.count({ where: { tenantId } })).toBe(before);
            expect(await prisma.notificationOutbox.count({ where: { tenantId } })).toBe(mailsBefore);
        }, 120_000);
    });
});
