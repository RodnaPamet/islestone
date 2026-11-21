/**
 * The timeline read against a real Postgres (roadmap 3.1b; ADR 0010; owner
 * decisions 184 to 198):
 *
 *   - a project's timeline holds its items, a visible item outside the scope
 *     that a blocks relation reaches as a read-only context row, a relation
 *     to a deleted item counted and never named, a cancelled item shown but
 *     not scheduled, and the engine's answer computed on the server: the
 *     chain is the critical path and the project's due date is missed;
 *   - the list's filters apply through the list's own `where`: the timeline
 *     and the list with the same filters hold the same items;
 *   - an item counts on its team's working calendar;
 *   - a GUEST sees no item and no relation (8.4 has not granted projects);
 *   - a scope over 5,000 items is refused with the count, never cut; a
 *     narrower filter over the same project is read;
 *   - the route matrix: every role holding `work_items.view` is admitted, a
 *     role without it gets a 403 and an `AUTHZ_DENIED` row;
 *   - the read writes nothing to the audit trail, and the chain verifies.
 *
 * Written fresh for Islestone.
 */
import { NextRequest } from 'next/server';
import type { PrismaClient, Role } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));

import { fromEpochDay, isoWeekday, todayIn } from '@/app-layer/domain/schedule/calendar';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem, deleteWorkItem, listWorkItems, setWorkItemState } from '@/app-layer/usecases/work-item';
import { addWorkItemRelation } from '@/app-layer/usecases/work-item-relations';
import { getWorkItemTimeline } from '@/app-layer/usecases/work-item-timeline';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { setTeamWorkingCalendar } from '@/app-layer/usecases/working-calendar';
import { verifyAuditChain } from '@/lib/audit';
import { AppError } from '@/lib/errors/types';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';
import { TIMELINE_ITEM_LIMIT, type TimelineResponse } from '@/lib/work-items/timeline';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wtl${Date.now().toString(36)}`;
const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** The first Monday at least three weeks after today (UTC): every planned date is after today. */
function baseMonday(): number {
    let d = todayIn('UTC', new Date()) + 21;
    while (isoWeekday(d) !== 1) d += 1;
    return d;
}

describeFn('the timeline read (3.1b)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    const ctxs = {} as Record<Role, RequestContext>;
    let owner: RequestContext;
    let teamId = '';
    let otherTeamId = '';
    let projectId = '';
    let otherProjectId = '';
    let bigProjectId = '';
    let typeId = '';
    const ids: Record<string, string> = {};
    const day = (offset: number) => fromEpochDay(baseMonday() + offset);
    const savedTz = process.env.NOTIFICATIONS_TZ;

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        for (const role of ROLES) {
            const u = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${TAG}@example.test`, name: role } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            ctxs[role] = makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${role}` });
        }
        owner = ctxs.OWNER;
        teamId = (await createTeam(owner, { name: 'Core' })).id;
        otherTeamId = (await createTeam(owner, { name: 'Edge' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        // The project is due on Thursday of the second week; the chain finishes on Friday.
        projectId = (await createProject(owner, { teamId, name: 'Platform', keyPrefix: 'PLT', dueDate: day(10) })).id;
        otherProjectId = (await createProject(owner, { teamId: otherTeamId, name: 'Mobile', keyPrefix: 'MOB' })).id;
        bigProjectId = (await createProject(owner, { teamId, name: 'Backlog', keyPrefix: 'BIG' })).id;

        const mk = async (key: string, input: Record<string, unknown>) => {
            ids[key] = (await createWorkItem(owner, { projectId, typeId, title: key, ...input })).id;
        };
        await mk('A', { startDate: day(0), dueDate: day(1) });
        await mk('B', { startDate: day(2), dueDate: day(4) });
        await mk('C', { startDate: day(7), dueDate: day(11) });
        await mk('Free', { startDate: day(0), dueDate: day(0) });
        await mk('Undated', {});
        await mk('Gone', {});
        await mk('Dropped', { startDate: day(0), dueDate: day(0) });
        ids.X = (await createWorkItem(owner, { projectId: otherProjectId, typeId, title: 'X', startDate: day(-7), dueDate: day(-7) })).id;

        await addWorkItemRelation(owner, ids.A!, { type: 'BLOCKS', toId: ids.B! });
        await addWorkItemRelation(owner, ids.B!, { type: 'BLOCKS', toId: ids.C! });
        await addWorkItemRelation(owner, ids.X!, { type: 'BLOCKS', toId: ids.A! });
        await addWorkItemRelation(owner, ids.Gone!, { type: 'BLOCKS', toId: ids.C! });
        await addWorkItemRelation(owner, ids.Dropped!, { type: 'BLOCKS', toId: ids.C! });
        await deleteWorkItem(owner, ids.Gone!);
        const cancelled = await prisma.workflowState.findFirstOrThrow({ where: { tenantId, teamId, category: 'CANCELLED' } });
        await setWorkItemState(owner, ids.Dropped!, { stateId: cancelled.id });
        await setTeamWorkingCalendar(owner, otherTeamId, { timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5, 6] });
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    const byTitle = (t: TimelineResponse, title: string) => t.rows.find((r) => r.title === title);

    it("a project's timeline: its items, a context row, a hidden relation counted, a cancelled item unscheduled, the critical path", async () => {
        const auditBefore = await prisma.auditLog.count({ where: { tenantId } });
        const t = await getWorkItemTimeline(ctxs.MEMBER, { projectId });
        expect(t.rows.filter((r) => !r.context).map((r) => r.title).sort()).toEqual(['A', 'B', 'C', 'Dropped', 'Free', 'Undated']);
        // X is in another project the member sees: a read-only context row on its own team's calendar.
        expect(byTitle(t, 'X')).toMatchObject({ context: true, key: expect.stringMatching(/^MOB-\d+$/) });
        expect(byTitle(t, 'X')!.calendarId).not.toBe(byTitle(t, 'A')!.calendarId);
        // The relation from the deleted item is counted, never named.
        expect(t.hiddenDependencies).toBe(1);
        expect(t.rows.some((r) => r.id === ids.Gone)).toBe(false);
        expect(t.edges.map((e) => [e.fromId, e.toId]).sort()).toEqual(
            [
                [ids.A, ids.B],
                [ids.B, ids.C],
                [ids.Dropped, ids.C],
                [ids.X, ids.A],
            ].sort(),
        );
        expect(t.omittedContextRows).toBe(0);
        expect(t.projects.find((p) => p.id === projectId)?.dueDate).toBe(day(10));
        expect(t.asOf).toBe(fromEpochDay(todayIn('UTC', new Date())));

        // The engine ran on the server: A → B → C is critical and misses the project's due date.
        if (!t.schedule.ok) throw new Error('expected a schedule');
        const s = new Map(t.schedule.items.map((i) => [i.id, i]));
        expect(s.has(ids.Dropped!)).toBe(false);
        expect([ids.A, ids.B, ids.C].map((id) => s.get(id!)!.critical)).toEqual([true, true, true]);
        expect(s.get(ids.Free!)!.critical).toBe(false);
        expect(s.get(ids.C!)!.conflicts).toContain('MISSES_PROJECT_DUE_DATE');
        expect(s.get(ids.C!)!.lateDays).toBe(1);
        expect(s.get(ids.Undated!)!.unscheduled).toBe(true);
        expect(t.schedule.criticalEdges).toEqual(expect.arrayContaining([{ from: ids.A, to: ids.B }]));
        // A read writes nothing.
        expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(auditBefore);
    });

    it("the list's filters apply: the timeline and the list hold the same items", async () => {
        for (const filters of [{ projectId, stateCategory: 'UNSTARTED,BACKLOG' }, { projectId, q: 'Free' }, { assigneeId: 'none', projectId: otherProjectId }]) {
            const t = await getWorkItemTimeline(ctxs.MEMBER, filters);
            const list = await listWorkItems(ctxs.MEMBER, { ...filters, limit: 100 });
            expect(t.rows.filter((r) => !r.context).map((r) => r.id).sort()).toEqual(list.items.map((i) => i.id).sort());
        }
    });

    it('a GUEST sees no item and no relation', async () => {
        const t = await getWorkItemTimeline(ctxs.GUEST, { projectId });
        expect(t).toMatchObject({ rows: [], edges: [], hiddenDependencies: 0 });
    });

    it('a scope over 5,000 items is refused with the count; a narrower filter is read', async () => {
        const project = await prisma.project.findUniqueOrThrow({ where: { id: bigProjectId } });
        const state = await prisma.workflowState.findFirstOrThrow({ where: { tenantId, teamId, category: 'BACKLOG' } });
        const n = TIMELINE_ITEM_LIMIT + 1;
        await prisma.workItem.createMany({
            data: Array.from({ length: n }, (_, i) => ({
                tenantId,
                projectId: project.id,
                teamId,
                typeId,
                stateId: state.id,
                stateCategory: 'BACKLOG' as const,
                number: 100_000 + i,
                title: i === 0 ? 'needle' : `bulk ${i}`,
                sortKey: `a${String(i).padStart(6, '0')}`,
                createdByUserId: owner.userId,
            })),
        });
        let refusal: unknown;
        try {
            await getWorkItemTimeline(ctxs.MEMBER, { projectId: bigProjectId });
        } catch (err) {
            refusal = err;
        }
        expect(refusal).toBeInstanceOf(AppError);
        expect(refusal).toMatchObject({ status: 422, code: 'TIMELINE_TOO_LARGE', details: { reason: 'TIMELINE_TOO_LARGE', count: n, limit: TIMELINE_ITEM_LIMIT, what: 'items' } });
        const narrow = await getWorkItemTimeline(ctxs.MEMBER, { projectId: bigProjectId, q: 'needle' });
        expect(narrow.rows.map((r) => r.title)).toEqual(['needle']);
    });

    describe('the route', () => {
        const call = async (ctx: RequestContext) => {
            getTenantCtxMock.mockResolvedValue({ ...ctx, requestId: `${TAG}-${Math.random()}` });
            const mod = (await import('../../src/app/api/t/[tenantSlug]/work-items/timeline/route')) as Record<string, Handler>;
            const req = new NextRequest(`http://localhost/api/t/${TAG}/work-items/timeline?projectId=${projectId}`, { headers: { 'x-forwarded-for': '10.0.0.7' } });
            const res = await mod.GET!(req, { params: Promise.resolve({ tenantSlug: TAG }) });
            return { status: res.status, body: (await res.json()) as TimelineResponse & { error?: { code: string } } };
        };

        it.each(ROLES)('admits %s (work_items.view), a GUEST to an empty timeline', async (role) => {
            const res = await call(ctxs[role]);
            expect(res.status).toBe(200);
            if (role === 'GUEST') expect(res.body.rows).toEqual([]);
            else expect(res.body.rows.filter((r) => !r.context)).toHaveLength(6);
        });

        it('refuses a role without work_items.view with a 403 and an AUTHZ_DENIED row', async () => {
            const perms = getPermissionsForRole('VIEWER');
            const narrowed: RequestContext = { ...ctxs.VIEWER, appPermissions: { ...perms, work_items: { ...perms.work_items, view: false } } };
            const before = await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } });
            const res = await call(narrowed);
            expect(res.status).toBe(403);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } })).toBe(before + 1);
        });

        it('the audit chain verifies', async () => {
            expect((await verifyAuditChain(tenantId, prisma)).valid).toBe(true);
        });
    });
});
