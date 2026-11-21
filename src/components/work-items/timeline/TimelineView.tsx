'use client';

/**
 * The timeline layout (roadmap 3.1b and 3.1c; ADR 0010; owner decisions 184
 * to 203). One read (`useWorkItemTimeline`, the list's filters), one view
 * model (`buildTimelineModel`), shown as the chart or the schedule table
 * (decision 203, remembered per viewer), with the "No dates" list beside the
 * chart (decision 185), the summary line ("Finishes on …", the critical
 * path, late items, the project's due date: decision 188) and what was left
 * out said in words (a scope over 5,000 items, relations to items the caller
 * cannot see). Never an invented number: with no dated open item it says
 * "Add dates to see the critical path".
 *
 * Changes (3.1c, decisions 194, 195 and 203): for a caller who edits work
 * items (`canEdit`, the client permissions the board reads too), a dropped
 * bar, a row's "Change dates" in the table or "Set dates" in the "No dates"
 * list opens `ChangeDatesDialog`; a drawn link opens "ISL-1 blocks ISL-2?"
 * and a link's delete goes through the undo toast; a row's "Dependencies"
 * in the table adds and removes them by keyboard. Which rows may change is
 * `editableRows`, read from the rows and the field sets the server sent
 * (`useWorkConfig().fieldSetEntries`); every write is the API's
 * (`useTimelineWrites`).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { Label } from '@/components/ui/label';

import { useToast } from '@/components/ui/hooks';
import { compileCalendar, toEpochDay } from '@/app-layer/domain/schedule/calendar';
import { ApiClientError } from '@/lib/data/api-client';
import { resolveFieldSet } from '@/lib/work-items/field-sets';
import { proposeDates, type ItemDates } from '@/lib/work-items/reschedule';
import type { TimelineRow } from '@/lib/work-items/timeline';

import type { WorkItemListFilters } from '../data/list-filters';
import { useTimelineWrites } from '../data/use-timeline-writes';
import { useWorkConfig } from '../data/use-work-config';
import { useWorkItemTimeline } from '../data/use-work-item-timeline';
import { ChangeDatesDialog, type ChangeDatesConfirm } from './ChangeDatesDialog';
import { TimelineChart } from './TimelineChart';
import { AddDependencyDialog, DependenciesDialog } from './TimelineDependencies';
import { TimelineScheduleTable, formatDay, type ScheduleTableActions } from './TimelineScheduleTable';
import { buildTimelineModel, editableRows, type ChartTask, type ScheduleTableRow, type TimelineZoom, type WidgetDrop } from './timeline-model';

export interface TimelineSettings {
    zoom: TimelineZoom;
    showCriticalPath: boolean;
    showNoDates: boolean;
}

export const DEFAULT_TIMELINE_SETTINGS: TimelineSettings = { zoom: 'week', showCriticalPath: true, showNoDates: true };

export type TimelineMode = 'chart' | 'table';

const ZOOMS: readonly TimelineZoom[] = ['day', 'week', 'month', 'quarter'];

export interface TimelineViewProps {
    filters: WorkItemListFilters;
    /** The page's fixed project (a project's or a milestone's page). */
    scopeProjectId?: string;
    settings: TimelineSettings;
    onSettingsChange: (settings: TimelineSettings) => void;
    mode: TimelineMode;
    onModeChange: (mode: TimelineMode) => void;
    onOpen: (id: string) => void;
    /** A cycle's page: its days, shaded on the chart (`YYYY-MM-DD`, inclusive). */
    highlightRange?: { start: string; end: string };
    /** The caller edits work items (3.1c): dates and dependencies can be changed from the timeline. */
    canEdit?: boolean;
}

