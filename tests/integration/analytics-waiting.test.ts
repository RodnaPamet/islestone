/**
 * Time waiting through its usecase against a real Postgres (sub-phase 3.6b;
 * owner decisions 76, 313, 317, 329, 330 and 332; ADR 0014 §6, §11 and §12;
 * docs/porting/maps/3.6.md, "Time waiting", "Privacy"):
 *
 *   - field waits from the record (a run naming one person, ended by
 *     another person, no one or a close; running at the moment of reading)
 *     and review waits from the review rows, made through the review
 *     usecases (a reviewer who signed off, one still asked), by hand, in
 *     working days on a Monday-to-Friday calendar;
 *   - the totals: time waited, of it as a reviewer, open item time and the
 *     share spent waiting (two reviewers at once count the item once), the
 *     items, the ended waits' median and 85th percentile, what waits now;
 *   - a deactivated member by name, every removed member as one anonymous
 *     row;
 *   - who sees which rows (decision 329): Owners and Admins every party,
 *     every other role its own row only (`people` absent, never empty), a
 *     custom grant or removal of `analytics.people` followed, a guest
 *     refused; a caller that is not a person reads the totals alone
 *     (decision 332);
 *   - the SQL read equals the pure rule (`segmentsOf`, `relevantSegments`)
 *     on random planted histories in several zones and scopes;
 *   - nothing is audited.
 *
 * Review rows are written through the review usecases with the clock (Date
 * only) set to the planted timeline; the record's rows are then replaced by
 * planted, back-dated ones (the test client, the login role). Written fresh
 * for Islestone.
 */
import fc from 'fast-check';
import type { PrismaClient, Role, WorkflowStateCategory } from '@prisma/client';

import { byItem } from '@/app-layer/domain/analytics/record';
import { relevantSegments, segmentsOf, type WaitFact } from '@/app-layer/domain/analytics/waiting';
import type { ProjectVisibility } from '@/app-layer/policies/project-visibility';
import { WorkItemTransitionRepository, type RecordScope } from '@/app-layer/repositories/WorkItemTransitionRepository';
import type { RequestContext } from '@/app-layer/types';
import { getTimeWaiting } from '@/app-layer/usecases/analytics-waiting';
import { createProject } from '@/app-layer/usecases/project';
import { getWorkItemReview, respondToReviewStep, sendWorkItemReview, setWorkItemReviewSteps } from '@/app-layer/usecases/review';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `anwt${Date.now().toString(36)}`;
const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];

/** The moment of reading: Friday 21 March 2031, noon UTC. Mondays: 3, 10, 17 March. */
const NOW = new Date('2031-03-21T12:00:00.000Z');
const at = (s: string) => new Date(`2031-${s}:00.000Z`);
const WINDOW = { from: '2031-03-03', to: '2031-03-21' };

