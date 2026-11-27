/**
 * Dashboards' pure rules (sub-phase 3.6d; docs/porting/maps/3.6.md,
 * "Dashboards (3.6d)"; owner decisions 326 to 329): who keeps, changes and
 * deletes a dashboard over the built-in roles and a custom role; the widget
 * schema (inflect's grid bounds and the discriminated union, the scope as the
 * saved-view filters less custom fields); the default composition fitting
 * its own schema and grid; and the scope and window helpers.
 */
import type { Role } from '@prisma/client';

import { dashboardAffordances, dashboardDeleteBasis, dashboardPageAffordances, mayChangeDashboard, maySaveDashboard } from '@/app-layer/policies/analytics.policies';
import { resolveWidgetWindow, scopeAsListFilters, scopeFromView } from '@/lib/analytics/dashboard';
import { DEFAULT_DASHBOARD, defaultWidgetShape, defaultWidgetSize } from '@/lib/analytics/default-dashboard';
import { DASHBOARD_WIDGET_TYPES } from '@/lib/analytics/dashboard';
import { getPermissionsForRole } from '@/lib/permissions';
import { CreateDashboardSchema, DashboardWidgetInputSchema, parseStoredWidget, SetDashboardWidgetsSchema, UpdateDashboardSchema } from '@/lib/schemas/dashboard';

import { makeRequestContext } from '../../helpers/make-context';

const ctx = (role: Role, userId = 'me', appPermissions = getPermissionsForRole(role)) => makeRequestContext(role, { userId, appPermissions });
const own = { createdByUserId: 'me', visibility: 'PERSONAL' as const };
const ownShared = { createdByUserId: 'me', visibility: 'SHARED' as const };
const othersShared = { createdByUserId: 'someone', visibility: 'SHARED' as const };

describe('dashboard policies (decisions 326 and 329)', () => {
    it('every analytics.view holder keeps personal dashboards; analytics.share holders shared ones; a guest nothing', () => {
        for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as Role[]) expect(maySaveDashboard(ctx(role), 'PERSONAL')).toBe(true);
        for (const role of ['OWNER', 'ADMIN', 'MEMBER'] as Role[]) expect(maySaveDashboard(ctx(role), 'SHARED')).toBe(true);
        expect(maySaveDashboard(ctx('VIEWER'), 'SHARED')).toBe(false);
        expect(maySaveDashboard(ctx('GUEST'), 'PERSONAL')).toBe(false);
        expect(dashboardPageAffordances(ctx('VIEWER'))).toEqual({ createPersonal: true, createShared: false });
        expect(dashboardPageAffordances(ctx('GUEST'))).toEqual({ createPersonal: false, createShared: false });
    });

    it('only the creator changes a dashboard, holding analytics.share for a shared one', () => {
        expect(mayChangeDashboard(ctx('MEMBER'), own)).toBe(true);
        expect(mayChangeDashboard(ctx('MEMBER'), ownShared)).toBe(true);
        expect(mayChangeDashboard(ctx('OWNER'), othersShared)).toBe(false);
        expect(mayChangeDashboard(ctx('VIEWER'), own)).toBe(true);
        expect(mayChangeDashboard(ctx('VIEWER'), own, 'SHARED')).toBe(false);
        expect(mayChangeDashboard(ctx('VIEWER'), ownShared)).toBe(false);
    });

    it('an Owner or Admin deletes another person\'s shared dashboard as moderation; a Member never', () => {
        expect(dashboardDeleteBasis(ctx('OWNER'), othersShared)).toBe('moderation');
        expect(dashboardDeleteBasis(ctx('ADMIN'), othersShared)).toBe('moderation');
        expect(dashboardDeleteBasis(ctx('MEMBER'), othersShared)).toBeNull();
        expect(dashboardDeleteBasis(ctx('MEMBER'), own)).toBe('creator');
        expect(dashboardAffordances(ctx('ADMIN'), othersShared)).toEqual({ change: false, delete: true, share: true });
    });

    it('the granular keys decide: a custom role without analytics.share keeps personal dashboards only; without analytics.view, nothing', () => {
        const base = getPermissionsForRole('MEMBER');
        const noShare = { ...base, analytics: { ...base.analytics, share: false } };
        expect(maySaveDashboard(ctx('MEMBER', 'me', noShare), 'SHARED')).toBe(false);
        expect(mayChangeDashboard(ctx('MEMBER', 'me', noShare), ownShared)).toBe(false);
        expect(maySaveDashboard(ctx('MEMBER', 'me', noShare), 'PERSONAL')).toBe(true);
        const noView = { ...base, analytics: { ...base.analytics, view: false } };
        expect(maySaveDashboard(ctx('MEMBER', 'me', noView), 'PERSONAL')).toBe(false);
        expect(dashboardDeleteBasis(ctx('MEMBER', 'me', noView), own)).toBeNull();
    });
});

