/**
 * Dashboards' request schemas and the shape of `DashboardWidget.configJson`
 * (sub-phase 3.6d; docs/porting/maps/3.6.md, "Dashboards (3.6d)"; ADR 0014
 * §6; owner decisions 326 to 328), parsed on every write and every read.
 * Client-safe: the picker validates with it too.
 *
 * Copied from inflect-compliance `src/app-layer/schemas/org-dashboard-widget.schemas.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1, Inflect Ltd.) and
 * adapted: the grid's bounds (x, y 0..47; w 1..12; h 1..24) and the
 * discriminated union on `type`, each variant locking its configuration, are
 * kept; inflect's org widget kinds, `chartType`, `enabled`, the PATCH-per-row
 * body and the DTO are replaced by Islestone's eight analytics types
 * (decision 327), each over a scope written as the list's filters (the
 * saved-view filter schema, decision 328) and a relative window, and one
 * body that replaces a dashboard's whole widget list.
 */
import { z } from 'zod';

import type { AnalyticsWindowWeeks } from '@/lib/analytics/types';
import { DASHBOARD_LIMITS } from '@/lib/analytics/dashboard';

import { SavedViewFiltersSchema } from './saved-view';

const Id = z.string().min(1).max(64);

// ─── Position / size (inflect's bounds) ─────────────────────────────

export const WidgetPositionSchema = z
    .object({
        x: z.number().int().min(0).max(47),
        y: z.number().int().min(0).max(47),
    })
    .strict();

export const WidgetSizeSchema = z
    .object({
        w: z.number().int().min(1).max(12),
        h: z.number().int().min(1).max(24),
    })
    .strict();

// ─── What a widget is over (decision 328) ───────────────────────────

/**
 * The widget's own copy of the list's filters: the saved-view filter schema
 * (decision 328), less custom-field conditions, which name one project's
 * fields and which the Analytics page cannot offer (as the Work items page
 * offers none). "Start from a view" copies a view's built-in filters once.
 */
export const WidgetScopeSchema = z
    .object({
        filters: SavedViewFiltersSchema.refine((r) => Object.keys(r).every((k) => !k.startsWith('cf.')), 'A widget cannot filter by a custom field.').default({}),
        /** The search text (sanitised on the server). */
        q: z.string().max(200).optional(),
    })
    .strict();

/** The last N weeks ending today, or the current cycle of a team (decision 328). */
export const WidgetWindowSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('weeks'),
            weeks: z.union([z.literal(4), z.literal(8), z.literal(12), z.literal(26), z.literal(52)]) satisfies z.ZodType<AnalyticsWindowWeeks>,
        })
        .strict(),
    z.object({ kind: z.literal('cycle'), teamId: Id }).strict(),
]);

const Windowed = { scope: WidgetScopeSchema, window: WidgetWindowSchema };

const CountsShape = z.object({ type: z.literal('COUNTS'), config: z.object(Windowed).strict() });
const ThroughputShape = z.object({ type: z.literal('THROUGHPUT'), config: z.object({ ...Windowed, bin: z.enum(['day', 'week']) }).strict() });
const CycleTimeShape = z.object({ type: z.literal('CYCLE_TIME'), config: z.object(Windowed).strict() });
const LeadTimeShape = z.object({ type: z.literal('LEAD_TIME'), config: z.object(Windowed).strict() });
const FlowShape = z.object({ type: z.literal('CUMULATIVE_FLOW'), config: z.object(Windowed).strict() });
const BurnUpShape = z.object({ type: z.literal('BURN_UP'), config: z.object({ ...Windowed, measure: z.enum(['items', 'points', 'hours']) }).strict() });
const ForecastShape = z.object({
    type: z.literal('FORECAST'),
    config: z
        .object({
            scope: WidgetScopeSchema,
            historyWeeks: z.union([z.literal(4), z.literal(8), z.literal(12), z.literal(26)]).optional(),
            share: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]).optional(),
            basedOn: z.enum(['projects', 'team', 'workspace']).optional(),
        })
        .strict(),
});
const TimeWaitingShape = z.object({ type: z.literal('TIME_WAITING'), config: z.object(Windowed).strict() });

/**
 * The widget's shape contract (inflect's union): discriminated on `type`,
 * each variant locking its configuration; anything else is refused.
 */
export const WidgetTypedShapeSchema = z.discriminatedUnion('type', [
    CountsShape,
    ThroughputShape,
    CycleTimeShape,
    LeadTimeShape,
    FlowShape,
    BurnUpShape,
    ForecastShape,
    TimeWaitingShape,
]);
export type WidgetTypedShape = z.infer<typeof WidgetTypedShapeSchema>;
export type WidgetConfigOf<T extends WidgetTypedShape['type']> = Extract<WidgetTypedShape, { type: T }>['config'];

/** One widget as a layout write sends it: its id when it is already on the dashboard, its shape, title and place. */
export const DashboardWidgetInputSchema = z.intersection(
    WidgetTypedShapeSchema,
    z
        .object({
            id: Id.optional(),
            title: z.string().trim().min(1).max(DASHBOARD_LIMITS.titleLength).nullable().optional(),
            position: WidgetPositionSchema,
            size: WidgetSizeSchema,
        })
        .strict(),
);
export type DashboardWidgetInput = z.infer<typeof DashboardWidgetInputSchema>;

/** The parser's own bound on a widget list; more than `DASHBOARD_LIMITS.widgets` is refused by the usecase (400 `DASHBOARD_TOO_LARGE`). */
const WIDGET_LIST_PARSE_CAP = 100;

const Name = z.string().trim().min(1).max(DASHBOARD_LIMITS.nameLength);
const Visibility = z.enum(['PERSONAL', 'SHARED']);

export const CreateDashboardSchema = z
    .object({
        name: Name,
        visibility: Visibility.default('PERSONAL'),
        widgets: z.array(DashboardWidgetInputSchema).max(WIDGET_LIST_PARSE_CAP).optional(),
    })
    .strict();

export const UpdateDashboardSchema = z
    .object({
        name: Name.optional(),
        visibility: Visibility.optional(),
    })
    .strict()
    .refine((b) => b.name !== undefined || b.visibility !== undefined, 'Nothing to change.');

export const SetDashboardWidgetsSchema = z
    .object({
        widgets: z.array(DashboardWidgetInputSchema).max(WIDGET_LIST_PARSE_CAP),
    })
    .strict();

/**
 * A stored widget's type and configuration, read back: `null` when it no
 * longer parses (a later schema), so one widget never fails a dashboard.
 */
export function parseStoredWidget(type: string, configJson: unknown): WidgetTypedShape | null {
    const parsed = WidgetTypedShapeSchema.safeParse({ type, config: configJson });
    return parsed.success ? parsed.data : null;
}
