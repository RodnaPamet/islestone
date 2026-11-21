'use client';

/**
 * The ONE file that imports the timeline widget (roadmap 3.1b; ADR 0010 §7;
 * owner decision 182): SVAR's widget (`@svar-ui/react-gantt` 2.8.3), MIT core
 * only. It maps the
 * view model's rows to the widget and keeps every editing path shut.
 * `tests/guards/svar-core-only.test.ts` holds this file to that: the only
 * `@svar-ui` imports in `src/` are here (the React package and the two
 * stylesheets below), the theme is given `fonts={false}`, and the widget is
 * given only the props named in its allowlist (no PRO option).
 *
 *   - **No third-party request.** `fonts={false}` keeps the theme from
 *     loading `cdn.svar.dev`'s icon font; the CSS is the two packages'
 *     plain stylesheets (`all.css` and `@svar-ui/react-core`'s stylesheet
 *     carry `@font-face` rules naming that CDN), and `timeline.css` maps the
 *     widget's variables to Islestone's tokens and draws its few icons.
 *   - **Read-only in 3.1b.** `readonly`, and every action that would change
 *     a task or a link refused in `init` with `api.intercept(…, () => false)`;
 *     no toolbar, editor or context menu is rendered.
 *   - **Islestone's own critical path** (decision 198): the bar's content is
 *     `taskTemplate`'s element carrying `data-critical`, `data-late`,
 *     `data-conflict` and `data-context`; critical links are one CSS rule
 *     per relation id (`[data-link-id=":<id>"]`, a cuid, checked), because
 *     the widget's own `wx-critical` is set only by PRO.
 *   - **Today and non-working days** are cell classes from `highlightTime`
 *     (the widget's markers are PRO).
 *
 * Loaded with `next/dynamic` (`ssr: false`) from `TimelineChart`, so the
 * widget's code ships only on a timeline.
 *
 * Written fresh for Islestone; SVAR's store was read for the action names
 * and DOM attributes (pattern only, no code copied; `PROVENANCE.md`).
 */
import '@svar-ui/react-gantt/style.css';
import '@svar-ui/react-grid/style.css';
import './timeline.css';

import { Gantt as TimelineWidget, Willow } from '@svar-ui/react-gantt';
import type { IApi, ITask } from '@svar-ui/react-gantt';
import { useCallback, useMemo, type FC } from 'react';

import { addOneDay, cellContainsDay, criticalLinkCss, epochDayOfLocal, localDate, toWidgetTask, type ChartLink, type ChartTask, type TimelineZoom } from './timeline-model';

/** Every action that would change a task or a link: refused while the timeline is read-only (3.1b). */
export const REFUSED_ACTIONS = [
    'add-task',
    'update-task',
    'delete-task',
    'copy-task',
    'move-task',
    'indent-task',
    'drag-task',
    'split-task',
    'add-link',
    'update-link',
    'delete-link',
    'show-editor',
    'schedule-tasks',
    'undo',
    'redo',
] as const;

export interface TimelineAdapterProps {
    tasks: readonly ChartTask[];
    links: readonly ChartLink[];
    criticalLinkIds: readonly string[];
    range: { start: string; end: string };
    zoom: TimelineZoom;
    /** Today, `YYYY-MM-DD`. */
    asOf: string;
    /** Days non-working on every calendar in view (epoch days). */
    nonWorking: ReadonlySet<number>;
    /** A cycle's days, shaded (`YYYY-MM-DD`, inclusive). */
    highlightRange?: { start: string; end: string };
    /** Column headers and the float cell's words, translated by the caller. */
    labels: { key: string; title: string; float: string; contextGroup: string };
    floatLabel: (task: ChartTask) => string;
    /** A bar or row of an item was chosen. */
    onOpen: (id: string) => void;
}

const ZOOM_SCALES: Record<TimelineZoom, { cellWidth: number; scales: Array<{ unit: string; step: number; format: (d: Date) => string }> }> = {
    day: {
        cellWidth: 34,
        scales: [
            { unit: 'month', step: 1, format: (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) },
            { unit: 'day', step: 1, format: (d) => String(d.getDate()) },
        ],
    },
    week: {
        cellWidth: 70,
        scales: [
            { unit: 'month', step: 1, format: (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) },
            { unit: 'week', step: 1, format: (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) },
        ],
    },
    month: {
        cellWidth: 110,
        scales: [
            { unit: 'year', step: 1, format: (d) => String(d.getFullYear()) },
            { unit: 'month', step: 1, format: (d) => d.toLocaleDateString(undefined, { month: 'short' }) },
        ],
    },
    quarter: {
        cellWidth: 140,
        scales: [
            { unit: 'year', step: 1, format: (d) => String(d.getFullYear()) },
            { unit: 'quarter', step: 1, format: (d) => `Q${Math.floor(d.getMonth() / 3) + 1}` },
        ],
    },
};