describe('the widget schema (inflect\'s bounds and union)', () => {
    const counts = { type: 'COUNTS', config: { scope: { filters: {} }, window: { kind: 'weeks', weeks: 12 } }, position: { x: 0, y: 0 }, size: { w: 12, h: 3 } };

    it('takes each type with its own configuration and refuses another type\'s', () => {
        for (const type of DASHBOARD_WIDGET_TYPES) {
            const input = { ...defaultWidgetShape(type), position: { x: 0, y: 0 }, size: defaultWidgetSize(type) };
            expect(DashboardWidgetInputSchema.safeParse(input).success).toBe(true);
        }
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, config: { ...counts.config, bin: 'week' } }).success).toBe(false);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, type: 'BURN_UP' }).success).toBe(false);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, type: 'VELOCITY' }).success).toBe(false);
    });

    it('holds the grid bounds, the windows and the scope', () => {
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, position: { x: 48, y: 0 } }).success).toBe(false);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, size: { w: 13, h: 3 } }).success).toBe(false);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, size: { w: 1, h: 25 } }).success).toBe(false);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, config: { ...counts.config, window: { kind: 'weeks', weeks: 10 } } }).success).toBe(false);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, config: { ...counts.config, window: { kind: 'cycle', teamId: 't1' } } }).success).toBe(true);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, config: { ...counts.config, scope: { filters: { labelId: ['a'] }, q: 'x' } } }).success).toBe(true);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, config: { ...counts.config, scope: { filters: { 'cf.f1': ['a'] } } } }).success).toBe(false);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, config: { ...counts.config, scope: { filters: { ownerId: ['a'] } } } }).success).toBe(false);
        expect(DashboardWidgetInputSchema.safeParse({ ...counts, title: 'x'.repeat(121) }).success).toBe(false);
    });

    it('reads a stored configuration that no longer parses as null', () => {
        expect(parseStoredWidget('COUNTS', counts.config)).toEqual({ type: 'COUNTS', config: counts.config });
        expect(parseStoredWidget('BURN_UP', { measure: 'velocity' })).toBeNull();
    });

    it('takes a name of 1 to 80 characters, and refuses a change that changes nothing', () => {
        expect(CreateDashboardSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
        expect(CreateDashboardSchema.parse({ name: 'Mine' }).visibility).toBe('PERSONAL');
        expect(UpdateDashboardSchema.safeParse({}).success).toBe(false);
        expect(SetDashboardWidgetsSchema.safeParse({ widgets: [counts] }).success).toBe(true);
    });
});

describe('the default composition (decision 326)', () => {
    it('is 3.6a\'s and 3.6b\'s charts, each fitting its schema and the grid, none overlapping', () => {
        expect(DEFAULT_DASHBOARD.widgets.map((w) => w.type)).toEqual(['COUNTS', 'THROUGHPUT', 'CYCLE_TIME', 'LEAD_TIME', 'CUMULATIVE_FLOW', 'BURN_UP', 'TIME_WAITING']);
        for (const w of DEFAULT_DASHBOARD.widgets) {
            expect(DashboardWidgetInputSchema.safeParse({ ...w.shape, title: w.title, position: w.position, size: w.size }).success).toBe(true);
            expect(w.position.x + w.size.w).toBeLessThanOrEqual(12);
        }
        const cells = new Set<string>();
        for (const w of DEFAULT_DASHBOARD.widgets) {
            for (let x = w.position.x; x < w.position.x + w.size.w; x++) {
                for (let y = w.position.y; y < w.position.y + w.size.h; y++) {
                    const key = `${x}:${y}`;
                    expect(cells.has(key)).toBe(false);
                    cells.add(key);
                }
            }
        }
    });
});

describe('scopes and windows', () => {
    it('a scope is the list\'s filters, comma-joined, the search kept', () => {
        expect(scopeAsListFilters({ filters: { labelId: ['a', 'b'], projectId: [] }, q: ' bug ' })).toEqual({ labelId: 'a,b', q: 'bug' });
    });

    it('starting from a view copies its built-in filters once and names what it leaves out', () => {
        expect(scopeFromView({ filters: { labelId: ['a'], 'cf.f1': ['x'], stateCategory: ['DONE'] }, q: 'q' })).toEqual({ scope: { filters: { labelId: ['a'] }, q: 'q' }, leftOut: ['cf.f1', 'stateCategory'] });
    });

    it('a window of weeks ends today; a cycle window is the team\'s current cycle up to today, or nothing', () => {
        expect(resolveWidgetWindow({ kind: 'weeks', weeks: 4 }, '2026-11-27', [])).toEqual({ from: '2026-10-31', to: '2026-11-27' });
        const cycles = [
            { id: 'old', teamId: 't1', startsOn: '2026-11-02', endsOn: '2026-11-15', status: 'COMPLETED' },
            { id: 'now', teamId: 't1', startsOn: '2026-11-16', endsOn: '2026-11-29', status: 'CURRENT' },
        ];
        expect(resolveWidgetWindow({ kind: 'cycle', teamId: 't1' }, '2026-11-27', cycles)).toEqual({ from: '2026-11-16', to: '2026-11-27', cycleId: 'now' });
        expect(resolveWidgetWindow({ kind: 'cycle', teamId: 't2' }, '2026-11-27', cycles)).toBeNull();
    });
});
