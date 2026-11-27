/**
 * Dashboards and their widgets (sub-phase 3.6d; docs/porting/maps/3.6.md,
 * "Dashboards (3.6d)"; ADR 0014 §6). The only module with queries against
 * `Dashboard` and `DashboardWidget`.
 *
 * Every read carries the visibility rule in its own `where`: the caller's
 * own dashboards and every SHARED one (decision 326). A personal dashboard
 * is never read for anybody but its creator. Every write filters by
 * `tenantId`; a change of the name, the visibility or the widgets is a
 * conditional update on the version the caller read (`If-Match`).
 *
 * Written fresh for Islestone.
 */
import type { DashboardVisibility, DashboardWidgetType, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

/** Dashboards one list returns (one past it marks truncation). */
export const DASHBOARD_LIST_CAP = 200;
/** A dashboard holds at most 24 widgets; one read takes one past that. */
const WIDGET_READ_CAP = 25;

export const dashboardSummarySelect = {
    id: true,
    name: true,
    visibility: true,
    createdByUserId: true,
    version: true,
    updatedAt: true,
} satisfies Prisma.DashboardSelect;

export const dashboardWidgetSelect = {
    id: true,
    type: true,
    title: true,
    configJson: true,
    x: true,
    y: true,
    w: true,
    h: true,
} satisfies Prisma.DashboardWidgetSelect;

export type DashboardSummaryRow = Prisma.DashboardGetPayload<{ select: typeof dashboardSummarySelect }>;
export type DashboardWidgetRow = Prisma.DashboardWidgetGetPayload<{ select: typeof dashboardWidgetSelect }>;
export type DashboardRow = DashboardSummaryRow & { widgets: DashboardWidgetRow[] };

export interface DashboardWidgetWrite {
    id?: string;
    type: DashboardWidgetType;
    title: string | null;
    configJson: Prisma.InputJsonValue;
    x: number;
    y: number;
    w: number;
    h: number;
}

function readableWhere(ctx: RequestContext): Prisma.DashboardWhereInput {
    return { tenantId: ctx.tenantId, OR: [{ createdByUserId: ctx.userId }, { visibility: 'SHARED' }] };
}

export class DashboardRepository {
    /** The caller's own dashboards and every shared one, by name; one past the cap marks truncation. */
    static async list(db: PrismaTx, ctx: RequestContext): Promise<DashboardSummaryRow[]> {
        return db.dashboard.findMany({
            where: readableWhere(ctx),
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: DASHBOARD_LIST_CAP + 1,
            select: dashboardSummarySelect,
        });
    }

    /** One dashboard the caller may read, with its widgets in reading order, or null. */
    static async getReadable(db: PrismaTx, ctx: RequestContext, id: string): Promise<DashboardRow | null> {
        return db.dashboard.findFirst({
            where: { ...readableWhere(ctx), id },
            select: {
                ...dashboardSummarySelect,
                widgets: { where: { tenantId: ctx.tenantId }, orderBy: [{ y: 'asc' }, { x: 'asc' }, { id: 'asc' }], take: WIDGET_READ_CAP, select: dashboardWidgetSelect },
            },
        });
    }

    /**
     * Serialise one person's creates (the 50 a person's bound): a
     * transaction-scoped advisory lock on the workspace and the creator, taken
     * FIRST in the create's transaction, before the membership's `FOR KEY
     * SHARE` and the count, so two creates at once count one after the other.
     * Nothing else takes it (a member's removal locks the membership alone),
     * so the order advisory lock, then membership row never meets its reverse.
     */
    static async lockCreatesOf(db: PrismaTx, ctx: RequestContext, userId: string): Promise<void> {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dashboard-create:${ctx.tenantId}:${userId}`}))`;
    }

    /** The dashboards one person has created, personal and shared (the 50 a person's bound). */
    static async countCreatedBy(db: PrismaTx, ctx: RequestContext, userId: string): Promise<number> {
        return db.dashboard.count({ where: { tenantId: ctx.tenantId, createdByUserId: userId } });
    }

    /** A new dashboard and its widgets, answered as written (no read back). */
    static async create(db: PrismaTx, ctx: RequestContext, data: { name: string; visibility: DashboardVisibility }, widgets: readonly DashboardWidgetWrite[]): Promise<DashboardRow> {
        const row = await db.dashboard.create({ data: { tenantId: ctx.tenantId, createdByUserId: ctx.userId, ...data }, select: dashboardSummarySelect });
        return { ...row, widgets: await DashboardRepository.insertWidgets(db, ctx, row.id, widgets) };
    }

    /** Insert widgets and answer them as written, in reading order. */
    private static async insertWidgets(db: PrismaTx, ctx: RequestContext, dashboardId: string, widgets: readonly DashboardWidgetWrite[]): Promise<DashboardWidgetRow[]> {
        if (widgets.length === 0) return [];
        const rows = await db.dashboardWidget.createManyAndReturn({ data: widgets.map((w) => ({ ...w, tenantId: ctx.tenantId, dashboardId })), select: dashboardWidgetSelect });
        return rows.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    /**
     * Change the name or visibility, or only increase the version (a widget
     * list replaced), on the version the caller read when it names one:
     * `false` when the row moved or is gone.
     */
    static async updateVersioned(
        db: PrismaTx,
        ctx: RequestContext,
        id: string,
        expectedVersion: number | undefined,
        data: { name?: string; visibility?: DashboardVisibility },
    ): Promise<boolean> {
        const result = await db.dashboard.updateMany({
            where: { id, tenantId: ctx.tenantId, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
            data: { ...data, version: { increment: 1 } },
        });
        return result.count === 1;
    }

    /** Replace the widgets of a dashboard whose row this transaction has just updated (and so holds); answered as written. */
    static async replaceWidgets(db: PrismaTx, ctx: RequestContext, dashboardId: string, widgets: readonly DashboardWidgetWrite[]): Promise<DashboardWidgetRow[]> {
        await db.dashboardWidget.deleteMany({ where: { tenantId: ctx.tenantId, dashboardId } });
        return DashboardRepository.insertWidgets(db, ctx, dashboardId, widgets);
    }

    /** Delete one dashboard; its widgets go by their cascade. */
    static async delete(db: PrismaTx, ctx: RequestContext, id: string): Promise<number> {
        const result = await db.dashboard.deleteMany({ where: { id, tenantId: ctx.tenantId } });
        return result.count;
    }

    /** A removed member's personal dashboards, deleted in the removal's transaction (decision 280's rule); shared ones keep their stamp. */
    static async deletePersonalOf(db: PrismaTx, ctx: RequestContext, userId: string): Promise<number> {
        const result = await db.dashboard.deleteMany({ where: { tenantId: ctx.tenantId, createdByUserId: userId, visibility: 'PERSONAL' } });
        return result.count;
    }
}
