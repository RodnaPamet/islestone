/**
 * My Work's list filters against a real Postgres, as `app_user` (owner
 * decision 54): `createdById`, `watching=me` and `due=soon` return the rows
 * they name and nothing from another workspace, a deleted project or (for a
 * GUEST, who sees no project until 8.4) any project at all.
 *
 * Every read goes through `listWorkItems`, the usecase the route calls, so the
 * filters are proved through `runInTenantContext` with row-level security on.
 */
import type { PrismaClient } from '@prisma/client';

import { DUE_SOON_DAYS } from '@/app-layer/domain/work-item-due';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import type { RequestContext } from '@/app-layer/types';
import { createProject, deleteProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem, listWorkItems, setWorkItemState } from '@/app-layer/usecases/work-item';
import { notificationsTz } from '@/app-layer/usecases/work-item-shared';
import { watchWorkItem } from '@/app-layer/usecases/work-item-collab';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wimw${Date.now().toString(36)}`;

/** A `YYYY-MM-DD` this many days from the workspace's today (date-only, no time zone). */
function dayFrom(today: Date, days: number): string {
    return new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

interface Workspace {
    tenantId: string;
    owner: RequestContext;
    member: RequestContext;
    guest: RequestContext;
    projectId: string;
    typeId: string;
    doneStateId: string;
}

describeFn('work-item list: the My Work filters', () => {
    let prisma: PrismaClient;
    let a: Workspace;
    let b: Workspace;
    let goneProjectId = '';
    const titlesOf = async (ctx: RequestContext, query: Parameters<typeof listWorkItems>[1]) =>
        (await listWorkItems(ctx, { ...query, limit: 100 })).items.map((i) => i.title).sort();

    async function workspace(slug: string, ownerId: string, memberId: string, guestId: string): Promise<Workspace> {
        const tenant = await createTenantWithDek({ name: slug, slug });
        await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: ownerId, role: 'OWNER' } });
        await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: memberId, role: 'MEMBER' } });
        await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: guestId, role: 'GUEST' } });
        const ctxFor = (role: 'OWNER' | 'MEMBER' | 'GUEST', userId: string) =>
            makeRequestContext(role, { tenantId: tenant.id, userId, tenantSlug: slug, requestId: `${slug}-${role}` });
        const owner = ctxFor('OWNER', ownerId);
        const team = await createTeam(owner, { name: 'Core' });
        const project = await createProject(owner, { teamId: team.id, name: 'Main', keyPrefix: 'MAIN' });
        const typeId = (await listWorkItemTypes(owner)).find((t) => t.name === 'Feature')!.id;
        return {
            tenantId: tenant.id,
            owner,
            member: ctxFor('MEMBER', memberId),
            guest: ctxFor('GUEST', guestId),
            projectId: project.id,
            typeId,
            doneStateId: team.workflowStates.find((s) => s.category === 'DONE')!.id,
        };
    }

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const ownerUser = await prisma.user.create({ data: { email: `owner-${TAG}@example.test`, name: 'Olive Owner' } });
        const memberUser = await prisma.user.create({ data: { email: `member-${TAG}@example.test`, name: 'Max Member' } });
        const guestUser = await prisma.user.create({ data: { email: `guest-${TAG}@example.test`, name: 'Gus Guest' } });
        // The same three people in two workspaces: a filter that forgot the
        // workspace would bring b's rows into a's answer.
        a = await workspace(`${TAG}a`, ownerUser.id, memberUser.id, guestUser.id);
        b = await workspace(`${TAG}b`, ownerUser.id, memberUser.id, guestUser.id);

        const today = todayInTz(new Date(), notificationsTz());
        const item = (w: Workspace, ctx: RequestContext, title: string, extra: Partial<Parameters<typeof createWorkItem>[1]> = {}) =>
            createWorkItem(ctx, { projectId: w.projectId, typeId: w.typeId, title, ...extra });

        for (const w of [a, b]) {
            const p = w === a ? 'A' : 'B';
            // Created by the member; the owner created the rest.
            const mine = await item(w, w.member, `${p} member-created`);
            await item(w, w.owner, `${p} owner-created`);
            // Watched by the member (the owner's item, so creation is not the reason).
            const watched = await item(w, w.owner, `${p} watched`);
            await watchWorkItem(w.member, watched.id);
            // Due windows, all assigned to the member.
            await item(w, w.owner, `${p} overdue`, { assigneeId: w.member.userId, dueDate: dayFrom(today, -2) });
            await item(w, w.owner, `${p} due today`, { assigneeId: w.member.userId, dueDate: dayFrom(today, 0) });
            await item(w, w.owner, `${p} due at the edge`, { assigneeId: w.member.userId, dueDate: dayFrom(today, DUE_SOON_DAYS) });
            await item(w, w.owner, `${p} due later`, { assigneeId: w.member.userId, dueDate: dayFrom(today, DUE_SOON_DAYS + 1) });
            await item(w, w.owner, `${p} no due date`, { assigneeId: w.member.userId });
            const done = await item(w, w.owner, `${p} due soon but done`, { assigneeId: w.member.userId, dueDate: dayFrom(today, 1) });
            await setWorkItemState(w.owner, done.id, { stateId: w.doneStateId }, done.version);
            void mine;
        }

        // A deleted project in a: its items match every filter and must never show.
        const team = await prisma.team.findFirstOrThrow({ where: { tenantId: a.tenantId } });
        const gone = await createProject(a.owner, { teamId: team.id, name: 'Gone', keyPrefix: 'GONE' });
        goneProjectId = gone.id;
        const goneItem = await createWorkItem(a.member, {
            projectId: gone.id,
            typeId: a.typeId,
            title: 'A gone',
            assigneeId: a.member.userId,
            dueDate: dayFrom(today, 1),
        });
        await watchWorkItem(a.member, goneItem.id);
        await deleteProject(a.owner, gone.id);
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    it('createdById returns the items that person created, in this workspace only', async () => {
        expect(await titlesOf(a.member, { createdById: a.member.userId })).toEqual(['A member-created']);
        expect(await titlesOf(b.member, { createdById: b.member.userId })).toEqual(['B member-created']);
    });

    it('watching=me returns the items the CALLER watches, in this workspace only', async () => {
        expect(await titlesOf(a.member, { watching: 'me' })).toEqual(['A watched']);
        // The owner watches nothing it did not ask to (the member's watch is not theirs).
        expect(await titlesOf(a.owner, { watching: 'me' })).not.toContain('A watched');
        expect(await titlesOf(b.member, { watching: 'me' })).toEqual(['B watched']);
    });

    it('due=soon is open items due by today + DUE_SOON_DAYS, overdue included', async () => {
        expect(await titlesOf(a.member, { assigneeId: a.member.userId, due: 'soon' })).toEqual(
            ['A due at the edge', 'A due today', 'A overdue'].sort(),
        );
    });

    it('a deleted project hides its items from every My Work filter', async () => {
        for (const query of [{ createdById: a.member.userId }, { watching: 'me' as const }, { assigneeId: a.member.userId, due: 'soon' as const }]) {
            const rows = (await listWorkItems(a.member, { ...query, limit: 100 })).items;
            expect(rows.some((r) => r.projectId === goneProjectId)).toBe(false);
        }
    });

    it('a GUEST, who sees no project yet, gets nothing from any filter', async () => {
        expect(await titlesOf(a.guest, { createdById: a.member.userId })).toEqual([]);
        expect(await titlesOf(a.guest, { watching: 'me' })).toEqual([]);
        expect(await titlesOf(a.guest, { due: 'soon' })).toEqual([]);
    });
});
