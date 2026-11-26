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
 *   - **The widget never writes** (3.1c, decision 194). Every action that
 *     would change a task or a link is refused in `init` with
 *     `api.intercept(…, () => false)`; no toolbar, editor or context menu is
 *     rendered. For a caller who edits work items (`editable`) the widget is
 *     not `readonly`, so a bar can be dragged and a link drawn, but only
 *     Islestone acts on it: a dropped bar's `update-task` is read
 *     (`dropFromWidget`), refused, and handed to `onDateDrop`, which opens
 *     "Change dates"; the bars are then drawn again from the cached rows
 *     (the drag had moved the bar's pixels). A drawn end-to-start link's
 *     `add-link` goes to `onLinkDraw` ("ISL-1 blocks ISL-2?"); any other link
 *     type is refused (`onLinkRefused`); a link's delete button goes to
 *     `onLinkRemove` (the undo toast). A bar outside `draggableIds` (done,
 *     archived, a summary, a context row, a diamond) cannot be dragged
 *     (`drag-task` refused), and a link to or from one outside `linkableIds`
 *     is refused. Every relation and date still goes through the API.
 *   - **Islestone's own critical path** (decision 198): the bar's content is
 *     `taskTemplate`'s element carrying `data-critical`, `data-late`,
 *     `data-conflict` and `data-context`; critical links are one CSS rule
 *     per relation id (`[data-link-id=":<id>"]`, a cuid, checked), because
 *     the widget's own `wx-critical` is set only by PRO.
 *   - **Today and non-working days** are cell classes from `highlightTime`
 *     (the widget's markers are PRO).
 *
 * **Two row models, one widget** (3.2c, decision 216): the item timeline's
 * (`timeline-model.ts`) and the roadmap's (`roadmap-model.ts`: goals,
 * initiatives and projects as bars, due dates as diamonds). The roadmap
 * never edits (`editable` stays false, so the widget is `readonly` and every
 * changing action is still refused); it supplies its own grid columns
 * (`gridColumns`) and opens a record's timeline from `onSelect`.
 *
 * Loaded with `next/dynamic` (`ssr: false`) from `TimelineChart`, so the
 * widget's code ships only on a timeline or a roadmap.
 *
 * Written fresh for Islestone; SVAR's store was read for the action names
 * and DOM attributes (pattern only, no code copied; `PROVENANCE.md`).
 */
import '@svar-ui/react-gantt/style.css';
import '@svar-ui/react-grid/style.css';
import './timeline.css';

import { Gantt as TimelineWidget, Willow } from '@svar-ui/react-gantt';
import type { IApi, ITask } from '@svar-ui/react-gantt';
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';

import { useTheme } from '@/components/theme/ThemeProvider';

import { addOneDay, cellContainsDay, criticalLinkCss, dropFromWidget, epochDayOfLocal, localDate, toWidgetTask, type ChartLink, type ChartTask, type TimelineZoom, type WidgetDrop } from './timeline-model';

/** Every action that would change a task or a link and that Islestone never takes from the widget. */
export const REFUSED_ACTIONS = ['add-task', 'delete-task', 'copy-task', 'move-task', 'indent-task', 'split-task', 'update-link', 'show-editor', 'schedule-tasks', 'undo', 'redo'] as const;

/**
 * The actions Islestone reads and then refuses (3.1c): a drop (`update-task`),
 * a drag in progress (`drag-task`, refused for a bar that may not move), a
 * drawn link (`add-link`) and a link's removal (`delete-link`). The widget
 * applies none of them itself.
 */
export const READ_THEN_REFUSED_ACTIONS = ['update-task', 'drag-task', 'add-link', 'delete-link'] as const;

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
    /** The caller edits work items (3.1c): bars can be dragged and links drawn; otherwise the widget is `readonly`. */
    editable?: boolean;
    /** The items whose bars may be dragged (`editableRows().dates`). */
    draggableIds?: ReadonlySet<string>;
    /** The items a link may be drawn to or from (`editableRows().dependencies`). */
    linkableIds?: ReadonlySet<string>;
    /** A bar was dropped: open "Change dates" with what it asks. */
    onDateDrop?: (id: string, drop: WidgetDrop) => void;
    /** An end-to-start link was drawn: "ISL-1 blocks ISL-2?". */
    onLinkDraw?: (sourceId: string, targetId: string) => void;
    /** A link of another type was drawn, or between items it may not join. */
    onLinkRefused?: () => void;
    /** A link's delete button: remove the relation behind the undo toast. */
    onLinkRemove?: (linkId: string) => void;
    /**
     * The grid's columns beside the widget's own title column (the roadmap's
     * progress and health, 3.2c); omitted, the timeline's key and float.
     */
    gridColumns?: ReadonlyArray<GridColumn>;
    /** Any row was chosen, whatever its id (the roadmap opens a record's timeline, decision 217). */
    onSelect?: (id: string) => void;
}

