'use client';

/**
 * The timeline layout (roadmap 3.1b; ADR 0010; owner decisions 184 to 203):
 * read-only. One read (`useWorkItemTimeline`, the list's filters), one view
 * model (`buildTimelineModel`), shown as the chart or the schedule table
 * (decision 203, remembered per viewer), with the "No dates" list beside the
 * chart (decision 185), the summary line ("Finishes on …", the critical
 * path, late items, the project's due date: decision 188) and what was left
 * out said in words (a scope over 5,000 items, relations to items the caller
 * cannot see). Never an invented number: with no dated open item it says
 * "Add dates to see the critical path".
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { Label } from '@/components/ui/label';

import type { WorkItemListFilters } from '../data/list-filters';
import { useWorkItemTimeline } from '../data/use-work-item-timeline';
import { TimelineChart } from './TimelineChart';
import { TimelineScheduleTable, formatDay } from './TimelineScheduleTable';
import { buildTimelineModel, type ChartTask, type ScheduleTableRow, type TimelineZoom } from './timeline-model';

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
}

function NoDatesPanel({ rows, onOpen }: { rows: readonly ScheduleTableRow[]; onOpen: (id: string) => void }) {
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
                        <li key={r.id}>
                            <button type="button" className="w-full truncate rounded-sm text-left text-sm hover:underline focus-visible:outline focus-visible:outline-2" onClick={() => onOpen(r.id)}>
                                <span className="font-mono text-xs text-content-muted">{r.key}</span> {r.title}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </aside>
    );
}

export function TimelineView({ filters, scopeProjectId, settings, onSettingsChange, mode, onModeChange, onOpen, highlightRange }: TimelineViewProps) {
    const tView = useTranslations('workItems.timeline');
    const timeline = useWorkItemTimeline(filters);
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
                <TimelineScheduleTable rows={tableRows} onOpen={onOpen} />
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
                            fallback={
                                <InlineNotice variant="error">
                                    {tView('loadFailed')} <Button variant="secondary" size="sm" text={tView('table')} onClick={() => onModeChange('table')} />
                                </InlineNotice>
                            }
                        />
                    </div>
                    {settings.showNoDates && <NoDatesPanel rows={model.noDates} onOpen={onOpen} />}
                </div>
            );
    }

    const summary = model?.ok ? model.summary : null;
    const data = timeline.data;
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
                    {settings.showCriticalPath && <li>{tView('legend.critical')}</li>}
                    <li>{tView('legend.late')}</li>
                    <li>{tView('legend.conflict')}</li>
                    <li>{tView('legend.today')}</li>
                    <li>{new Set(data?.rows.map((r) => r.calendarId)).size > 1 ? tView('legend.nonWorkingSeveral') : tView('legend.nonWorking')}</li>
                </ul>
            )}
            <div className="min-h-0 flex-1">{body}</div>
        </section>
    );
}
