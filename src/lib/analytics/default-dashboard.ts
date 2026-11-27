/**
 * The default dashboard (sub-phase 3.6d; docs/porting/maps/3.6.md,
 * "Personal, shared and the default"; owner decision 326): a composition in
 * code, never a row, shown to anyone who has not opened another dashboard.
 * Its widgets are 3.6a's and 3.6b's charts, over the whole workspace and the
 * last twelve weeks: the counts, throughput, cycle time with age, lead time,
 * cumulative flow, the burn-up and time waiting. "Customise" saves a personal
 * copy of it.
 *
 * Pattern only, no code copied: inflect-compliance's
 * `src/app-layer/usecases/org-dashboard-presets.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (one default composition in code
 * and a way back to it). Written fresh for Islestone.
 */
import { DEFAULT_ANALYTICS_WINDOW_WEEKS } from './types';
import type { DashboardWidgetData, DefaultDashboardData, WidgetShape } from './dashboard';

const scope = { filters: {} };
const window = { kind: 'weeks' as const, weeks: DEFAULT_ANALYTICS_WINDOW_WEEKS };

function widget(id: string, shape: WidgetShape, x: number, y: number, w: number, h: number): DashboardWidgetData {
    return { id: `default-${id}`, type: shape.type, title: null, shape, position: { x, y }, size: { w, h } };
}

/** The twelve-column composition: the counts across the top, four charts in two rows, the burn-up and time waiting below. */
export const DEFAULT_DASHBOARD: DefaultDashboardData = {
    id: 'default',
    widgets: [
        widget('counts', { type: 'COUNTS', config: { scope, window } }, 0, 0, 12, 3),
        widget('throughput', { type: 'THROUGHPUT', config: { scope, window, bin: 'week' } }, 0, 3, 6, 6),
        widget('cycle-time', { type: 'CYCLE_TIME', config: { scope, window } }, 6, 3, 6, 6),
        widget('lead-time', { type: 'LEAD_TIME', config: { scope, window } }, 0, 9, 6, 6),
        widget('flow', { type: 'CUMULATIVE_FLOW', config: { scope, window } }, 6, 9, 6, 6),
        widget('burn-up', { type: 'BURN_UP', config: { scope, window, measure: 'items' } }, 0, 15, 12, 7),
        widget('time-waiting', { type: 'TIME_WAITING', config: { scope, window } }, 0, 22, 12, 8),
    ],
};

/** The widgets of a new dashboard of each type, as "Add widget" places them (the grid packs them upwards). */
export function defaultWidgetShape(type: WidgetShape['type']): WidgetShape {
    switch (type) {
        case 'THROUGHPUT':
            return { type, config: { scope, window, bin: 'week' } };
        case 'BURN_UP':
            return { type, config: { scope, window, measure: 'items' } };
        case 'FORECAST':
            return { type, config: { scope } };
        default:
            return { type, config: { scope, window } };
    }
}

/** A new widget's size by type: figures are short, charts taller. */
export function defaultWidgetSize(type: WidgetShape['type']): { w: number; h: number } {
    switch (type) {
        case 'COUNTS':
            return { w: 12, h: 3 };
        case 'FORECAST':
            return { w: 6, h: 5 };
        case 'BURN_UP':
            return { w: 12, h: 7 };
        case 'TIME_WAITING':
            return { w: 12, h: 8 };
        default:
            return { w: 6, h: 6 };
    }
}
