/**
 * The review-step API, route by route, against a real Postgres (sub-phase
 * 2.8a; ADR 0009; owner decisions 150, 158 and 160): the H2 permission matrix
 * for the review routes.
 *
 *   - every route file under `work-items/[workItemId]/review/` is driven here
 *     (the population is read from git), each method once per role;
 *   - each route is called as OWNER, ADMIN, MEMBER, VIEWER and GUEST, on a
 *     fixture made for the call, and answers the status the matrix names;
 *   - a key refusal is a 403 with an `AUTHZ_DENIED` row (`requirePermission`),
 *     a refusal decided in the usecase (a person not named responding, the
 *     item's assignee responding, a member skipping without standing) is a 403
 *     with an `AUTHZ_DENIED` row too, and a GUEST, who holds no key until 8.4
 *     (owner decision 204), is refused every route by its key;
 *   - responding: every role that sees the project responds when named, and
 *     is refused when not; the assignee never (decision 158), even after
 *     being named and then assigned.
 *
 * `getTenantCtx` is replaced by a context for the role under test (the
 * session and edge are 1.4's, tested there); everything below it is real.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { NextRequest } from 'next/server';
import type { PrismaClient, Role } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));

import { createProject } from '@/app-layer/usecases/project';
import { getWorkItemReview, sendWorkItemReview, setWorkItemReviewSteps } from '@/app-layer/usecases/review';
import { createTeam } from '@/app-layer/usecases/team';
import { assignWorkItem, createWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { gitFiles } from '../helpers/git-files';
import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rapi${Date.now().toString(36)}`;
const ROOT = path.resolve(__dirname, '../..');
const RV = 'src/app/api/t/[tenantSlug]/work-items/[workItemId]/review';
const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface Fixture {
    item: string;
    step: string;
    other: string;
}

/** What a call needs set up: a planned round, or a sent one, naming `named` (plus Rae), sent by the OWNER. */
type Setup = 'none' | 'planned' | 'open';

interface Call {
    file: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    setup: Setup;
    path: (f: Fixture) => string;
    params: (f: Fixture) => Record<string, string>;
    body?: (f: Fixture, users: Record<string, string>) => unknown;
    /** The expected status per role (the caller not named on the step). */
    expect: Record<Role, number>;
}

const P = (f: Fixture, extra: Record<string, string> = {}) => ({ tenantSlug: TAG, workItemId: f.item, ...extra });
const EDIT = { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 403, GUEST: 403 } as const;
const CALLS: Call[] = [
    { file: `${RV}/route.ts`, method: 'GET', setup: 'open', path: (f) => `/work-items/${f.item}/review`, params: (f) => P(f), expect: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 200, GUEST: 403 } },
    {
        file: `${RV}/steps/route.ts`,
        method: 'PUT',
        setup: 'none',
        path: (f) => `/work-items/${f.item}/review/steps`,
        params: (f) => P(f),
        body: (_f, u) => ({ steps: [{ name: 'Check', mode: 'ALL', dueInWorkingDays: 2, memberIds: [u.RAE!] }] }),
        expect: EDIT,
    },
    { file: `${RV}/send/route.ts`, method: 'POST', setup: 'planned', path: (f) => `/work-items/${f.item}/review/send`, params: (f) => P(f), expect: EDIT },
    { file: `${RV}/withdraw/route.ts`, method: 'POST', setup: 'open', path: (f) => `/work-items/${f.item}/review/withdraw`, params: (f) => P(f), expect: EDIT },
    {
        file: `${RV}/steps/[stepId]/respond/route.ts`,
        method: 'POST',
        setup: 'open',
        path: (f) => `/work-items/${f.item}/review/steps/${f.step}/respond`,
        params: (f) => P(f, { stepId: f.step }),
        body: () => ({ outcome: 'SIGNED_OFF' }),
        // Not named: refused in the usecase; a GUEST by the key (decision 204).
        expect: { OWNER: 403, ADMIN: 403, MEMBER: 403, VIEWER: 403, GUEST: 403 },
    },
    {
        file: `${RV}/steps/[stepId]/skip/route.ts`,
        method: 'POST',
        setup: 'open',
        path: (f) => `/work-items/${f.item}/review/steps/${f.step}/skip`,
        params: (f) => P(f, { stepId: f.step }),
        // An admin has standing; a member who is neither the assignee nor the sender does not (decision 150).
        expect: { OWNER: 200, ADMIN: 200, MEMBER: 403, VIEWER: 403, GUEST: 403 },
    },
    {
        file: `${RV}/steps/[stepId]/reviewers/route.ts`,
        method: 'POST',
        setup: 'open',
        path: (f) => `/work-items/${f.item}/review/steps/${f.step}/reviewers`,
        params: (f) => P(f, { stepId: f.step }),
        body: (_f, u) => ({ userId: u.SAM! }),
        expect: EDIT,
    },
    {
        file: `${RV}/steps/[stepId]/reviewers/[userId]/route.ts`,
        method: 'DELETE',
        setup: 'open',
        path: (f) => `/work-items/${f.item}/review/steps/${f.step}/reviewers/${f.other}`,
        params: (f) => P(f, { stepId: f.step, userId: f.other }),
        expect: { OWNER: 200, ADMIN: 200, MEMBER: 403, VIEWER: 403, GUEST: 403 },
    },
];