function NoDatesPanel({
    rows,
    onOpen,
    canSetDates,
    onSetDates,
}: {
    rows: readonly ScheduleTableRow[];
    onOpen: (id: string) => void;
    canSetDates?: (id: string) => boolean;
    onSetDates?: (id: string) => void;
}) {
    const tNoDates = useTranslations('workItems.timeline.noDatesPanel');
    return (
        <aside aria-labelledby="timeline-no-dates-heading" className="flex w-full flex-col gap-compact overflow-y-auto border-border-subtle p-compact md:w-64 md:border-l" data-testid="timeline-no-dates">
            <h2 id="timeline-no-dates-heading" className="text-sm font-semibold text-content-emphasis">
                {tNoDates('heading')} <span className="font-normal text-content-muted">({tNoDates('count', { count: rows.length })})</span>
            </h2>
            <p className="text-xs text-content-muted">{tNoDates('description')}</p>
            {rows.length === 0 ? (
                <p className="text-xs text-content-muted">{tNoDates('empty')}</p>
            ) : (
                <ul className="space-y-tight">
                    {rows.map((r) => (
                        <li key={r.id} className="flex items-center gap-tight">
                            <button type="button" className="min-w-0 flex-1 truncate rounded-sm text-left text-sm hover:underline focus-visible:outline focus-visible:outline-2" onClick={() => onOpen(r.id)}>
                                <span className="font-mono text-xs text-content-muted">{r.key}</span> {r.title}
                            </button>
                            {onSetDates && canSetDates?.(r.id) && (
                                <Button type="button" variant="secondary" size="sm" text={tNoDates('setDates')} aria-label={tNoDates('setDatesLabel', { key: r.key })} onClick={() => onSetDates(r.id)} />
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </aside>
    );
}

export function TimelineView({ filters, scopeProjectId, settings, onSettingsChange, mode, onModeChange, onOpen, highlightRange, canEdit = false }: TimelineViewProps) {
    const tView = useTranslations('workItems.timeline');
    const timeline = useWorkItemTimeline(filters);
    const config = useWorkConfig();
    const writes = useTimelineWrites();
    const toast = useToast();
    const data = timeline.data;

    // A type's start and due date rules (2.4b-b: built-in rules are the type's across the workspace), for the types in view.
    const hiddenDates = useMemo(() => {
        const byType = new Map(
            [...new Set((data?.rows ?? []).map((r) => r.typeId))].map((typeId) => {
                const set = resolveFieldSet(config.fieldSetEntries, typeId);
                return [typeId, { startDate: set.builtIn.startDate === 'HIDDEN', dueDate: set.builtIn.dueDate === 'HIDDEN' }] as const;
            }),
        );
        return (row: TimelineRow) => byType.get(row.typeId) ?? { startDate: false, dueDate: false };
    }, [config.fieldSetEntries, data]);
    const editable = useMemo(() => (data ? editableRows(data, { canEdit, hiddenDates }) : { dates: new Set<string>(), dependencies: new Set<string>() }), [data, canEdit, hiddenDates]);
    const rowById = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);

    const [changing, setChanging] = useState<{ id: string; proposed: ItemDates } | null>(null);
    const [linking, setLinking] = useState<{ fromId: string; toId: string } | null>(null);
    const [managing, setManaging] = useState<string | null>(null);

    const openChange = useCallback(
        (id: string, drop?: WidgetDrop) => {
            const row = rowById.get(id);
            if (!row || !data) return;
            let proposed: ItemDates = { startDate: row.startDate, dueDate: row.dueDate };
            const cal = data.calendars.find((c) => c.id === row.calendarId);
            if (drop && cal) {
                proposed = proposeDates(row, compileCalendar({ id: cal.id, workingWeekdays: cal.workingWeekdays, holidays: cal.holidays.map((h) => toEpochDay(h)) }), drop.mode, drop.days);
            }
            setChanging({ id, proposed });
        },
        [rowById, data],
    );
    const confirmChange = useCallback(
        (row: TimelineRow, choice: ChangeDatesConfirm) => {
            setChanging(null);
            if (choice.pushed.length > 0) writes.reschedule({ row, to: choice.to, pushed: choice.pushed });
            else void writes.changeDates(row, choice.to);
        },
        [writes],
    );
    const addDependency = useCallback(
        async (fromId: string, toId: string): Promise<string | null> => {
            try {
                await writes.addDependency(fromId, toId);
                return null;
            } catch (err) {
                return err instanceof ApiClientError && err.reason ? err.reason : tView('dependency.failed');
            }
        },
        [writes, tView],
    );
    const removeLink = useCallback(
        (linkId: string) => {
            const edge = data?.edges.find((e) => e.id === linkId);
            const from = edge && rowById.get(edge.fromId);
            const to = edge && rowById.get(edge.toId);
            if (!edge || !from || !to) return;
            if (!editable.dependencies.has(from.id) || !editable.dependencies.has(to.id)) {
                toast.error(tView('dependency.notHere'));
                return;
            }
            writes.removeDependency(edge, tView('dependency.question', { from: from.key, to: to.key }).replace(/\?$/, ''));
        },
        [data, rowById, editable, writes, toast, tView],
    );
    const tableActions = useMemo<ScheduleTableActions | undefined>(
        () =>
            canEdit
                ? {
                      datesEditable: (id) => editable.dates.has(id),
                      dependenciesEditable: (id) => editable.dependencies.has(id),
                      onChangeDates: (id) => openChange(id),
                      onDependencies: (id) => setManaging(id),
                  }
                : undefined,
        [canEdit, editable, openChange],
    );
    const model = useMemo(
        () => (timeline.data ? buildTimelineModel(timeline.data, { scopeProjectId, showCriticalPath: settings.showCriticalPath }) : null),
        [timeline.data, scopeProjectId, settings.showCriticalPath],
    );

    const floatLabel = useCallback(
        (task: ChartTask) => {
            if (task.totalFloat === null) return '';
            if (task.lateDays > 0) return tView('float.late', { days: task.lateDays });
            return tView('float.days', { days: Math.max(0, task.totalFloat) });
        },
        [tView],
    );
    const labels = useMemo(
        () => ({ key: tView('col.key'), title: tView('col.title'), float: tView('col.float'), contextGroup: tView('contextGroup') }),
        [tView],
    );

    const zoomOptions: ComboboxOption[] = ZOOMS.map((z) => ({ value: z, label: tView(`zoomLevel.${z}`) }));
    const controls = (
        <div className="flex flex-wrap items-center gap-default" data-testid="timeline-controls">
            <ToggleGroup
                ariaLabel={tView('view')}
                options={[
                    { value: 'chart', label: tView('chart'), id: 'timeline-mode-chart' },
                    { value: 'table', label: tView('table'), id: 'timeline-mode-table' },
                ]}
                selected={mode}
                selectAction={(v) => onModeChange(v === 'table' ? 'table' : 'chart')}
            />
            {mode === 'chart' && (
                <Combobox
                    selected={zoomOptions.find((o) => o.value === settings.zoom) ?? null}
                    setSelected={(o) => o && onSettingsChange({ ...settings, zoom: o.value as TimelineZoom })}
                    options={zoomOptions}
                    hideSearch
                    caret
                    buttonProps={{ 'aria-label': tView('zoom') }}
                />
            )}
            <div className="flex items-center gap-tight">
                <Switch
                    id="timeline-critical-path"
                    checked={settings.showCriticalPath}
                    onCheckedChange={(showCriticalPath) => onSettingsChange({ ...settings, showCriticalPath })}
                />
                <Label htmlFor="timeline-critical-path">{tView('criticalPath')}</Label>
            </div>
            {mode === 'chart' && (
                <div className="flex items-center gap-tight">
                    <Switch id="timeline-no-dates" checked={settings.showNoDates} onCheckedChange={(showNoDates) => onSettingsChange({ ...settings, showNoDates })} />
                    <Label htmlFor="timeline-no-dates">{tView('showNoDates')}</Label>
                </div>
            )}
        </div>
    );

    let body: React.ReactNode;
    if (timeline.tooLarge) {
        const { count, limit, what } = timeline.tooLarge;
        body = (
            <InlineNotice variant="warning">
                <span data-testid="timeline-too-large">{what === 'relations' ? tView('tooLargeRelations', { count, limit }) : tView('tooLarge', { count, limit })}</span>
            </InlineNotice>
        );
    } else if (timeline.error) {
        body = (
            <InlineNotice variant="error">
                {tView('loadFailed')} <Button variant="secondary" size="sm" text={tView('retry')} onClick={timeline.revalidate} />
            </InlineNotice>
        );
    } else if (model && !model.ok) {
        body = <InlineNotice variant="error">{model.error === 'CYCLE' ? tView('cycle', { keys: model.cycleKeys.join(' → ') }) : tView('engineTooLarge')}</InlineNotice>;
    } else if (!model) {
        body = <TimelineScheduleTable rows={[]} onOpen={onOpen} loading />;
    } else {
        const tableRows = settings.showCriticalPath ? model.table : model.table.map((r) => ({ ...r, critical: false }));
        body =
            mode === 'table' ? (
                <TimelineScheduleTable rows={tableRows} onOpen={onOpen} actions={tableActions} />
            ) : (
                <div className="flex h-full min-h-0 flex-col md:flex-row">
                    <div className="min-h-0 min-w-0 flex-1">
                        <TimelineChart
                            tasks={model.tasks}
                            links={model.links}
                            criticalLinkIds={model.criticalLinkIds}
                            range={model.range}
                            zoom={settings.zoom}
                            asOf={model.asOf}
                            nonWorking={model.nonWorkingEveryCalendar}
                            highlightRange={highlightRange}
                            labels={labels}
                            floatLabel={floatLabel}
                            onOpen={onOpen}
                            editable={canEdit}
                            draggableIds={editable.dates}
                            linkableIds={editable.dependencies}
                            onDateDrop={openChange}
                            onLinkDraw={(fromId, toId) => setLinking({ fromId, toId })}
                            onLinkRefused={() => toast.error(tView('dependency.wrongType'))}
                            onLinkRemove={removeLink}
                            fallback={
                                <InlineNotice variant="error">
                                    {tView('loadFailed')} <Button variant="secondary" size="sm" text={tView('table')} onClick={() => onModeChange('table')} />
                                </InlineNotice>
                            }
                        />
                    </div>
                    {settings.showNoDates && <NoDatesPanel rows={model.noDates} onOpen={onOpen} canSetDates={(id) => editable.dates.has(id)} onSetDates={(id) => openChange(id)} />}
                </div>
            );
    }

    const summary = model?.ok ? model.summary : null;
    const changingRow = changing ? rowById.get(changing.id) : undefined;
    const linkFrom = linking ? rowById.get(linking.fromId) : undefined;
    const linkTo = linking ? rowById.get(linking.toId) : undefined;
    const managingRow = managing ? rowById.get(managing) : undefined;
    return (
        <section aria-labelledby="timeline-heading" className="flex h-full min-h-0 flex-col gap-compact" data-testid="timeline-view">
            <h2 id="timeline-heading" className="sr-only">
                {tView('heading')}
            </h2>
            {controls}
            {summary && (
                <p className="text-sm text-content-muted" data-testid="timeline-summary">
                    {summary.hasDatedOpenItem ? (
                        <>
                            {summary.finish && <span>{tView('summary.finishes', { date: formatDay(summary.finish) })} · </span>}
                            {settings.showCriticalPath && <span>{tView('summary.critical', { count: summary.criticalCount })} · </span>}
                            <span>{tView('summary.late', { count: summary.lateCount })}</span>
                        </>
                    ) : (
                        <span>{tView('summary.noDates')}</span>
                    )}
                    {summary.projectDue && (
                        <span>
                            {' · '}
                            {tView('summary.projectDue', { date: formatDay(summary.projectDue.dueDate) })}
                            {summary.projectDue.lateDays > 0 && <span className="text-content-error"> · {tView('summary.projectLate', { days: summary.projectDue.lateDays })}</span>}
                        </span>
                    )}
                </p>
            )}
            {data && data.hiddenDependencies > 0 && <InlineNotice variant="info">{tView('hiddenDependencies', { count: data.hiddenDependencies })}</InlineNotice>}
            {data && data.omittedContextRows > 0 && <InlineNotice variant="info">{tView('omittedContext', { count: data.omittedContextRows })}</InlineNotice>}
            {mode === 'chart' && model?.ok && (
                <ul aria-label={tView('legend.label')} className="flex flex-wrap gap-default text-xs text-content-muted">
                    {settings.showCriticalPath && (
                        <li className="flex items-center gap-tight">
                            <span aria-hidden className="inline-block h-3 w-5 rounded-sm border-2 border-[var(--content-error)]" />
                            {tView('legend.critical')}
                        </li>
                    )}
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block h-3 w-5 rounded-sm bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--border-error)_3px_5px)]" />
                        {tView('legend.late')}
                    </li>
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block size-2 rounded-full bg-[var(--content-warning)]" />
                        {tView('legend.conflict')}
                    </li>
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block h-3 w-1 bg-[var(--brand-default)]" />
                        {tView('legend.today')}
                    </li>
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block h-3 w-3 border border-border-subtle bg-bg-subtle" />
                        {new Set(data?.rows.map((r) => r.calendarId)).size > 1 ? tView('legend.nonWorkingSeveral') : tView('legend.nonWorking')}
                    </li>
                </ul>
            )}
            <div className="min-h-0 flex-1">{body}</div>
            {data && changing && changingRow && (
                <ChangeDatesDialog
                    data={data}
                    row={changingRow}
                    proposed={changing.proposed}
                    hiddenDates={hiddenDates}
                    onCancel={() => setChanging(null)}
                    onConfirm={(choice) => confirmChange(changingRow, choice)}
                    onOpen={onOpen}
                />
            )}
            {linkFrom && linkTo && <AddDependencyDialog from={linkFrom} to={linkTo} onAdd={addDependency} onClose={() => setLinking(null)} />}
            {data && managingRow && (
                <DependenciesDialog
                    data={data}
                    row={managingRow}
                    linkable={editable.dependencies}
                    onAdd={addDependency}
                    onRemove={(edge, label) => writes.removeDependency(edge, label)}
                    onClose={() => setManaging(null)}
                />
            )}
        </section>
    );
}
