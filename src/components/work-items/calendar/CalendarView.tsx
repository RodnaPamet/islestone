'use client';

/**
 * The Calendar layout (roadmap 3.3a; docs/porting/maps/3.3.md, "The calendar
 * view (3.3a)"; owner decisions 241 and 242) on the Work items, project,
 * cycle and milestone pages and in saved views.
 *
 *   - **One read**: `useWorkItemCalendar` with the list's filters and the
 *     month grid's window (`gridWindow`); a 422 asks to narrow the filter.
 *   - **The grid**: the ported `CalendarMonth`, items on their due dates,
 *     cycle bands and milestone and project due-date diamonds (each shown
 *     unless switched off, `calendar.showCycles` / `showMilestones` in a
 *     saved view), the scope's non-working days and holidays shaded.
 *   - **The day panel** (a table, the grid's accessible companion): every
 *     item due on the selected day, each opening its sheet and, where the
 *     person may move it, offering "Move to date…".
 *   - **Moving**: a dropped chip or "Move to date…" goes through
 *     `CalendarMove`, which opens 3.1c's "Change dates" (decision 241).
 *   - **The summary line** counts the window's items and the scope's undated
 *     ones, and names what the caller may not see (cycles, milestones).
 *
 * Written fresh for Islestone; inflect-compliance's `CalendarClient.tsx`
 * (5528464) supplied the pattern of the day side panel and the range that
 * follows the view (pattern only, no code copied).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { formatDateLong, formatMonthYear } from '@inflect/ui/lib/format-date';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DataTable, createColumns } from '@/components/ui/table';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { resolveFieldSet } from '@/lib/work-items/field-sets';
import type { CalendarItem } from '@/lib/work-items/calendar';
import type { TimelineRow } from '@/lib/work-items/timeline';

import type { WorkItemListFilters } from '../data/list-filters';
import { useWorkConfig } from '../data/use-work-config';
import { useWorkItemCalendar } from '../data/use-work-item-calendar';
import { formatDay } from '../timeline/TimelineScheduleTable';
import { CalendarMonth } from './CalendarMonth';
import { CalendarMove, type CalendarMoveRequest } from './CalendarMove';
import { addMonths, cyclesByDay, dayKind, gridWindow, itemsByDay, markersByDay, monthOf, movableItems, type CalendarMarker } from './calendar-model';

export interface CalendarSettings {
    showCycles: boolean;
    showMilestones: boolean;
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = { showCycles: true, showMilestones: true };

export interface CalendarViewProps {
    filters: WorkItemListFilters;
    settings: CalendarSettings;
    onSettingsChange: (settings: CalendarSettings) => void;
    onOpen: (id: string) => void;
    /** The caller edits work items (the client permissions the board reads). */
    canEdit: boolean;
    /** The month to open on: today's when not given. */
    initialMonth?: Date;
}

