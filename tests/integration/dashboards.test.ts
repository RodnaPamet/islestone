/**
 * Dashboards (sub-phase 3.6d; docs/porting/maps/3.6.md, "Dashboards (3.6d)";
 * ADR 0014 §6; owner decisions 326 to 329), against a real Postgres:
 *
 *   - the catalogue: the CHECKs (name and title lengths, the grid's bounds,
 *     the version, a configuration object), the composite key's cascade and
 *     the four policies with FORCE;
 *   - who: personal dashboards for every `analytics.view` holder, Viewers
 *     included; shared ones with `analytics.share`, changed only by their
 *     creator; another person's personal one a 404; an Owner or Admin deletes
 *     a shared one as `DASHBOARD_MODERATED` and never changes it; every
 *     refusal past the route's key audited `AUTHZ_DENIED`;
 *   - widgets: the whole list replaced on the version read (428 without it,
 *     409 `VERSION_CONFLICT` with the server's dashboard), ids kept for the
 *     widgets already there, titles and searches sanitised, at most 24
 *     (`DASHBOARD_TOO_LARGE`), a stored configuration that no longer parses
 *     read as `shape: null`; a person keeps at most 50 (`DASHBOARD_LIMIT`);
 *   - the audit: counts and types, never a scope's values;
 *   - a member's removal deletes their personal dashboards and keeps their
 *     shared ones, "Created by a former member";
 *   - two-tenant isolation (ISOLATION_TESTED: Dashboard, DashboardWidget).
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createDashboard, deleteDashboard, getDashboard, listDashboards, setDashboardWidgets, updateDashboard } from '@/app-layer/usecases/dashboard';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { DASHBOARD_LIMITS } from '@/lib/analytics/dashboard';
import { DEFAULT_DASHBOARD } from '@/lib/analytics/default-dashboard';
import type { DashboardWidgetInput } from '@/lib/schemas/dashboard';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `dsh${Date.now().toString(36)}`;

async function failure(p: Promise<unknown>): Promise<{ status?: number; code?: string; reason?: string; details?: Record<string, unknown> }> {
    try {
        await p;
    } catch (err) {
        const e = err as { status?: number; code?: string; details?: Record<string, unknown> };
        return { status: e.status, code: e.code, reason: e.details?.reason as string | undefined, details: e.details };
    }
    return {};
}

function counts(x: number, y: number, extra: Partial<DashboardWidgetInput> = {}): DashboardWidgetInput {
    return { type: 'COUNTS', config: { scope: { filters: {} }, window: { kind: 'weeks', weeks: 12 } }, position: { x, y }, size: { w: 12, h: 3 }, ...extra } as DashboardWidgetInput;
}

describeFn('dashboards (3.6d)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let admin: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let leaver: RequestContext;
    let leaverMembershipId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (who: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') => {
            const u = await prisma.user.create({ data: { email: `${who}-${TAG}@example.test`, name: who } });
            const m = await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return { ctx: makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: u.id, requestId: `${TAG}-${who}` }), membershipId: m.id };
        };
        owner = (await mk('owner', 'OWNER')).ctx;
        admin = (await mk('admin', 'ADMIN')).ctx;
        member = (await mk('member', 'MEMBER')).ctx;
        viewer = (await mk('viewer', 'VIEWER')).ctx;
        const l = await mk('leaver', 'MEMBER');
        leaver = l.ctx;
        leaverMembershipId = l.membershipId;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('the catalogue', () => {
        it('holds the CHECKs, the cascade and the policies', async () => {
            const checks = await prisma.$queryRaw<Array<{ conname: string }>>`
                SELECT conname FROM pg_constraint WHERE conrelid IN ('"Dashboard"'::regclass, '"DashboardWidget"'::regclass) AND contype = 'c' ORDER BY conname`;
            expect(checks.map((c) => c.conname)).toEqual([
                'DashboardWidget_config_object',
                'DashboardWidget_grid_bounds',
                'DashboardWidget_title_length',
                'Dashboard_name_length',
                'Dashboard_version_positive',
            ]);
            const fk = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'DashboardWidget_dashboardId_tenantId_fkey'`;
            expect(fk[0]!.def).toMatch(/FOREIGN KEY \("dashboardId", "tenantId"\) REFERENCES "Dashboard"\(id, "tenantId"\) ON UPDATE CASCADE ON DELETE CASCADE/);
            const policies = await prisma.$queryRaw<Array<{ tablename: string; policyname: string }>>`
                SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('Dashboard', 'DashboardWidget') ORDER BY tablename, policyname`;
            expect(policies.map((p) => `${p.tablename}.${p.policyname}`)).toEqual([
                'Dashboard.superuser_bypass',
                'Dashboard.tenant_isolation',
                'Dashboard.tenant_isolation_insert',
                'DashboardWidget.superuser_bypass',
                'DashboardWidget.tenant_isolation',
                'DashboardWidget.tenant_isolation_insert',
            ]);
            const forced = await prisma.$queryRaw<Array<{ relname: string; relforcerowsecurity: boolean }>>`
                SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('Dashboard', 'DashboardWidget') ORDER BY relname`;
            expect(forced.every((r) => r.relforcerowsecurity)).toBe(true);
        });

        it('refuses a widget off the grid, a long title and a configuration that is not an object', async () => {
            const d = await createDashboard(owner, { name: 'Catalogue', visibility: 'PERSONAL' });
            const base = { tenantId, dashboardId: d.id, type: 'COUNTS' as const, configJson: {}, x: 0, y: 0, w: 1, h: 1 };
            await expect(prisma.dashboardWidget.create({ data: { ...base, x: 48 } })).rejects.toThrow(/DashboardWidget_grid_bounds/);
            await expect(prisma.dashboardWidget.create({ data: { ...base, w: 13 } })).rejects.toThrow(/DashboardWidget_grid_bounds/);
            await expect(prisma.dashboardWidget.create({ data: { ...base, h: 0 } })).rejects.toThrow(/DashboardWidget_grid_bounds/);
            await expect(prisma.dashboardWidget.create({ data: { ...base, title: 'x'.repeat(121) } })).rejects.toThrow(/DashboardWidget_title_length/);
            await expect(prisma.dashboardWidget.create({ data: { ...base, configJson: [] } })).rejects.toThrow(/DashboardWidget_config_object/);
            await expect(prisma.dashboard.update({ where: { id: d.id }, data: { name: '' } })).rejects.toThrow(/Dashboard_name_length/);
            // The widgets go with their dashboard.
            await prisma.dashboardWidget.create({ data: base });
            await deleteDashboard(owner, d.id);
            expect(await prisma.dashboardWidget.count({ where: { dashboardId: d.id } })).toBe(0);
        });
    });

    describe('who keeps and changes dashboards (decision 326)', () => {
        it('lets a Viewer keep personal dashboards and refuses it a shared one, audited', async () => {
            const mine = await createDashboard(viewer, { name: 'Viewer’s own', visibility: 'PERSONAL', widgets: [counts(0, 0)] });
            expect(mine.mine).toBe(true);
            expect(mine.viewer).toEqual({ change: true, delete: true, share: false });
            const refused = await failure(createDashboard({ ...viewer, requestId: `${TAG}-v-share` }, { name: 'Shared', visibility: 'SHARED' }));
            expect(refused).toMatchObject({ status: 403, reason: 'DASHBOARD_SHARE_NOT_PERMITTED' });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', requestId: `${TAG}-v-share` } })).toBe(1);
            const switching = await failure(updateDashboard(viewer, mine.id, { visibility: 'SHARED' }, undefined));
            expect(switching).toMatchObject({ status: 403, reason: 'DASHBOARD_CHANGE_NOT_PERMITTED' });
        });

        it("hides another person's personal dashboard and shows every shared one", async () => {
            const personal = await createDashboard(member, { name: 'Member private', visibility: 'PERSONAL' });
            const shared = await createDashboard(member, { name: 'Member team', visibility: 'SHARED' });
            expect((await failure(getDashboard(admin, personal.id))).status).toBe(404);
            expect((await failure(deleteDashboard(owner, personal.id))).status).toBe(404);
            const list = await listDashboards(viewer);
            expect(list.dashboards.map((d) => d.id)).toContain(shared.id);
            expect(list.dashboards.map((d) => d.id)).not.toContain(personal.id);
            expect(list.default).toEqual(DEFAULT_DASHBOARD);
            const seen = await getDashboard(viewer, shared.id);
            expect(seen.viewer).toEqual({ change: false, delete: false, share: false });
        });

        it('lets only the creator change a shared dashboard; an Owner or Admin deletes it, moderated', async () => {
            const shared = await createDashboard(member, { name: 'Ops', visibility: 'SHARED', widgets: [counts(0, 0)] });
            expect((await getDashboard(owner, shared.id)).viewer).toEqual({ change: false, delete: true, share: true });
            const rename = await failure(updateDashboard({ ...owner, requestId: `${TAG}-o-rename` }, shared.id, { name: 'Mine now' }, undefined));
            expect(rename).toMatchObject({ status: 403, reason: 'DASHBOARD_CHANGE_CREATOR_ONLY' });
            const layout = await failure(setDashboardWidgets(admin, shared.id, [], shared.version));
            expect(layout).toMatchObject({ status: 403, reason: 'DASHBOARD_CHANGE_CREATOR_ONLY' });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', requestId: `${TAG}-o-rename` } })).toBe(1);
            // Another Member may neither change nor delete it.
            const otherMember = makeRequestContext('MEMBER', { tenantId, tenantSlug: TAG, userId: leaver.userId, requestId: `${TAG}-x` });
            expect(await failure(deleteDashboard(otherMember, shared.id))).toMatchObject({ status: 403, reason: 'DASHBOARD_DELETE_CREATOR_OR_ADMIN' });
            const renamed = await updateDashboard(member, shared.id, { name: '  Ops <b>weekly</b>  ' }, shared.version);
            expect(renamed.name).toBe('Ops weekly');
            expect(renamed.version).toBe(shared.version + 1);
            expect(await deleteDashboard(admin, shared.id)).toEqual({ deleted: true, moderated: true });
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, entityId: shared.id, action: 'DASHBOARD_MODERATED' } });
            expect(entry).not.toBeNull();
        });

        it('lets the creator unshare, and refuses a stale If-Match with the server’s dashboard', async () => {
            const d = await createDashboard(member, { name: 'Shared once', visibility: 'SHARED' });
            const unshared = await updateDashboard(member, d.id, { visibility: 'PERSONAL' }, d.version);
            expect(unshared.visibility).toBe('PERSONAL');
            const stale = await failure(updateDashboard(member, d.id, { name: 'Late' }, d.version));
            expect(stale).toMatchObject({ status: 409, reason: 'VERSION_CONFLICT' });
            expect((stale.details!.dashboard as { version: number }).version).toBe(unshared.version);
        });
    });

    describe('widgets', () => {
        it('replaces the list on the version read, keeps the ids already there and sanitises', async () => {
            const d = await createDashboard(member, { name: 'Layout', visibility: 'PERSONAL', widgets: [counts(0, 0), counts(0, 3)] });
            expect(d.widgets).toHaveLength(2);
            const [first] = d.widgets;
            expect((await failure(setDashboardWidgets(member, d.id, [], undefined))).status).toBe(428);
            const next = await setDashboardWidgets(
                member,
                d.id,
                [
                    { ...counts(0, 0, { title: ' <i>Open</i> now ' }), id: first!.id },
                    {
                        type: 'THROUGHPUT',
                        config: { scope: { filters: { labelId: ['x'] }, q: ' <script>a</script>b ' }, window: { kind: 'weeks', weeks: 4 }, bin: 'day' },
                        id: 'not-on-this-dashboard',
                        position: { x: 0, y: 3 },
                        size: { w: 6, h: 6 },
                    },
                ],
                d.version,
            );
            expect(next.version).toBe(d.version + 1);
            expect(next.widgets.map((w) => w.type)).toEqual(['COUNTS', 'THROUGHPUT']);
            expect(next.widgets[0]!.id).toBe(first!.id);
            expect(next.widgets[0]!.title).toBe('Open now');
            expect(next.widgets[1]!.id).not.toBe('not-on-this-dashboard');
            expect(next.widgets[1]!.shape).toEqual({ type: 'THROUGHPUT', config: { scope: { filters: { labelId: ['x'] }, q: 'b' }, window: { kind: 'weeks', weeks: 4 }, bin: 'day' } });
            // A stale version is a conflict that carries the server's layout.
            const stale = await failure(setDashboardWidgets(member, d.id, [], d.version));
            expect(stale).toMatchObject({ status: 409, reason: 'VERSION_CONFLICT' });
            expect((stale.details!.dashboard as { widgets: unknown[] }).widgets).toHaveLength(2);
            // The audit names counts and types, never a scope's values.
            const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, entityId: d.id, action: 'DASHBOARD_WIDGETS_SET' } });
            const text = JSON.stringify(entry);
            expect(text).toContain('"widgetCount":2');
            expect(text).toContain('"THROUGHPUT":1');
            expect(text).not.toContain('labelId');
        });

        it('refuses more than 24 widgets and a custom-field scope', async () => {
            const d = await createDashboard(member, { name: 'Too many', visibility: 'PERSONAL' });
            const many = Array.from({ length: DASHBOARD_LIMITS.widgets + 1 }, (_, i) => counts(0, Math.min(i, 47)));
            expect(await failure(setDashboardWidgets(member, d.id, many, d.version))).toMatchObject({ status: 400, code: 'DASHBOARD_TOO_LARGE' });
            const cf = { type: 'COUNTS', config: { scope: { filters: { 'cf.abc': ['1'] } }, window: { kind: 'weeks', weeks: 12 } }, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } } as DashboardWidgetInput;
            expect((await failure(setDashboardWidgets(member, d.id, [cf], d.version))).status).toBe(400);
        });

        it('reads a stored configuration that no longer parses as shape null, and the rest of the dashboard', async () => {
            const d = await createDashboard(member, { name: 'Old shape', visibility: 'PERSONAL', widgets: [counts(0, 0)] });
            await prisma.dashboardWidget.create({ data: { tenantId, dashboardId: d.id, type: 'BURN_UP', configJson: { measure: 'velocity' }, x: 0, y: 3, w: 12, h: 6 } });
            const read = await getDashboard(member, d.id);
            expect(read.widgets.map((w) => [w.type, w.shape === null])).toEqual([
                ['COUNTS', false],
                ['BURN_UP', true],
            ]);
        });

        it('keeps a person to 50 dashboards', async () => {
            const someone = makeRequestContext('VIEWER', { tenantId, tenantSlug: TAG, userId: viewer.userId, requestId: `${TAG}-cap` });
            const have = await prisma.dashboard.count({ where: { tenantId, createdByUserId: viewer.userId } });
            await prisma.dashboard.createMany({
                data: Array.from({ length: DASHBOARD_LIMITS.perPerson - have }, (_, i) => ({ tenantId, name: `Bulk ${i}`, visibility: 'PERSONAL' as const, createdByUserId: viewer.userId })),
            });
            expect(await failure(createDashboard(someone, { name: 'One more', visibility: 'PERSONAL' }))).toMatchObject({ status: 409, code: 'DASHBOARD_LIMIT' });
            await prisma.dashboard.deleteMany({ where: { tenantId, createdByUserId: viewer.userId, name: { startsWith: 'Bulk ' } } });
        });
    });

    describe("a member's removal", () => {
        it('deletes their personal dashboards and keeps their shared ones, created by a former member', async () => {
            const personal = await createDashboard(leaver, { name: 'Leaving soon', visibility: 'PERSONAL', widgets: [counts(0, 0)] });
            const shared = await createDashboard(leaver, { name: 'Left behind', visibility: 'SHARED', widgets: [counts(0, 0)] });
            await removeTenantMember(owner, { membershipId: leaverMembershipId });
            expect(await prisma.dashboard.count({ where: { id: personal.id } })).toBe(0);
            expect(await prisma.dashboardWidget.count({ where: { dashboardId: personal.id } })).toBe(0);
            const kept = (await listDashboards(member)).dashboards.find((d) => d.id === shared.id);
            expect(kept).toMatchObject({ createdByFormerMember: true, mine: false });
            expect((await getDashboard(member, shared.id)).viewer.change).toBe(false);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'DASHBOARDS_DELETED_ON_MEMBER_REMOVAL' } })).toBe(1);
            // Its departed creator can no longer save one.
            expect((await failure(createDashboard({ ...leaver, requestId: `${TAG}-gone` }, { name: 'After', visibility: 'PERSONAL' }))).status).toBe(400);
        });
    });

    describe('two-tenant isolation', () => {
        it("one workspace's dashboards and widgets never reach another's reads or writes", async () => {
            const ours = await createDashboard(member, { name: 'Ours', visibility: 'SHARED', widgets: [counts(0, 0)] });
            const otherTenant = (await createTenantWithDek({ name: `${TAG}x`, slug: `${TAG}x` })).id;
            const ou = await prisma.user.create({ data: { email: `outsider-${TAG}@example.test`, name: 'outsider' } });
            await prisma.tenantMembership.create({ data: { tenantId: otherTenant, userId: ou.id, role: 'OWNER' } });
            const outsider = makeRequestContext('OWNER', { tenantId: otherTenant, tenantSlug: `${TAG}x`, userId: ou.id, requestId: `${TAG}-outsider` });
            expect((await listDashboards(outsider)).dashboards).toEqual([]);
            expect(await runInTenantContext(outsider, (db) => db.dashboard.count())).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.dashboardWidget.count())).toBe(0);
            expect((await failure(getDashboard(outsider, ours.id))).status).toBe(404);
            expect((await failure(deleteDashboard(outsider, ours.id))).status).toBe(404);
            expect((await failure(setDashboardWidgets(outsider, ours.id, [], ours.version))).status).toBe(404);
            // A raw insert naming another workspace is refused by row-level security, for both tables.
            await expect(runInTenantContext(outsider, (db) => db.dashboard.create({ data: { tenantId, name: 'x', visibility: 'SHARED', createdByUserId: ou.id } }))).rejects.toThrow();
            await expect(
                runInTenantContext(outsider, (db) => db.dashboardWidget.create({ data: { tenantId, dashboardId: ours.id, type: 'COUNTS', configJson: {}, x: 0, y: 0, w: 1, h: 1 } })),
            ).rejects.toThrow();
            expect(await prisma.dashboardWidget.count({ where: { dashboardId: ours.id } })).toBe(1);
        });

        it('kept the audit chain whole', async () => {
            expect((await verifyAuditChain(tenantId)).valid).toBe(true);
        });
    });
});