describeFn('time waiting (3.6b)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    const ctxs = {} as Record<Role, RequestContext>;
    let owner: RequestContext;
    let ana: RequestContext;
    const users: Record<string, string> = {};
    let teamId = '';
    let p = '';
    let q = '';
    let typeId = '';
    const states = {} as Record<WorkflowStateCategory, string>;
    const ids: Record<string, string> = {};
    const savedTz = process.env.NOTIFICATIONS_TZ;

    async function history(item: string, rows: Array<{ at: Date; category: WorkflowStateCategory; waiting?: string | null }>) {
        await prisma.workItemTransition.deleteMany({ where: { workItemId: ids[item]! } });
        let previous: WorkflowStateCategory | null = null;
        for (const r of rows) {
            await prisma.workItemTransition.create({
                data: {
                    tenantId,
                    workItemId: ids[item]!,
                    projectId: p,
                    teamId,
                    stateId: states[r.category],
                    stateCategory: r.category,
                    fromStateCategory: previous,
                    waitingOnUserId: r.waiting ?? null,
                    deleted: false,
                    at: r.at,
                },
            });
            previous = r.category;
        }
    }

    /** Run `fn` with the clock (Date alone) at `when`. */
    async function atTime<T>(when: Date, fn: () => Promise<T>): Promise<T> {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
        jest.setSystemTime(when);
        try {
            return await fn();
        } finally {
            jest.useRealTimers();
        }
    }

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        for (const role of ROLES) {
            const u = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${TAG}@example.test`, name: role } });
            users[role] = u.id;
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            ctxs[role] = makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${role}` });
        }
        owner = ctxs.OWNER;
        for (const name of ['Ana', 'Ben', 'Deb', 'Former']) {
            const u = await prisma.user.create({ data: { email: `${name.toLowerCase()}-${TAG}@example.test`, name } });
            users[name] = u.id;
            // Former was removed: no membership row. Deb is deactivated.
            if (name !== 'Former') await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'MEMBER', status: name === 'Deb' ? 'DEACTIVATED' : 'ACTIVE' } });
        }
        ana = makeRequestContext('MEMBER', { tenantId, userId: users.Ana!, tenantSlug: TAG, requestId: `${TAG}-ana` });
        teamId = (await createTeam(owner, { name: 'Core' })).id;
        for (const s of await prisma.workflowState.findMany({ where: { teamId }, orderBy: { sortKey: 'asc' } })) states[s.category] ??= s.id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        p = (await createProject(owner, { teamId, name: 'Platform', keyPrefix: 'PLT' })).id;
        q = (await createProject(owner, { teamId, name: 'Mobile', keyPrefix: 'MOB' })).id;
        for (const key of ['r1', 'w1', 'w2', 'w3']) ids[key] = (await createWorkItem(owner, { projectId: p, typeId, title: key })).id;

        // r1: sent for review Wednesday 5 09:00 to Ana and Ben; Ana signs off Thursday 6 09:00; Ben is still asked.
        await setWorkItemReviewSteps(owner, ids.r1!, { steps: [{ name: 'Review', mode: 'ALL', dueInWorkingDays: 3, memberIds: [users.Ana!, users.Ben!], recipientListIds: [] }] });
        await atTime(at('03-05T09:00'), () => sendWorkItemReview(owner, ids.r1!));
        const stepId = (await getWorkItemReview(owner, ids.r1!)).rounds.find((r) => r.status === 'OPEN')!.steps[0]!.id;
        await atTime(at('03-06T09:00'), () => respondToReviewStep(ana, ids.r1!, stepId, { outcome: 'SIGNED_OFF' }));

        await history('r1', [
            { at: at('03-03T09:00'), category: 'UNSTARTED' },
            { at: at('03-04T09:00'), category: 'STARTED' },
        ]);
        // w1: waits on Ana Monday 10 to Wednesday 12 (2 days), then on Ben to now.
        await history('w1', [
            { at: at('03-03T09:00'), category: 'UNSTARTED' },
            { at: at('03-10T09:00'), category: 'UNSTARTED', waiting: users.Ana },
            { at: at('03-12T09:00'), category: 'STARTED', waiting: users.Ben },
        ]);
        // w2: waits on Deb (deactivated) Tuesday 11 to Thursday 13, closed then.
        await history('w2', [
            { at: at('03-03T09:00'), category: 'UNSTARTED' },
            { at: at('03-11T09:00'), category: 'STARTED', waiting: users.Deb },
            { at: at('03-13T09:00'), category: 'DONE' },
        ]);
        // w3: waits on a removed member one day, later on the Owner one day.
        await history('w3', [
            { at: at('03-03T09:00'), category: 'UNSTARTED' },
            { at: at('03-04T09:00'), category: 'UNSTARTED', waiting: users.Former },
            { at: at('03-05T09:00'), category: 'UNSTARTED' },
            { at: at('03-17T09:00'), category: 'UNSTARTED', waiting: users.OWNER },
            { at: at('03-18T09:00'), category: 'UNSTARTED' },
        ]);
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await prisma.$disconnect();
    });

    const row = (r: { party: { kind: string; name?: string | null } }) => (r.party.kind === 'former' ? 'former' : r.party.name);

    it('measures field and review waits in working days, with the totals and what waits now', async () => {
        const out = await getTimeWaiting(owner, { ...WINDOW, projectId: p }, NOW);
        expect(out.items).toBe(4);
        expect(out.totals).toEqual({
            // 3 (Ana) + 19.25 (Ben) + 2 (Deb) + 1 (removed) + 1 (Owner).
            waited: 26.3,
            asReviewer: 13.1,
            // r1 12.125 (two reviewers at once, the item once) + w1 9.125 + w2 2 + w3 2.
            itemTimeWaiting: 25.3,
            openItemTime: 50.4,
            share: 0.501,
            items: 4,
            ended: { count: 5, p50: 1, p85: 2 },
            waitingNow: 2,
        });
        expect(out.people!.map(row)).toEqual(['Ben', 'Ana', 'Deb', 'OWNER', 'former']);
        const [ben, anaRow, deb, own, former] = out.people!;
        expect(ben).toMatchObject({ waited: 19.3, asReviewer: 12.1, items: 2, ended: { count: 0, p50: null, p85: null }, waitingNow: 2 });
        expect(ben!.waitingNowItems.map((w) => [w.key, w.asReviewer, w.age])).toEqual([
            ['PLT-1', true, 12.1],
            ['PLT-2', false, 7.1],
        ]);
        expect(anaRow).toMatchObject({ party: { kind: 'member', userId: users.Ana, name: 'Ana', active: true }, waited: 3, asReviewer: 1, items: 2, ended: { count: 2, p50: 1, p85: 2 }, waitingNow: 0, waitingNowItems: [] });
        expect(deb).toMatchObject({ party: { kind: 'member', name: 'Deb', active: false }, waited: 2, ended: { count: 1, p50: 2, p85: 2 } });
        expect(own).toMatchObject({ party: { kind: 'member', userId: users.OWNER }, waited: 1 });
        expect(former).toEqual(expect.objectContaining({ party: { kind: 'former' }, waited: 1, items: 1 }));
        // The removed member is never named, by id or otherwise.
        expect(JSON.stringify(out)).not.toContain(users.Former);
        expect(out.self).toEqual(own);
        expect(out.waitingNowCut).toBe(false);
    });

    it('cuts the window: a wait counts only its overlap, and an ended wait its whole length', async () => {
        const out = await getTimeWaiting(owner, { from: '2031-03-12', to: '2031-03-21', projectId: p }, NOW);
        const anaRow = out.people!.find((r) => row(r) === 'Ana');
        // Neither of Ana's waits reaches Wednesday 12 00:00 … w1's ends at 09:00 that day: 0.4 days in the window.
        expect(anaRow).toMatchObject({ waited: 0.4, items: 1, ended: { count: 1, p50: 2, p85: 2 } });
        expect(out.people!.some((r) => r.party.kind === 'former')).toBe(false);
    });

    it('shows Owners and Admins every party, every other role its own row only, and refuses a guest (decision 329)', async () => {
        const admin = await getTimeWaiting(ctxs.ADMIN, { ...WINDOW, projectId: p }, NOW);
        expect(admin.people!.map(row)).toEqual(['Ben', 'Ana', 'Deb', 'OWNER', 'former', 'ADMIN']);
        expect(admin.self).toMatchObject({ party: { name: 'ADMIN' }, waited: 0, items: 0, waitingNow: 0 });
        for (const role of ['MEMBER', 'VIEWER'] as const) {
            const out = await getTimeWaiting(ctxs[role], { ...WINDOW, projectId: p }, NOW);
            expect('people' in out).toBe(false);
            expect(out.self).toMatchObject({ party: { kind: 'member', name: role }, waited: 0 });
            expect(out.totals.waited).toBe(26.3);
            // Nobody else's id reaches the answer.
            for (const other of [users.Ben, users.Deb, users.Former, users.OWNER]) expect(JSON.stringify(out)).not.toContain(other);
        }
        const mine = await getTimeWaiting(ana, { ...WINDOW, projectId: p }, NOW);
        expect('people' in mine).toBe(false);
        expect(mine.self).toMatchObject({ party: { userId: users.Ana, name: 'Ana' }, waited: 3, asReviewer: 1 });
        await expect(getTimeWaiting(ctxs.GUEST, { ...WINDOW, projectId: p }, NOW)).rejects.toMatchObject({ status: 403 });
    });

    it('follows a custom grant or removal of analytics.people', async () => {
        const grant = (c: RequestContext, people: boolean): RequestContext => ({ ...c, appPermissions: { ...c.appPermissions, analytics: { ...c.appPermissions.analytics, people } } });
        expect((await getTimeWaiting(grant(ctxs.MEMBER, true), { ...WINDOW, projectId: p }, NOW)).people).toHaveLength(6);
        expect('people' in (await getTimeWaiting(grant(ctxs.ADMIN, false), { ...WINDOW, projectId: p }, NOW))).toBe(false);
    });

    it('gives a caller that is not a person the totals alone (decision 332)', async () => {
        const out = await getTimeWaiting({ ...owner, apiKeyId: 'key_1' }, { ...WINDOW, projectId: p }, NOW);
        expect('people' in out).toBe(false);
        expect('self' in out).toBe(false);
        expect(out.totals.waited).toBe(26.3);
    });

    it("judges the scope as recorded: another project's waits are not this one's", async () => {
        const out = await getTimeWaiting(owner, { ...WINDOW, projectId: q }, NOW);
        expect(out.totals).toMatchObject({ waited: 0, items: 0, openItemTime: 0, share: null });
        expect(out.people!.map(row)).toEqual(['OWNER']);
    });

    it('writes nothing to the audit trail', async () => {
        const before = await prisma.auditLog.count({ where: { tenantId } });
        await getTimeWaiting(owner, { ...WINDOW, projectId: p }, NOW);
        expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(before);
    });

    describe('the SQL read equals the pure rule on random histories', () => {
        const USERS = ['u1', 'u2', 'u3'] as const;
        const ROW = fc.record({
            item: fc.integer({ min: 0, max: 7 }),
            hour: fc.integer({ min: 0, max: 30 * 24 }),
            ms: fc.integer({ min: 0, max: 2 }),
            category: fc.constantFrom<WorkflowStateCategory>('BACKLOG', 'UNSTARTED', 'STARTED', 'STARTED', 'DONE', 'CANCELLED'),
            waiting: fc.constantFrom<string | null>(null, null, ...USERS),
            project: fc.constantFrom<'p' | 'q'>('p', 'p', 'q'),
            deleted: fc.integer({ min: 0, max: 6 }).map((n) => n === 0),
        });
        const BASE = Date.UTC(2031, 5, 2);
        let round = 0;

        it('segments, positions and the read bound, in several zones and scopes', async () => {
            await fc.assert(
                fc.asyncProperty(fc.array(ROW, { minLength: 1, maxLength: 40 }), fc.integer({ min: 0, max: 30 * 24 }), fc.integer({ min: 1, max: 30 * 24 }), async (raw, startH, lenH) => {
                    round += 1;
                    const prefix = `${TAG}-w${round}-`;
                    await prisma.workItemTransition.deleteMany({ where: { tenantId, workItemId: { startsWith: `${TAG}-w` } } });
                    await prisma.workItemTransition.createMany({
                        data: raw.map((r) => ({
                            tenantId,
                            workItemId: `${prefix}${r.item}`,
                            projectId: r.project === 'p' ? p : q,
                            teamId,
                            stateId: states[r.category],
                            stateCategory: r.category,
                            waitingOnUserId: r.waiting,
                            deleted: r.deleted,
                            at: new Date(BASE + r.hour * 3_600_000 + r.ms * 1_800_000),
                        })),
                    });
                    const rows = await prisma.workItemTransition.findMany({ where: { tenantId, workItemId: { startsWith: prefix } } });
                    const facts: WaitFact[] = rows.map((r) => ({
                        workItemId: r.workItemId,
                        projectId: r.projectId,
                        teamId: r.teamId,
                        stateCategory: r.stateCategory,
                        cycleId: r.cycleId,
                        deleted: r.deleted,
                        at: r.at,
                        seq: Number(r.id),
                        waitingOnUserId: r.waitingOnUserId,
                    }));
                    const start = new Date(BASE + startH * 3_600_000);
                    const asOf = new Date(start.getTime() + lenH * 3_600_000);
                    const R = asOf.getTime();
                    for (const sc of [
                        { visibility: { kind: 'ALL' } as ProjectVisibility, projectIds: null as string[] | null },
                        { visibility: { kind: 'ALL' } as ProjectVisibility, projectIds: [p] },
                        { visibility: { kind: 'GRANTED', projectIds: [q] } as ProjectVisibility, projectIds: null },
                    ]) {
                        // The planted items only (the cases above are in the same workspace).
                        const itemIds = [...new Set(raw.map((r) => `${prefix}${r.item}`))];
                        const scope: RecordScope = { visibility: sc.visibility, projectIds: sc.projectIds, teamIds: null, cycle: null, milestone: null, itemIds };
                        const inScope = (r: WaitFact) => (sc.visibility.kind === 'ALL' || sc.visibility.projectIds.includes(r.projectId)) && (!sc.projectIds || sc.projectIds.includes(r.projectId));
                        const items = [...byItem(facts).values()].filter((list) => list.some((r) => r.at.getTime() <= R && inScope(r)));
                        // Some items have a review span: every live, in-scope segment of theirs is read.
                        const reviewItemIds = itemIds.filter((_, i) => i % 3 === 0);
                        const expected = relevantSegments(
                            items.flatMap((list) => segmentsOf(list, inScope, R)),
                            start.getTime(),
                            new Set(reviewItemIds),
                        );
                        const got = await runInTenantContext(owner, (db) => WorkItemTransitionRepository.waitSpans(db, owner, scope, { start, asOf, itemLimit: 1000, reviewItemIds }));
                        const key = (s: { workItemId: string; ord: number }) => `${s.workItemId}#${String(s.ord).padStart(3, '0')}`;
                        const sort = <T extends { workItemId: string; ord: number }>(xs: T[]) => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : 1));
                        expect({ sc, items: got.items, segments: sort(got.segments) }).toEqual({ sc, items: items.length, segments: sort(expected) });
                    }
                }),
                { numRuns: 40 },
            );
        }, 300_000);
    });
});
