'use client';

/**
 * A forecast, shown (sub-phase 3.6c; owner decisions 318 to 325;
 * docs/porting/maps/3.6.md, "Where analytics appear"): the dates by which a
 * scope's open items are 50, 85 and 95 percent likely to be done (never
 * "confidence", ADR 0006), the chance by its due date, what it is based on
 * and what it assumes, the caution under 50 completions, or the refusal's
 * sentence with its counts, never a date. In detail (the sheet): the
 * history, share and basis a person may change, the distribution and the
 * "Chance finished by" curve each with its table, and "How this was
 * computed" with the seed and the scope's own record.
 *
 * Every figure is the server's (`GET /analytics/forecast`); the panel computes
 * no date. Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { formatDay } from '@/components/time/time-format';
import type { WorkItemListFilters } from '@/components/work-items/data/list-filters';
import type { ForecastLikelyDate, ForecastResponse } from '@/lib/analytics/types';

import { ChanceByDateCurve } from '../charts/ChanceByDateCurve';
import { ChartSection, FiguresTable } from '../charts/ChartSection';
import { ForecastHistogram } from '../charts/ForecastHistogram';
import { useForecast, type ForecastChoices } from '../data/use-forecast';

const WEEKS = [4, 8, 12, 26] as const;
const count = (n: number) => new Intl.NumberFormat('en-GB').format(n);
const SHARES = [100, 75, 50, 25] as const;

/** A whole percent of the trials that never reads 0 or 100 unless none or all finished. */
export function chancePercent(finished: number, trials: number): number {
    if (finished <= 0) return 0;
    if (finished >= trials) return 100;
    return Math.min(99, Math.max(1, Math.round((finished / trials) * 100)));
}