/** One grid column the caller fills from its own rows (the widget's title column is always there). */
export interface GridColumn {
    id: string;
    header: string;
    width: number;
    /** Before the title column (the key), or after it. */
    before?: boolean;
    cell: (task: ChartTask) => string;
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
        cellWidth: 60,
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
        data-draggable={data.islDraggable ? 'true' : undefined}
        data-linkable={data.islLinkable ? 'true' : undefined}
    >
        {data.type === 'milestone' ? null : <span className="isl-timeline-bar-text">{String(data.text ?? '')}</span>}
    </div>
);

export default function SvarTimelineAdapter(props: TimelineAdapterProps) {
    const { tasks, links, criticalLinkIds, range, zoom, asOf, nonWorking, highlightRange, labels, floatLabel, editable = false } = props;
    // A refused drop leaves the bar where the drag put it: a new array draws every bar again from the cached rows.
    const [redraw, setRedraw] = useState(0);
    const widgetTasks = useMemo(() => {
        void redraw; // only asks for a fresh array
        return tasks.map((t) => ({
            ...toWidgetTask(t, floatLabel(t), labels.contextGroup),
            islDraggable: editable && Boolean(props.draggableIds?.has(t.id)),
            islLinkable: editable && Boolean(props.linkableIds?.has(t.id)),
            islCells: Object.fromEntries((props.gridColumns ?? []).map((c) => [c.id, c.cell(t)])),
        }));
    }, [tasks, floatLabel, labels.contextGroup, redraw, editable, props.draggableIds, props.linkableIds, props.gridColumns]);
    const widgetLinks = useMemo(() => links.map((l) => ({ id: l.id, source: l.source, target: l.target, type: 'e2s' as const, lag: 0 })), [links]);
    const asOfDay = useMemo(() => epochDayOfLocal(localDate(asOf)), [asOf]);
    const { cellWidth, scales } = ZOOM_SCALES[zoom];
    // The widget reads its grid colour from the theme once, when it mounts: a theme change remounts it.
    const { theme } = useTheme();

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

    const { gridColumns } = props;
    const columns = useMemo(() => {
        const title = { id: 'text', header: labels.title, width: 170, flexgrow: 1 };
        if (gridColumns) {
            const cell = (c: GridColumn) => ({
                id: `isl-${c.id}`,
                header: c.header,
                width: c.width,
                template: (_v: unknown, row: ITask) => String((row.islCells as Record<string, string> | undefined)?.[c.id] ?? ''),
            });
            return [...gridColumns.filter((c) => c.before).map(cell), title, ...gridColumns.filter((c) => !c.before).map(cell)];
        }
        return [
            { id: 'islKey', header: labels.key, width: 80, template: (_v: unknown, row: ITask) => String(row.islKey ?? '') },
            title,
            { id: 'islFloat', header: labels.float, width: 110, align: 'center' as const, template: (_v: unknown, row: ITask) => String(row.islFloat ?? '') },
        ];
    }, [labels.key, labels.title, labels.float, gridColumns]);

    // The widget calls `init` once: its handlers read the latest props through a ref.
    const latest = useRef(props);
    useEffect(() => {
        latest.current = props;
    });
    const init = useCallback((api: IApi) => {
        for (const action of REFUSED_ACTIONS) api.intercept(action, () => false);
        api.intercept('drag-task', (ev: { id?: unknown }) => {
            const p = latest.current;
            return Boolean(p.editable && typeof ev?.id === 'string' && p.draggableIds?.has(ev.id));
        });
        api.intercept('update-task', (ev: { id?: unknown; diff?: unknown; task?: unknown }) => {
            const p = latest.current;
            const id = typeof ev?.id === 'string' ? ev.id : null;
            const drop = dropFromWidget(ev);
            if (p.editable && id && drop && p.draggableIds?.has(id)) p.onDateDrop?.(id, drop);
            setRedraw((n) => n + 1);
            return false;
        });
        api.intercept('add-link', (ev: { link?: { source?: unknown; target?: unknown; type?: unknown } }) => {
            const p = latest.current;
            const { source, target, type } = ev?.link ?? {};
            const joinable = typeof source === 'string' && typeof target === 'string' && source !== target && p.linkableIds?.has(source) && p.linkableIds?.has(target);
            if (p.editable && joinable && type === 'e2s') p.onLinkDraw?.(source as string, target as string);
            else if (p.editable) p.onLinkRefused?.();
            return false;
        });
        api.intercept('delete-link', (ev: { id?: unknown }) => {
            const p = latest.current;
            if (p.editable && typeof ev?.id === 'string') p.onLinkRemove?.(ev.id);
            return false;
        });
        api.on('select-task', (ev: { id?: unknown }) => {
            const id = typeof ev?.id === 'string' ? ev.id : null;
            if (id) latest.current.onSelect?.(id);
            if (id && !id.includes(':') && id !== 'context-group') latest.current.onOpen(id);
        });
    }, []);

    return (
        <div className="isl-timeline" data-editable={editable ? 'true' : undefined}>
            <style>{criticalLinkCss(criticalLinkIds)}</style>
            <Willow key={theme} fonts={false}>
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
                    readonly={!editable}
                    columns={columns}
                    gridWidth={360}
                    highlightTime={highlightTime}
                    taskTemplate={BarContent}
                    init={init}
                />
            </Willow>
        </div>
    );
}
