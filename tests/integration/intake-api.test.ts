/**
 * The intake API, route by route, against a real Postgres (sub-phase 2.6a;
 * owner decision 92), the role matrix of the `intake` domain:
 *
 *   - every route file under `intake/` is driven here (the population is read
 *     from git), each method once;
 *   - a VIEWER is refused every route that takes an `intake.*` key with a
 *     403 and an `AUTHZ_DENIED` row, and passes the two `projects.view`
 *     routes' gate; a GUEST, who holds no key until 8.4 (owner decision 204),
 *     is refused every route, those two included;
 *   - a MEMBER is admitted to every `intake.view` and `intake.triage` route
 *     and refused every `intake.manage` one with an audited 403;
 *   - an OWNER is admitted everywhere.
 *
 * `getTenantCtx` is replaced by a context for the role under test (the
 * session and edge are 1.4's, tested there); everything below it is real.
 */
import * as path from 'node:path';

import { NextRequest } from 'next/server';
import type { PrismaClient, Role } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));

import { blockSender } from '@/app-layer/usecases/intake-blocked-senders';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { gitFiles } from '../helpers/git-files';
import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `iapi${Date.now().toString(36)}`;
const ROOT = path.resolve(__dirname, '../..');
const I = 'src/app/api/t/[tenantSlug]/intake';

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface Ids {
    project: string;
    form: string;
    request: string;
    type: string;
    blocked: string;
}

interface Call {
    file: string;
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: (i: Ids) => string;
    params: (i: Ids) => Record<string, string>;
    body?: (i: Ids) => unknown;
    key: string;
}

const P = (extra: Record<string, string> = {}) => ({ tenantSlug: TAG, ...extra });
const R = (i: Ids) => P({ requestId: i.request });
const CALLS: Call[] = [
    { file: `${I}/requests/route.ts`, method: 'GET', path: () => '/intake/requests', params: () => P(), key: 'intake.view' },
    { file: `${I}/requests/count/route.ts`, method: 'GET', path: () => '/intake/requests/count', params: () => P(), key: 'intake.view' },
    { file: `${I}/requests/[requestId]/route.ts`, method: 'GET', path: (i) => `/intake/requests/${i.request}`, params: R, key: 'intake.view' },
    { file: `${I}/requests/[requestId]/route.ts`, method: 'PATCH', path: (i) => `/intake/requests/${i.request}`, params: R, body: () => ({ title: 'x' }), key: 'intake.triage' },
    { file: `${I}/requests/[requestId]/accept/route.ts`, method: 'POST', path: (i) => `/intake/requests/${i.request}/accept`, params: R, body: (i) => ({ typeId: i.type }), key: 'intake.triage' },
    { file: `${I}/requests/[requestId]/decline/route.ts`, method: 'POST', path: (i) => `/intake/requests/${i.request}/decline`, params: R, body: () => ({ reason: 'OTHER' }), key: 'intake.triage' },
    { file: `${I}/requests/[requestId]/merge/route.ts`, method: 'POST', path: (i) => `/intake/requests/${i.request}/merge`, params: R, body: () => ({ workItemId: 'none' }), key: 'intake.triage' },
    { file: `${I}/requests/[requestId]/snooze/route.ts`, method: 'POST', path: (i) => `/intake/requests/${i.request}/snooze`, params: R, body: () => ({ until: '2099-01-01' }), key: 'intake.triage' },
    { file: `${I}/requests/[requestId]/move/route.ts`, method: 'POST', path: (i) => `/intake/requests/${i.request}/move`, params: R, body: (i) => ({ projectId: i.project }), key: 'intake.triage' },
    { file: `${I}/requests/[requestId]/reopen/route.ts`, method: 'POST', path: (i) => `/intake/requests/${i.request}/reopen`, params: R, key: 'intake.triage' },
    { file: `${I}/forms/route.ts`, method: 'GET', path: () => '/intake/forms', params: () => P(), key: 'intake.view' },
    { file: `${I}/forms/route.ts`, method: 'POST', path: () => '/intake/forms', params: () => P(), body: (i) => ({ projectId: i.project, name: `F${Math.random()}`, definition: { fields: [] } }), key: 'intake.manage' },
    { file: `${I}/forms/[formId]/route.ts`, method: 'GET', path: (i) => `/intake/forms/${i.form}`, params: (i) => P({ formId: i.form }), key: 'intake.view' },
    { file: `${I}/forms/[formId]/route.ts`, method: 'PATCH', path: (i) => `/intake/forms/${i.form}`, params: (i) => P({ formId: i.form }), body: () => ({ published: true }), key: 'intake.manage' },
    { file: `${I}/forms/[formId]/requests/route.ts`, method: 'POST', path: (i) => `/intake/forms/${i.form}/requests`, params: (i) => P({ formId: i.form }), body: () => ({ title: 'via api', answers: {} }), key: 'projects.view' },
    { file: `${I}/open-forms/route.ts`, method: 'GET', path: () => '/intake/open-forms', params: () => P(), key: 'projects.view' },
    { file: `${I}/projects/route.ts`, method: 'GET', path: () => '/intake/projects', params: () => P(), key: 'intake.manage' },
    // Sub-phase 2.6c: blocked senders and the project's address (decision 92).
    { file: `${I}/blocked-senders/route.ts`, method: 'GET', path: () => '/intake/blocked-senders', params: () => P(), key: 'intake.manage' },
    {
        file: `${I}/blocked-senders/route.ts`,
        method: 'POST',
        path: () => '/intake/blocked-senders',
        params: () => P(),
        body: (i) => ({ email: `spam-${Math.random().toString(36).slice(2)}@example.test`, projectId: i.project }),
        key: 'intake.manage',
    },
    { file: `${I}/blocked-senders/find/route.ts`, method: 'POST', path: () => '/intake/blocked-senders/find', params: () => P(), body: () => ({ email: 'spam@example.test' }), key: 'intake.manage' },
    { file: `${I}/blocked-senders/[blockedId]/route.ts`, method: 'DELETE', path: (i) => `/intake/blocked-senders/${i.blocked}`, params: (i) => P({ blockedId: i.blocked }), key: 'intake.manage' },
    {
        file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/intake/email-address/route.ts',
        method: 'POST',
        path: (i) => `/projects/${i.project}/intake/email-address`,
        params: (i) => P({ projectId: i.project }),
        key: 'intake.manage',
    },
];

