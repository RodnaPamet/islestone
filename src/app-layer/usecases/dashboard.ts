/**
 * Dashboards (sub-phase 3.6d; docs/porting/maps/3.6.md, "Dashboards (3.6d)",
 * "Reads, routes and keys"; ADR 0014 §6; owner decisions 326 to 329).
 *
 *   - **Who** (decision 326, `analytics.policies.ts`): every holder of
 *     `analytics.view` keeps personal dashboards, Viewers included; shared
 *     ones are made, kept shared and changed by holders of `analytics.share`,
 *     and only by their creator; an Owner or Admin may delete someone else's
 *     shared dashboard (`DASHBOARD_MODERATED`) and never changes it. Another
 *     person's personal dashboard is a 404. A refusal decided here, past the
 *     route's key, writes the `AUTHZ_DENIED` entry a `requirePermission`
 *     denial writes.
 *   - **The default** is a composition in code (`DEFAULT_DASHBOARD`), never a
 *     row; the list describes it.
 *   - **Widgets** are parsed by `src/lib/schemas/dashboard.ts` on every write
 *     and every read: a stored configuration that no longer parses reads as
 *     `shape: null` and never fails the dashboard. A layout write replaces
 *     the whole list in one transaction on the version the caller read
 *     (`If-Match` required, 409 `VERSION_CONFLICT` with the server's
 *     dashboard), at most 24 widgets (400 `DASHBOARD_TOO_LARGE`); a person
 *     keeps at most 50 dashboards (409 `DASHBOARD_LIMIT`).
 *   - **What a widget shows is read later, by the viewer**: nothing here
 *     reads a measure; each widget's analytics read runs under the viewer's
 *     own visibility and keys (decision 328), so a shared dashboard can show
 *     different figures to different people.
 *   - **Audit**: `DASHBOARD_CREATED`, `_UPDATED`, `_WIDGETS_SET` (counts and
 *     types, never a filter's values, which can hold a person's id),
 *     `_DELETED`, `_MODERATED`. Names and titles are sanitised plaintext,
 *     like saved views'.
 *   - **A member's removal** deletes their personal dashboards in its
 *     transaction (`deletePersonalDashboardsOfRemovedMember`); a create locks
 *     the creator's membership `FOR KEY SHARE` first (decision 280's rule),
 *     so it never outlives the removal.
 *
 * Written fresh for Islestone.
 */
import type { Prisma } from '@prisma/client';