function request(method: string, p: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/t/${TAG}${p}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

describeFn('the review-step API', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    const users: Record<string, string> = {};
    let projectId = '';
    let typeId = '';

    const ctxFor = (who: string, role: Role): RequestContext =>
        makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: users[who]!, requestId: `${TAG}-${who}-${Math.random()}` });
    const ROLE_OF: Record<string, Role> = { OWNER: 'OWNER', ADMIN: 'ADMIN', MEMBER: 'MEMBER', VIEWER: 'VIEWER', GUEST: 'GUEST', ANN: 'MEMBER', RAE: 'MEMBER', SAM: 'MEMBER' };
    const as = (who: string) => ctxFor(who, ROLE_OF[who]!);

    /** An item assigned to Ann; with a round naming `named` and Rae, planned or sent by the OWNER. */
    async function fixture(setup: Setup, named: string[] = []): Promise<Fixture> {
        const owner = as('OWNER');
        const item = await createWorkItem(owner, { projectId, typeId, title: `${setup} ${Math.random()}`, assigneeId: users.ANN });
        if (setup === 'none') return { item: item.id, step: 'none', other: users.RAE! };
        const memberIds = [...new Set([...named.map((n) => users[n]!), users.RAE!])];
        await setWorkItemReviewSteps(owner, item.id, { steps: [{ name: 'Check', mode: 'ALL', dueInWorkingDays: 2, memberIds, recipientListIds: [] }] });
        if (setup === 'open') await sendWorkItemReview(owner, item.id);
        const review = await getWorkItemReview(owner, item.id);
        return { item: item.id, step: review.rounds[0]!.steps[0]!.id, other: users.RAE! };
    }

    async function call(who: string, c: Call, f: Fixture) {
        getTenantCtxMock.mockResolvedValue(as(who));
        const mod = (await import(`../../${c.file}`)) as Record<string, Handler>;
        const res = await mod[c.method]!(request(c.method, c.path(f), c.body?.(f, users)), { params: Promise.resolve(c.params(f)) });
        return res.status;
    }

    const denied = () => prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        for (const who of Object.keys(ROLE_OF)) {
            const u = await prisma.user.create({ data: { email: `${who.toLowerCase()}-${TAG}@example.test`, name: who } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: ROLE_OF[who]! } });
            users[who] = u.id;
        }
        const owner = as('OWNER');
        const team = await createTeam(owner, { name: 'API' });
        projectId = (await createProject(owner, { teamId: team.id, name: 'Review API', keyPrefix: 'RAP' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('drives every review route file and method (the population is read from git)', () => {
        const files = gitFiles(ROOT).filter((f) => f.startsWith(`${RV}/`) && f.endsWith('/route.ts'));
        expect(files.length).toBe(8);
        for (const f of files) {
            const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
            for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
                if (new RegExp(`export const ${m}\\b`).test(src)) {
                    expect({ f, m, driven: CALLS.some((c) => c.file === f && c.method === m) }).toEqual({ f, m, driven: true });
                }
            }
        }
    });

    const cases = CALLS.flatMap((c) => ROLES.map((role) => [`${c.method} ${c.file.replace(`${RV}/`, 'review/')} as ${role}`, c, role] as const));

    it.each(cases)('%s', async (_n, c, role) => {
        const f = await fixture(c.setup);
        const before = await denied();
        const status = await call(role, c, f);
        expect({ role, status }).toEqual({ role, status: c.expect[role] });
        // Every 403, whether the key or the usecase refused, writes one AUTHZ_DENIED row.
        expect(await denied()).toBe(before + (status === 403 ? 1 : 0));
    });

    it.each(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const)('a %s named on the open step responds (decision 160: the read key and being named)', async (role) => {
        const f = await fixture('open', [role]);
        const respond = CALLS.find((c) => c.file.endsWith('/respond/route.ts'))!;
        expect(await call(role, respond, f)).toBe(200);
        const mine = (await getWorkItemReview(as('OWNER'), f.item)).rounds[0]!.steps[0]!.reviewers.find((r) => r.userId === users[role]);
        expect(mine?.outcome).toBe('SIGNED_OFF');
    });

    it('the assignee is refused, audited, even after being named and then assigned (decision 158)', async () => {
        const respond = CALLS.find((c) => c.file.endsWith('/respond/route.ts'))!;
        const f = await fixture('open', ['SAM']);
        // Naming the assignee is refused at the edit.
        const put = CALLS.find((c) => c.method === 'PUT')!;
        const blank = await fixture('none');
        getTenantCtxMock.mockResolvedValue(as('OWNER'));
        const mod = (await import(`../../${put.file}`)) as Record<string, Handler>;
        const res = await mod.PUT!(request('PUT', put.path(blank), { steps: [{ name: 'Self', mode: 'ALL', dueInWorkingDays: 1, memberIds: [users.ANN] }] }), {
            params: Promise.resolve(put.params(blank)),
        });
        expect(res.status).toBe(400);
        // Ann, the assignee, responding: refused and audited.
        let before = await denied();
        expect(await call('ANN', respond, f)).toBe(403);
        expect(await denied()).toBe(before + 1);
        // Sam, named, becomes the assignee: his row is withdrawn and he is refused.
        await assignWorkItem(as('OWNER'), f.item, { assigneeId: users.SAM! });
        before = await denied();
        expect(await call('SAM', respond, f)).toBe(403);
        expect(await denied()).toBe(before + 1);
    });

    it('the assignee and the sender have standing to skip (decision 150)', async () => {
        const skip = CALLS.find((c) => c.file.endsWith('/skip/route.ts'))!;
        expect(await call('ANN', skip, await fixture('open'))).toBe(200);
        const f = await fixture('planned');
        await sendWorkItemReview(as('SAM'), f.item);
        expect(await call('SAM', skip, f)).toBe(200);
    });
});