function request(method: string, p: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/t/${TAG}${p}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.8' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

describeFn('the intake API', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    const users: Partial<Record<Role, string>> = {};
    const ids = {} as Ids;

    const ctxFor = (role: Role): RequestContext =>
        makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: users[role]!, requestId: `${TAG}-${role}-${Math.random()}` });

    async function call(role: Role, c: Call) {
        getTenantCtxMock.mockResolvedValue(ctxFor(role));
        const mod = (await import(`../../${c.file}`)) as Record<string, Handler>;
        const res = await mod[c.method]!(request(c.method, c.path(ids), c.body?.(ids)), { params: Promise.resolve(c.params(ids)) });
        return { status: res.status };
    }

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        for (const role of ['OWNER', 'MEMBER', 'VIEWER', 'GUEST'] as Role[]) {
            const u = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${TAG}@example.test` } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            users[role] = u.id;
        }
        const owner = ctxFor('OWNER');
        const team = await createTeam(owner, { name: 'API' });
        const project = await createProject(owner, { teamId: team.id, name: 'Intake API', keyPrefix: 'IAP' });
        await setProjectIntake(owner, project.id, { enabled: true });
        const form = await createIntakeForm(owner, { projectId: project.id, name: 'API form', definition: { fields: [] } });
        const req = await sendIntakeRequest(ctxFor('MEMBER'), form.id, { title: 'seeded', answers: {} });
        const blocked = await blockSender(owner, { email: 'spam@example.test', projectId: null });
        Object.assign(ids, { project: project.id, form: form.id, request: req.id, type: (await listWorkItemTypes(owner))[0]!.id, blocked: blocked.row.id });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('drives every intake route file and method (the population is read from git)', () => {
        const files = gitFiles(ROOT).filter((f) => f.startsWith(`${I}/`) && f.endsWith('/route.ts'));
        expect(files.length).toBeGreaterThan(10);
        for (const f of files) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const src = require('node:fs').readFileSync(path.join(ROOT, f), 'utf8') as string;
            for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
                if (new RegExp(`export const ${m}\\b`).test(src)) {
                    expect({ f, m, driven: CALLS.some((c) => c.file === f && c.method === m) }).toEqual({ f, m, driven: true });
                }
            }
        }
    });

    const named = (cs: Call[]) => cs.map((c) => [`${c.method} ${c.file.replace(`${I}/`, '')}`, c] as const);

    it.each(named(CALLS.filter((c) => c.key.startsWith('intake.'))))('a VIEWER is refused %s with a 403 and an AUTHZ_DENIED row', async (_n, c) => {
        const before = await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } });
        expect((await call('VIEWER', c)).status).toBe(403);
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } })).toBe(before + 1);
    });

    it.each(named(CALLS))('a GUEST is refused %s with a 403 and an AUTHZ_DENIED row naming the key (decision 204)', async (_n, c) => {
        const where = { tenantId, action: 'AUTHZ_DENIED', entity: 'Permission', entityId: c.key };
        const before = await prisma.auditLog.count({ where });
        expect((await call('GUEST', c)).status).toBe(403);
        expect(await prisma.auditLog.count({ where })).toBe(before + 1);
    });

    it.each(named(CALLS.filter((c) => c.key === 'intake.manage')))('a MEMBER is refused %s with a 403 and an AUTHZ_DENIED row', async (_n, c) => {
        const before = await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } });
        expect((await call('MEMBER', c)).status).toBe(403);
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } })).toBe(before + 1);
    });

    it.each(named(CALLS.filter((c) => c.key !== 'intake.manage')))('a MEMBER is admitted to %s (never a 403 or a 500)', async (_n, c) => {
        const { status } = await call('MEMBER', c);
        expect(status).not.toBe(403);
        expect(status).toBeLessThan(500);
    });

    it.each(named(CALLS))('an OWNER is admitted to %s (never a 403 or a 500)', async (_n, c) => {
        const { status } = await call('OWNER', c);
        expect(status).not.toBe(403);
        expect(status).toBeLessThan(500);
    });

    it('a VIEWER sends a request through the open form', async () => {
        const send = CALLS.find((c) => c.file.endsWith('[formId]/requests/route.ts'))!;
        expect((await call('VIEWER', send)).status).toBe(201);
    });
});