/** The bar's content: a full-size element the stylesheet colours by its data attributes. */
const BarContent: FC<{ data: ITask }> = ({ data }) => (
    <div
        className="isl-timeline-bar"
        data-critical={data.islCritical ? 'true' : undefined}
        data-late={data.islLate ? 'true' : undefined}
        data-conflict={data.islConflict ? 'true' : undefined}
        data-context={data.islContext ? 'true' : undefined}
        data-done={data.islDone ? 'true' : undefined}
        data-kind={String(data.islKind ?? '')}
    >
        {data.type === 'milestone' ? null : <span className="isl-timeline-bar-text">{String(data.text ?? '')}</span>}
    </div>
);

export default function SvarTimelineAdapter(props: TimelineAdapterProps) {
    const { tasks, links, criticalLinkIds, range, zoom, asOf, nonWorking, highlightRange, labels, floatLabel, onOpen } = props;
    const widgetTasks = useMemo(() => tasks.map((t) => toWidgetTask(t, floatLabel(t), labels.contextGroup)), [tasks, floatLabel, labels.contextGroup]);
    const widgetLinks = useMemo(() => links.map((l) => ({ id: l.id, source: l.source, target: l.target, type: 'e2s' as const, lag: 0 })), [links]);
    const asOfDay = useMemo(() => epochDayOfLocal(localDate(asOf)), [asOf]);
    const { cellWidth, scales } = ZOOM_SCALES[zoom];

    const highlightTime = useCallback(
        (date: Date, unit: string) => {
            const classes: string[] = [];
            if (cellContainsDay(date, unit, asOfDay)) classes.push('isl-timeline-today');
            if (unit === 'day' && nonWorking.has(epochDayOfLocal(date))) classes.push('isl-timeline-nonworking');
            if (highlightRange && unit === 'day') {
                const day = epochDayOfLocal(date);
                if (day >= epochDayOfLocal(localDate(highlightRange.start)) && day <= epochDayOfLocal(localDate(highlightRange.end))) classes.push('isl-timeline-cycle');
            }
            return classes.join(' ');
        },
        [asOfDay, nonWorking, highlightRange],
    );

    const columns = useMemo(
        () => [
            { id: 'islKey', header: labels.key, width: 90, template: (_v: unknown, row: ITask) => String(row.islKey ?? '') },
            { id: 'text', header: labels.title, width: 220, flexgrow: 1 },
            { id: 'islFloat', header: labels.float, width: 110, align: 'center' as const, template: (_v: unknown, row: ITask) => String(row.islFloat ?? '') },
        ],
        [labels.key, labels.title, labels.float],
    );

    const init = useCallback(
        (api: IApi) => {
            for (const action of REFUSED_ACTIONS) api.intercept(action, () => false);
            api.on('select-task', (ev: { id?: unknown }) => {
                const id = typeof ev?.id === 'string' ? ev.id : null;
                if (id && !id.includes(':') && id !== 'context-group') onOpen(id);
            });
        },
        [onOpen],
    );

    return (
        <div className="isl-timeline">
            <style>{criticalLinkCss(criticalLinkIds)}</style>
            <Willow fonts={false}>
                <TimelineWidget
                    tasks={widgetTasks}
                    links={widgetLinks}
                    scales={scales}
                    start={localDate(range.start)}
                    end={addOneDay(localDate(range.end))}
                    cellWidth={cellWidth}
                    cellHeight={34}
                    scaleHeight={30}
                    lengthUnit="day"
                    durationUnit="day"
                    inclusiveEnd
                    autoScale={false}
                    zoom={false}
                    readonly
                    columns={columns}
                    gridWidth={420}
                    highlightTime={highlightTime}
                    taskTemplate={BarContent}
                    init={init}
                />
            </Willow>
        </div>
    );
}