import { logEvent } from '../events/audit';
import { assertCanViewAnalytics, dashboardAffordances, dashboardDeleteBasis, mayChangeDashboard, maySaveDashboard } from '../policies/analytics.policies';
import { DASHBOARD_LIST_CAP, DashboardRepository, type DashboardRow, type DashboardSummaryRow, type DashboardWidgetRow, type DashboardWidgetWrite } from '../repositories/DashboardRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import type { RequestContext } from '../types';
import { appendAuditEntryOrQueue } from '@/lib/audit';
import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { AppError, ConflictError, badRequest, forbidden, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import {
    DASHBOARD_LIMIT,
    DASHBOARD_LIMITS,
    DASHBOARD_TOO_LARGE,
    type DashboardData,
    type DashboardListResponse,
    type DashboardSummary,
    type DashboardVisibilityName,
    type DashboardWidgetData,
    type WidgetShape,
} from '@/lib/analytics/dashboard';
import { DEFAULT_DASHBOARD } from '@/lib/analytics/default-dashboard';
import { DashboardWidgetInputSchema, parseStoredWidget, type DashboardWidgetInput } from '@/lib/schemas/dashboard';

// ─── Shapes ─────────────────────────────────────────────────────────

export function toWidgetData(row: DashboardWidgetRow): DashboardWidgetData {
    const shape = parseStoredWidget(row.type, row.configJson);
    return {
        id: row.id,
        type: row.type,
        title: row.title,
        // A configuration that no longer parses reads as null: the widget says so, the rest shows.
        shape: (shape as WidgetShape | null) ?? null,
        position: { x: row.x, y: row.y },
        size: { w: row.w, h: row.h },
    };
}

function toSummary(row: DashboardSummaryRow, ctx: RequestContext, members: ReadonlySet<string>): DashboardSummary {
    return {
        id: row.id,
        name: row.name,
        visibility: row.visibility,
        version: row.version,
        mine: row.createdByUserId === ctx.userId,
        createdByFormerMember: !members.has(row.createdByUserId),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function toDashboardData(row: DashboardRow, ctx: RequestContext, members: ReadonlySet<string>): DashboardData {
    return {
        ...toSummary(row, ctx, members),
        widgets: row.widgets.map(toWidgetData),
        viewer: dashboardAffordances(ctx, row),
    };
}

async function readDashboard(db: PrismaTx, ctx: RequestContext, id: string): Promise<DashboardData> {
    const row = await DashboardRepository.getReadable(db, ctx, id);
    if (!row) throw notFound('Dashboard not found');
    const members = await MembershipRepository.memberUserIds(db, ctx, [row.createdByUserId]);
    return toDashboardData(row, ctx, members);
}

// ─── Input ──────────────────────────────────────────────────────────

function cleanName(raw: string): string {
    const name = sanitizePlainText(raw).replace(/[\r\n\t]+/g, ' ').trim();
    if (!name) throw badRequest('A dashboard needs a name.');
    return name.slice(0, DASHBOARD_LIMITS.nameLength);
}

function cleanTitle(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    const title = sanitizePlainText(raw).replace(/[\r\n\t]+/g, ' ').trim();
    return title ? title.slice(0, DASHBOARD_LIMITS.titleLength) : null;
}

/** A widget as stored: parsed again (a caller may skip the route), its title and search text sanitised. */
function widgetWrite(input: DashboardWidgetInput, keepId: boolean): DashboardWidgetWrite {
    const result = DashboardWidgetInputSchema.safeParse(input);
    if (!result.success) throw badRequest(result.error.issues[0]?.message ?? 'A widget does not fit its type.', { reason: 'WIDGET_INVALID' });
    const parsed = result.data;
    const config = { ...parsed.config, scope: { ...parsed.config.scope } };
    const q = config.scope.q ? sanitizePlainText(config.scope.q).trim() : '';
    if (q) config.scope.q = q;
    else delete config.scope.q;
    return {
        ...(keepId && parsed.id ? { id: parsed.id } : {}),
        type: parsed.type,
        title: cleanTitle(parsed.title),
        configJson: config as Prisma.InputJsonValue,
        x: parsed.position.x,
        y: parsed.position.y,
        w: parsed.size.w,
        h: parsed.size.h,
    };
}

function assertWidgetCount(count: number): void {
    if (count > DASHBOARD_LIMITS.widgets) {
        throw new AppError(`A dashboard holds at most ${DASHBOARD_LIMITS.widgets} widgets.`, DASHBOARD_TOO_LARGE, 400, true, { reason: DASHBOARD_TOO_LARGE, count, limit: DASHBOARD_LIMITS.widgets });
    }
}

/** What the audit names about widgets: how many, and of which types; never a scope's values. */
function widgetCounts(widgets: readonly { type: string }[]): { widgetCount: number; types: Record<string, number> } {
    const types: Record<string, number> = {};
    for (const w of widgets) types[w.type] = (types[w.type] ?? 0) + 1;
    return { widgetCount: widgets.length, types };
}

type DashboardRefusal =
    | 'DASHBOARD_SHARE_NOT_PERMITTED'
    | 'DASHBOARD_SAVE_NOT_PERMITTED'
    | 'DASHBOARD_CHANGE_CREATOR_ONLY'
    | 'DASHBOARD_CHANGE_NOT_PERMITTED'
    | 'DASHBOARD_DELETE_CREATOR_OR_ADMIN';

/**
 * A refusal decided here, after the route's key admitted the caller: the same
 * hash-chained `AUTHZ_DENIED` entry a `requirePermission` denial writes (in a
 * transaction of its own, so the request's rollback keeps it), then a 403.
 */
async function refuseDashboard(ctx: RequestContext, dashboardId: string, verb: 'save' | 'change' | 'delete', reason: DashboardRefusal, message: string): Promise<never> {
    await appendAuditEntryOrQueue({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.apiKeyId ? 'API_KEY' : 'USER',
        entity: 'Dashboard',
        entityId: dashboardId,
        action: 'AUTHZ_DENIED',
        details: `Dashboard ${verb} refused`,
        detailsJson: { category: 'access', event: 'authz_denied', reason, role: ctx.role },
        requestId: ctx.requestId,
        metadataJson: { role: ctx.role, verb },
    });
    throw forbidden(message, { reason });
}

async function throwConflict(db: PrismaTx, ctx: RequestContext, id: string): Promise<never> {
    const current = await DashboardRepository.getReadable(db, ctx, id);
    if (!current) throw notFound('Dashboard not found');
    const members = await MembershipRepository.memberUserIds(db, ctx, [current.createdByUserId]);
    throw new ConflictError('The dashboard changed since you read it.', { reason: 'VERSION_CONFLICT', version: current.version, dashboard: toDashboardData(current, ctx, members) });
}

// ─── Reads ──────────────────────────────────────────────────────────

/** The caller's own dashboards and every shared one, by name, and the default described. */
export async function listDashboards(ctx: RequestContext): Promise<DashboardListResponse> {
    assertCanViewAnalytics(ctx);
    return runInTenantContext(ctx, async (db) => {
        const rows = await DashboardRepository.list(db, ctx);
        const shown = rows.slice(0, DASHBOARD_LIST_CAP);
        const others = [...new Set(shown.filter((r) => r.createdByUserId !== ctx.userId).map((r) => r.createdByUserId))];
        const members = await MembershipRepository.memberUserIds(db, ctx, others);
        members.add(ctx.userId);
        return { dashboards: shown.map((r) => toSummary(r, ctx, members)), truncated: rows.length > DASHBOARD_LIST_CAP, default: DEFAULT_DASHBOARD };
    });
}

/** One dashboard the caller may see, with its widgets and what the caller may do with it; another person's personal one is a 404. */
export async function getDashboard(ctx: RequestContext, id: string): Promise<DashboardData> {
    assertCanViewAnalytics(ctx);
    return runInTenantContext(ctx, (db) => readDashboard(db, ctx, id));
}

// ─── Writes ─────────────────────────────────────────────────────────

export interface CreateDashboardInput {
    name: string;
    visibility: DashboardVisibilityName;
    widgets?: DashboardWidgetInput[];
}

export async function createDashboard(ctx: RequestContext, input: CreateDashboardInput): Promise<DashboardData> {
    assertCanViewAnalytics(ctx);
    if (!maySaveDashboard(ctx, input.visibility)) {
        await refuseDashboard(ctx, 'new', 'save', input.visibility === 'SHARED' ? 'DASHBOARD_SHARE_NOT_PERMITTED' : 'DASHBOARD_SAVE_NOT_PERMITTED', input.visibility === 'SHARED' ? 'You do not have permission to share dashboards.' : 'You do not have permission to save dashboards.');
    }
    const name = cleanName(input.name);
    const widgets = (input.widgets ?? []).map((w) => widgetWrite(w, false));
    assertWidgetCount(widgets.length);
    return runInTenantContext(ctx, async (db) => {
        // Decision 280's rule: the creator's membership first, so a removal in
        // flight either deletes what this writes or finds it never written.
        const active = await MembershipRepository.lockActiveUserIds(db, ctx, [ctx.userId]);
        if (!active.has(ctx.userId)) throw badRequest('Only an active member keeps dashboards.');
        if ((await DashboardRepository.countCreatedBy(db, ctx, ctx.userId)) >= DASHBOARD_LIMITS.perPerson) {
            throw new AppError(`A person keeps at most ${DASHBOARD_LIMITS.perPerson} dashboards.`, DASHBOARD_LIMIT, 409, true, { reason: DASHBOARD_LIMIT, limit: DASHBOARD_LIMITS.perPerson });
        }
        const created = await DashboardRepository.create(db, ctx, { name, visibility: input.visibility }, widgets);
        const id = created.id;
        await logEvent(db, ctx, {
            action: 'DASHBOARD_CREATED',
            entityType: 'Dashboard',
            entityId: id,
            details: `Saved ${input.visibility === 'SHARED' ? 'shared' : 'personal'} dashboard ${name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Dashboard', operation: 'created' },
            metadata: { visibility: input.visibility, ...widgetCounts(widgets) },
        });
        // Its creator is the caller, an active member: answered as written, no read back.
        return toDashboardData(created, ctx, new Set([ctx.userId]));
    });
}

export interface UpdateDashboardInput {
    name?: string;
    visibility?: DashboardVisibilityName;
}

/** Rename, share or unshare: the creator only (`analytics.share` for a shared one); `If-Match` optional, checked when sent. */
export async function updateDashboard(ctx: RequestContext, id: string, input: UpdateDashboardInput, expectedVersion: number | undefined): Promise<DashboardData> {
    assertCanViewAnalytics(ctx);
    return runInTenantContext(ctx, async (db) => {
        const row = await DashboardRepository.getReadable(db, ctx, id);
        if (!row) throw notFound('Dashboard not found');
        if (!mayChangeDashboard(ctx, row, input.visibility)) {
            const own = row.createdByUserId === ctx.userId;
            await refuseDashboard(
                ctx,
                row.id,
                'change',
                own ? 'DASHBOARD_CHANGE_NOT_PERMITTED' : 'DASHBOARD_CHANGE_CREATOR_ONLY',
                own ? 'You do not have permission to share dashboards.' : 'Only the person who saved a dashboard can change it.',
            );
        }
        const data: { name?: string; visibility?: DashboardVisibilityName } = {};
        if (input.name !== undefined) data.name = cleanName(input.name);
        if (input.visibility !== undefined && input.visibility !== row.visibility) data.visibility = input.visibility;
        const changedFields = Object.keys(data);
        if (changedFields.length === 0) {
            if (expectedVersion !== undefined && expectedVersion !== row.version) await throwConflict(db, ctx, row.id);
            return readDashboard(db, ctx, row.id);
        }
        if (!(await DashboardRepository.updateVersioned(db, ctx, row.id, expectedVersion, data))) await throwConflict(db, ctx, row.id);
        await logEvent(db, ctx, {
            action: 'DASHBOARD_UPDATED',
            entityType: 'Dashboard',
            entityId: row.id,
            details: `Changed dashboard ${data.name ?? row.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Dashboard', operation: 'updated', changedFields },
            metadata: { visibility: data.visibility ?? row.visibility },
        });
        return readDashboard(db, ctx, row.id);
    });
}

/**
 * Replace a dashboard's widgets (a layout change, a widget added, changed or
 * removed): the creator only, on the version the caller read (`If-Match`
 * required by the route), the whole list in one transaction. A widget keeps
 * its id when it was already on this dashboard.
 */
export async function setDashboardWidgets(ctx: RequestContext, id: string, widgets: DashboardWidgetInput[], expectedVersion: number | undefined): Promise<DashboardData> {
    assertCanViewAnalytics(ctx);
    if (expectedVersion === undefined) {
        throw new AppError('Send the version you read in an If-Match header: a layout change must name it.', 'PRECONDITION_REQUIRED', 428);
    }
    assertWidgetCount(widgets.length);
    return runInTenantContext(ctx, async (db) => {
        const row = await DashboardRepository.getReadable(db, ctx, id);
        if (!row) throw notFound('Dashboard not found');
        if (!mayChangeDashboard(ctx, row)) {
            const own = row.createdByUserId === ctx.userId;
            await refuseDashboard(
                ctx,
                row.id,
                'change',
                own ? 'DASHBOARD_CHANGE_NOT_PERMITTED' : 'DASHBOARD_CHANGE_CREATOR_ONLY',
                own ? 'You do not have permission to change a shared dashboard.' : 'Only the person who saved a dashboard can change it.',
            );
        }
        const current = new Set(row.widgets.map((w) => w.id));
        const writes = widgets.map((w) => widgetWrite(w, w.id !== undefined && current.has(w.id)));
        const ids = writes.map((w) => w.id).filter((x): x is string => !!x);
        if (new Set(ids).size !== ids.length) throw badRequest('A widget appears twice.');
        // The version claims the row: a concurrent layout write waits, then finds it moved.
        if (!(await DashboardRepository.updateVersioned(db, ctx, row.id, expectedVersion, {}))) await throwConflict(db, ctx, row.id);
        const written = await DashboardRepository.replaceWidgets(db, ctx, row.id, writes);
        await logEvent(db, ctx, {
            action: 'DASHBOARD_WIDGETS_SET',
            entityType: 'Dashboard',
            entityId: row.id,
            details: `Set the widgets of dashboard ${row.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'DashboardWidget', operation: 'updated' },
            metadata: { visibility: row.visibility, ...widgetCounts(writes), previousWidgetCount: row.widgets.length },
        });
        // Only its creator changes it, so the caller, a member: answered as written, the version the claim left.
        return toDashboardData({ ...row, version: row.version + 1, updatedAt: new Date(), widgets: written }, ctx, new Set([ctx.userId]));
    });
}

/** Delete: the creator, or an Owner or Admin for someone else's shared dashboard (`DASHBOARD_MODERATED`). */
export async function deleteDashboard(ctx: RequestContext, id: string): Promise<{ deleted: true; moderated: boolean }> {
    assertCanViewAnalytics(ctx);
    return runInTenantContext(ctx, async (db) => {
        const row = await DashboardRepository.getReadable(db, ctx, id);
        if (!row) throw notFound('Dashboard not found');
        const basis = dashboardDeleteBasis(ctx, row);
        if (!basis) {
            await refuseDashboard(ctx, row.id, 'delete', 'DASHBOARD_DELETE_CREATOR_OR_ADMIN', 'Only the person who saved a dashboard, or an Owner or Admin for a shared one, can delete it.');
        }
        await DashboardRepository.delete(db, ctx, row.id);
        await logEvent(db, ctx, {
            action: basis === 'moderation' ? 'DASHBOARD_MODERATED' : 'DASHBOARD_DELETED',
            entityType: 'Dashboard',
            entityId: row.id,
            details: basis === 'moderation' ? `Removed a shared dashboard, ${row.name}, saved by another member` : `Deleted dashboard ${row.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Dashboard', operation: 'deleted' },
            metadata: { visibility: row.visibility, createdByUserId: row.createdByUserId, widgetCount: row.widgets.length },
        });
        return { deleted: true as const, moderated: basis === 'moderation' };
    });
}

/**
 * A removed member's personal dashboards (decision 280's rule), in
 * `removeTenantMember`'s transaction after the membership is locked; shared
 * ones keep their stamp and read "Created by a former member".
 */
export async function deletePersonalDashboardsOfRemovedMember(db: PrismaTx, ctx: RequestContext, membershipId: string, userId: string): Promise<number> {
    const deleted = await DashboardRepository.deletePersonalOf(db, ctx, userId);
    if (deleted > 0) {
        await logEvent(db, ctx, {
            action: 'DASHBOARDS_DELETED_ON_MEMBER_REMOVAL',
            entityType: 'TenantMembership',
            entityId: membershipId,
            details: `Deleted ${deleted} personal dashboard(s) of a member being removed`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Dashboard', operation: 'deleted' },
            metadata: { deletedCount: deleted },
        });
    }
    return deleted;
}