function LikelyDates({ f }: { f: ForecastResponse }) {
    const tDates = useTranslations('forecast.likely');
    const text = (d: ForecastLikelyDate) => (d.beyond ? tDates('later', { date: formatDay(d.date, 'dateYear') }) : formatDay(d.date, 'dateYear'));
    return (
        <dl className="grid grid-cols-3 gap-default" aria-label={tDates('label')} data-testid="forecast-dates">
            {(['p50', 'p85', 'p95'] as const).map((p) => (
                <div key={p}>
                    <dt className="text-xs text-content-muted">{tDates(p)}</dt>
                    <dd className="text-lg font-semibold tabular-nums text-content-emphasis" data-testid={`forecast-${p}`}>
                        {text(f.likely![p])}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

/** The sentences a forecast carries: due date, basis, assumptions, caution, set-aside filters. */
function Sentences({ f }: { f: ForecastResponse }) {
    const tText = useTranslations('forecast');
    const tAside = useTranslations('analytics.setAsideNames');
    const basis =
        f.basedOn.kind === 'team'
            ? tText('basedOn.team', { team: f.basedOn.team?.name ?? '', completions: f.history.completions, weeks: f.history.weeks })
            : f.basedOn.kind === 'workspace'
              ? tText('basedOn.workspace', { completions: f.history.completions, weeks: f.history.weeks })
              : tText('basedOn.projects', { names: f.basedOn.projects.map((p) => p.name).join(', '), completions: f.history.completions, weeks: f.history.weeks });
    return (
        <div className="space-y-tight text-sm" data-testid="forecast-sentences">
            {f.due && !f.refused && (
                <p className="font-medium text-content-emphasis" data-testid="forecast-due">
                    {f.due.passed || f.due.finished === null
                        ? tText('duePassed', { date: formatDay(f.due.date, 'dateYear') })
                        : tText('due', { percent: chancePercent(f.due.finished, f.trials), date: formatDay(f.due.date, 'dateYear') })}
                </p>
            )}
            <p className="text-content-muted">
                {tText('remaining', { count: f.remaining })} {basis}
            </p>
            {!f.refused && <p className="text-content-muted">{f.share === 100 ? tText('assumesAll') : tText('assumes', { share: f.share })}</p>}
            {f.cautions.includes('FEW_COMPLETIONS') && (
                <p className="text-content-warning" role="note">
                    {tText('caution')}
                </p>
            )}
            {f.setAside.length > 0 && <p className="text-xs text-content-muted">{tText('setAside', { filters: f.setAside.map((k) => tAside(k)).join(', ') })}</p>}
        </div>
    );
}

function Refusal({ f }: { f: ForecastResponse }) {
    const tRefused = useTranslations('forecast.refused');
    const r = f.refused!;
    const text =
        r.reason === 'TOO_FEW_COMPLETIONS'
            ? tRefused('TOO_FEW_COMPLETIONS', { completions: r.completions, weeks: r.weeks, needed: r.needed })
            : r.reason === 'TOO_FEW_WORKING_DAYS'
              ? tRefused('TOO_FEW_WORKING_DAYS', { workingDays: r.workingDays, needed: r.needed })
              : r.reason === 'BEYOND_TWO_YEARS'
                ? tRefused('BEYOND_TWO_YEARS', { completions: r.completions, weeks: r.weeks })
                : tRefused(r.reason);
    return (
        <p role="status" className="text-sm font-medium text-content-emphasis" data-testid="forecast-refused">
            {text}
        </p>
    );
}

function Controls({ f, choices, onChoices }: { f: ForecastResponse; choices: ForecastChoices; onChoices: (next: ForecastChoices) => void }) {
    const tControls = useTranslations('forecast.controls');
    const basisOptions = [
        { value: 'projects', label: tControls('projects') },
        ...(f.offered.team ? [{ value: 'team', label: tControls('team', { team: f.offered.team.name }) }] : []),
        { value: 'workspace', label: tControls('workspace') },
    ];
    const projectOptions = useMemo<ComboboxOption[]>(() => f.offered.projects.map((p) => ({ value: p.id, label: p.name })), [f.offered.projects]);
    const chosen = choices.historyProjectIds && choices.historyProjectIds.length > 0 ? projectOptions.filter((o) => choices.historyProjectIds!.includes(o.value)) : projectOptions;
    return (
        <div className="flex flex-wrap items-center gap-default" data-testid="forecast-controls">
            <ToggleGroup
                ariaLabel={tControls('window')}
                options={WEEKS.map((w) => ({ value: String(w), label: tControls('weeks', { weeks: w }) }))}
                selected={String(f.history.weeks)}
                selectAction={(v) => onChoices({ ...choices, historyWeeks: Number(v) as ForecastChoices['historyWeeks'] })}
            />
            <ToggleGroup
                ariaLabel={tControls('share')}
                options={SHARES.map((s) => ({ value: String(s), label: tControls('sharePercent', { share: s }) }))}
                selected={String(f.share)}
                selectAction={(v) => onChoices({ ...choices, share: Number(v) as ForecastChoices['share'] })}
            />
            <ToggleGroup
                ariaLabel={tControls('basedOn')}
                options={basisOptions}
                selected={f.basedOn.kind}
                selectAction={(v) => onChoices({ ...choices, basedOn: v as ForecastChoices['basedOn'], historyProjectIds: undefined })}
            />
            {f.basedOn.kind === 'projects' && projectOptions.length > 1 && (
                <Combobox
                    multiple
                    selected={chosen}
                    setSelected={(opts) => {
                        // Never none: an empty choice is the whole set again.
                        const ids = opts.map((o) => o.value);
                        onChoices({ ...choices, basedOn: 'projects', historyProjectIds: ids.length === projectOptions.length ? undefined : ids });
                    }}
                    options={projectOptions}
                    caret
                    placeholder={tControls('chooseProjects')}
                    buttonProps={{ 'aria-label': tControls('chooseProjects') }}
                />
            )}
        </div>
    );
}

function Charts({ f }: { f: ForecastResponse }) {
    const tHist = useTranslations('forecast.histogram');
    const tCurve = useTranslations('forecast.curve');
    const tMarks = useTranslations('forecast.likely');
    const histogram = f.histogram!;
    const curve = (f.curve ?? []).map((c) => ({ date: c.date, share: c.finished / f.trials }));
    const marks = [
        ...(['p50', 'p85', 'p95'] as const).filter((p) => !f.likely![p].beyond).map((p) => ({ date: f.likely![p].date, label: tMarks(p) })),
        ...(f.due && !f.due.passed ? [{ date: f.due.date, label: tCurve('due', { date: formatDay(f.due.date, 'date') }), due: true }] : []),
    ];
    const unit = histogram.resolution === 'week' ? 'week' : 'day';
    return (
        <div className="grid gap-default">
            <ChartSection
                title={tHist('title')}
                testId="forecast-histogram-section"
                summary={histogram.beyond > 0 ? tHist('beyond', { count: histogram.beyond }) : tHist(`summary.${unit}`)}
                loading={false}
                failed={false}
                tooLarge={null}
                empty={histogram.buckets.length === 0}
                chart={() => <ForecastHistogram histogram={histogram} trials={f.trials} dueDate={f.due && !f.due.passed ? f.due.date : null} ariaLabel={tHist('aria', { trials: count(f.trials), buckets: histogram.buckets.length })} />}
                table={() => (
                    <FiguresTable
                        caption={tHist(`caption.${unit}`)}
                        columns={[tHist('from'), tHist('to'), tHist('trials')]}
                        rows={histogram.buckets.map((b) => [formatDay(b.start, 'dateYear'), formatDay(b.end, 'dateYear'), b.trials] as const)}
                    />
                )}
            />
            <ChartSection
                title={tCurve('title')}
                testId="forecast-curve-section"
                loading={false}
                failed={false}
                tooLarge={null}
                empty={curve.length === 0}
                chart={() => <ChanceByDateCurve points={curve} marks={marks} ariaLabel={tCurve('aria', { p50: formatDay(f.likely!.p50.date, 'dateYear'), p85: formatDay(f.likely!.p85.date, 'dateYear') })} />}
                table={() => (
                    <FiguresTable
                        caption={tCurve('caption')}
                        columns={[tCurve('date'), tCurve('chance')]}
                        rows={(f.curve ?? []).map((c) => [formatDay(c.date, 'dateYear'), tCurve('percent', { value: chancePercent(c.finished, f.trials) })] as const)}
                    />
                )}
            />
        </div>
    );
}

function HowComputed({ f }: { f: ForecastResponse }) {
    const tHow = useTranslations('forecast.how');
    const r = f.record;
    return (
        <section aria-labelledby="forecast-how" className="space-y-tight text-sm text-content-muted" data-testid="forecast-how">
            <h3 id="forecast-how" className="text-sm font-semibold text-content-emphasis">
                {tHow('title')}
            </h3>
            <p>{tHow('method')}</p>
            {f.history.from && f.history.to ? (
                <p>
                    {tHow('window', {
                        from: formatDay(f.history.from, 'dateYear'),
                        to: formatDay(f.history.to, 'dateYear'),
                        workingDays: f.history.workingDays,
                        completions: f.history.completions,
                        zone: f.timeZone,
                    })}
                </p>
            ) : (
                <p>{tHow('noWindow')}</p>
            )}
            <p data-testid="forecast-seed">{tHow('trials', { trials: count(f.trials), seed: f.seed })}</p>
            <p data-testid="forecast-record">
                {r.status === 'SHOWN'
                    ? tHow('record.SHOWN', { scorable: r.p85.scorable, held: r.p85.held, size: r.size, p50Held: r.p50.held, p50: r.p50.scorable, p95Held: r.p95.held, p95: r.p95.scorable })
                    : r.status === 'TOO_LARGE'
                      ? tHow('record.TOO_LARGE', { limit: count(r.limit) })
                      : r.status === 'NOT_ENOUGH'
                        ? tHow('record.NOT_ENOUGH')
                        : tHow('record.NONE')}
            </p>
        </section>
    );
}

export interface ForecastPanelProps {
    filters: WorkItemListFilters;
    choices: ForecastChoices;
    onChoices: (next: ForecastChoices) => void;
    /** The sheet's view: the controls, the charts and how it was computed. */
    detailed?: boolean;
}

export function ForecastPanel({ filters, choices, onChoices, detailed = false }: ForecastPanelProps) {
    const t = useTranslations('forecast');
    const read = useForecast(filters, choices);
    const f = read.data;
    if (read.tooLarge) {
        return (
            <p role="status" className="text-sm text-content-muted" data-testid="forecast-too-large">
                {t('tooLarge', { limit: count(read.tooLarge.limit) })}
            </p>
        );
    }
    if (read.error) {
        return (
            <p role="alert" className="text-sm text-content-error">
                {t('failed')}
            </p>
        );
    }
    if (!f) return <p className="text-sm text-content-muted">{t('loading')}</p>;
    return (
        <div className="space-y-default" data-testid={detailed ? 'forecast-detail' : 'forecast-panel'}>
            {detailed && <Controls f={f} choices={choices} onChoices={onChoices} />}
            {f.refused ? <Refusal f={f} /> : <LikelyDates f={f} />}
            <Sentences f={f} />
            {detailed && !f.refused && <Charts f={f} />}
            {detailed && <HowComputed f={f} />}
        </div>
    );
}