function DayPanel({
    ymd,
    items,
    movable,
    projectName,
    onOpen,
    onMove,
    onClose,
}: {
    ymd: string;
    items: readonly CalendarItem[];
    movable: ReadonlySet<string>;
    projectName: (id: string) => string;
    onOpen: (id: string) => void;
    onMove: (item: CalendarItem) => void;
    onClose: () => void;
}) {
    const tPanel = useTranslations('workItems.calendar.day');
    const tCategory = useTranslations('workItems');
    const columns = useMemo(
        () =>
            createColumns<CalendarItem>([
                { id: 'key', header: tPanel('col.key'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span> },
                { id: 'title', header: tPanel('col.title'), cell: ({ row }) => row.original.title },
                { id: 'state', header: tPanel('col.state'), cell: ({ row }) => tCategory(`category.${row.original.stateCategory}`) },
                { id: 'project', header: tPanel('col.project'), cell: ({ row }) => projectName(row.original.projectId) },
                { id: 'start', header: tPanel('col.start'), cell: ({ row }) => formatDay(row.original.startDate) },
                {
                    id: 'actions',
                    header: tPanel('col.actions'),
                    cell: ({ row }) => {
                        const item = row.original;
                        if (!movable.has(item.id)) return null;
                        // A button inside a clickable row: its click and keys are its own.
                        return (
                            <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                <Button type="button" variant="secondary" size="sm" text={tPanel('move')} aria-label={tPanel('moveLabel', { key: item.key })} onClick={() => onMove(item)} />
                            </span>
                        );
                    },
                },
            ]),
        [tPanel, tCategory, projectName, movable, onMove],
    );
    const heading = tPanel('heading', { date: formatDateLong(`${ymd}T00:00:00.000Z`) });
    return (
        <section aria-labelledby="calendar-day-heading" className="flex min-h-0 flex-col gap-compact lg:w-[28rem]" data-testid="calendar-day-panel">
            <div className="flex items-center justify-between gap-tight">
                <h2 id="calendar-day-heading" className="text-sm font-semibold text-content-emphasis">
                    {heading}
                </h2>
                <Button type="button" variant="ghost" size="sm" text={tPanel('close')} onClick={onClose} />
            </div>
            <DataTable<CalendarItem>
                data={items as CalendarItem[]}
                columns={columns}
                getRowId={(r) => r.id}
                onRowClick={(row) => onOpen(row.original.id)}
                selectionEnabled={false}
                emptyState={tPanel('empty')}
                resourceName={(plural) => (plural ? tPanel('resourcePlural') : tPanel('resource'))}
                data-testid="calendar-day-table"
            />
        </section>
    );
}

export function CalendarView({ filters, settings, onSettingsChange, onOpen, canEdit, initialMonth }: CalendarViewProps) {
    const tView = useTranslations('workItems.calendar');
    const config = useWorkConfig();
    const href = useTenantHref();
    const [month, setMonth] = useState<Date>(() => initialMonth ?? monthOf(new Date().toISOString().slice(0, 10)));
    const range = useMemo(() => gridWindow(month), [month]);
    const calendar = useWorkItemCalendar(filters, range);
    const data = calendar.data;
    const [selected, setSelected] = useState<string | null>(null);
    const [moving, setMoving] = useState<CalendarMoveRequest | null>(null);

    // A type's start and due date rules (2.4b-b: built-in rules are the type's across the workspace).
    const hiddenDates = useMemo(() => {
        const of = (typeId: string) => {
            const set = resolveFieldSet(config.fieldSetEntries, typeId);
            return { startDate: set.builtIn.startDate === 'HIDDEN', dueDate: set.builtIn.dueDate === 'HIDDEN' };
        };
        const byType = new Map((config.types ?? []).map((t) => [t.id, of(t.id)] as const));
        return (row: TimelineRow) => byType.get(row.typeId) ?? of(row.typeId);
    }, [config.fieldSetEntries, config.types]);

    const movable = useMemo(() => (data ? movableItems(data, { canEdit, hiddenDates }) : new Set<string>()), [data, canEdit, hiddenDates]);
    const byDay = useMemo(() => (data ? itemsByDay(data.items, range) : new Map<string, CalendarItem[]>()), [data, range]);
    const bands = useMemo(() => (data && settings.showCycles ? cyclesByDay(data.cycles, range) : new Map()), [data, settings.showCycles, range]);
    const markers = useMemo(() => (data && settings.showMilestones ? markersByDay(data.milestones, data.projects, range) : new Map()), [data, settings.showMilestones, range]);
    const kindOf = useCallback((ymd: string) => (data ? dayKind(ymd, data.calendar) : null), [data]);
    const itemById = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data]);
    const projectName = useCallback((id: string) => data?.projects.find((p) => p.id === id)?.name ?? '', [data]);
    const markerHref = useCallback(
        (m: CalendarMarker) => (m.milestoneId ? href(`/projects/${encodeURIComponent(m.keyPrefix)}/milestones/${encodeURIComponent(m.milestoneId)}`) : href(`/projects/${encodeURIComponent(m.keyPrefix)}`)),
        [href],
    );
    const shownCount = useMemo(() => [...byDay.values()].reduce((n, list) => n + list.length, 0), [byDay]);

    const openDrop = useCallback(
        (id: string, ymd: string) => {
            const item = itemById.get(id);
            if (item && movable.has(id)) setMoving({ item, toDue: ymd });
        },
        [itemById, movable],
    );
    const requestMove = useCallback(
        (id: string) => {
            const item = itemById.get(id);
            if (item) setMoving({ item, toDue: null });
        },
        [itemById],
    );
    const go = (n: number) => {
        setSelected(null);
        setMonth((m) => addMonths(m, n));
    };
    const goToday = () => {
        setSelected(null);
        setMonth(monthOf(data?.asOf ?? new Date().toISOString().slice(0, 10)));
    };

    const controls = (
        <div className="flex flex-wrap items-center justify-between gap-default" data-testid="calendar-controls">
            <div className="flex items-center gap-tight">
                <Button type="button" variant="secondary" size="sm" text={tView('previous')} aria-label={tView('previousLabel')} onClick={() => go(-1)} />
                <Button type="button" variant="secondary" size="sm" text={tView('today')} onClick={goToday} />
                <Button type="button" variant="secondary" size="sm" text={tView('next')} aria-label={tView('nextLabel')} onClick={() => go(1)} />
                <h2 id="calendar-heading" className="ml-tight text-base font-semibold text-content-emphasis" aria-live="polite">
                    {formatMonthYear(month)}
                </h2>
            </div>
            <div className="flex flex-wrap items-center gap-default">
                <div className="flex items-center gap-tight">
                    <Switch id="calendar-show-cycles" checked={settings.showCycles} onCheckedChange={(showCycles) => onSettingsChange({ ...settings, showCycles })} />
                    <Label htmlFor="calendar-show-cycles">{tView('showCycles')}</Label>
                </div>
                <div className="flex items-center gap-tight">
                    <Switch id="calendar-show-milestones" checked={settings.showMilestones} onCheckedChange={(showMilestones) => onSettingsChange({ ...settings, showMilestones })} />
                    <Label htmlFor="calendar-show-milestones">{tView('showMilestones')}</Label>
                </div>
            </div>
        </div>
    );

    let body: React.ReactNode;
    if (calendar.tooLarge) {
        body = (
            <InlineNotice variant="warning">
                <span data-testid="calendar-too-large">{tView('tooLarge', { count: calendar.tooLarge.count, limit: calendar.tooLarge.limit })}</span>
            </InlineNotice>
        );
    } else if (calendar.error) {
        body = (
            <InlineNotice variant="error">
                {tView('loadFailed')} <Button variant="secondary" size="sm" text={tView('retry')} onClick={calendar.revalidate} />
            </InlineNotice>
        );
    } else {
        body = (
            <div className="flex min-h-0 flex-col gap-section lg:flex-row">
                <div className="min-w-0 flex-1" aria-busy={!data}>
                    <CalendarMonth
                        month={month}
                        todayYmd={data?.asOf ?? ''}
                        items={byDay}
                        cycles={bands}
                        markers={markers}
                        dayKind={kindOf}
                        selectedYmd={selected}
                        onSelectDate={setSelected}
                        onOpenItem={onOpen}
                        movable={movable}
                        onMoveRequest={requestMove}
                        onDropItem={openDrop}
                        markerHref={markerHref}
                    />
                </div>
                {selected && (
                    <DayPanel
                        ymd={selected}
                        items={byDay.get(selected) ?? []}
                        movable={movable}
                        projectName={projectName}
                        onOpen={onOpen}
                        onMove={(item) => setMoving({ item, toDue: null })}
                        onClose={() => setSelected(null)}
                    />
                )}
            </div>
        );
    }

    return (
        <section aria-labelledby="calendar-heading" className="flex h-full min-h-0 flex-col gap-compact overflow-y-auto" data-testid="calendar-view">
            {controls}
            {data && (
                <p className="text-sm text-content-muted" data-testid="calendar-summary">
                    <span>{tView('summary.shown', { count: shownCount })}</span>
                    {data.noDueDate > 0 && <span> · {tView('summary.noDueDate', { count: data.noDueDate })}</span>}
                    {data.omitted.map((o) => (
                        <span key={o}> · {tView(`summary.omitted.${o}`)}</span>
                    ))}
                    {data.truncated.map((o) => (
                        <span key={o}> · {tView(`summary.truncated.${o}`)}</span>
                    ))}
                </p>
            )}
            {data && (
                <ul aria-label={tView('legend.label')} className="flex flex-wrap gap-default text-xs text-content-muted">
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-[var(--brand-default)]" />
                        {tView('legend.today')}
                    </li>
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block h-3 w-3 border border-border-subtle bg-bg-subtle" />
                        {tView('legend.nonWorking')}
                    </li>
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block h-3 w-3 border border-border-subtle bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,var(--bg-muted)_3px,var(--bg-muted)_5px)]" />
                        {tView('legend.holiday')}
                    </li>
                    {settings.showCycles && (
                        <li className="flex items-center gap-tight">
                            <span aria-hidden className="inline-block h-2 w-5 rounded bg-brand-subtle" />
                            {tView('legend.cycle')}
                        </li>
                    )}
                    {settings.showMilestones && (
                        <li className="flex items-center gap-tight">
                            <span aria-hidden className="inline-block size-2 rotate-45 bg-[var(--content-brand)]" />
                            {tView('legend.milestone')}
                        </li>
                    )}
                    {settings.showMilestones && (
                        <li className="flex items-center gap-tight">
                            <span aria-hidden className="inline-block size-2 rotate-45 bg-[var(--content-emphasis)]" />
                            {tView('legend.projectDue')}
                        </li>
                    )}
                </ul>
            )}
            {body}
            {moving && (
                <CalendarMove
                    request={moving}
                    canEdit={canEdit}
                    hiddenDates={hiddenDates}
                    onDone={() => setMoving(null)}
                    onOpen={onOpen}
                    onPick={(ymd) => setMoving((m) => (m ? { ...m, toDue: ymd } : m))}
                />
            )}
        </section>
    );
}
