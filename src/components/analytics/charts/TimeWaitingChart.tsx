'use client';

/**
 * Time waiting (sub-phase 3.6b; owner decisions 76, 317 and 329;
 * docs/porting/maps/3.6.md, "Time waiting"; ADR 0006 "Time waiting", never
 * "Idle time", "Blocked time" or "Response time").
 *
 *   - **The totals**, when the server gives them (a holder of
 *     `analytics.people`, decision 335): the share of open item time spent
 *     waiting on someone (open: Unstarted or Started, decision 336), the
 *     waits that ended with their median and 85th percentile, and how many
 *     items wait now. Without them, a sentence saying other people's figures
 *     and the totals are shown to those allowed to see them.
 *   - **Per party**, the rows the server gave: every party's for a holder of
 *     `analytics.people`, else the reader's own (decision 329). Each a bar of
 *     the time waited in the window, split into waiting on and as a
 *     reviewer ("Waited on Ana 3.5 days, 2 of them as a reviewer"), with a
 *     table of the same figures and of what waits now. The component never
 *     asks who may see what: it draws the rows it was given.
 *
 * The bars are a small Islestone visx component on the analytics charts'
 * scales and tokens (the shared chart platform draws time series only).
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { AxisBottom } from '@visx/axis';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';

import type { WaitingPartyRow, WaitingResponse } from '@/lib/analytics/types';

import type { AnalyticsRead } from '../data/use-analytics';
import { ChartSection, FiguresTable } from './ChartSection';

const MARGIN = { top: 4, right: 12, bottom: 24, left: 120 };
const FIELD_CLASS = 'text-content-info';
const REVIEW_CLASS = 'text-content-warning';

/** A party's name as the page shows it: a member by name, a deactivated one marked, removed members as one row. */
export function partyName(labels: { former: string; unnamed: string; deactivated: (name: string) => string }, row: WaitingPartyRow): string {
    if (row.party.kind === 'former') return labels.former;
    const name = row.party.name ?? labels.unnamed;
    return row.party.active ? name : labels.deactivated(name);
}

function Bars({ rows, names, width, height }: { rows: readonly WaitingPartyRow[]; names: readonly string[]; width: number; height: number }) {
    const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);
    const y = scaleBand({ domain: rows.map((_, i) => i), range: [0, innerH], padding: 0.25 });
    const x = scaleLinear({ domain: [0, Math.max(1, ...rows.map((r) => r.waited))], range: [0, innerW], nice: true });
    return (
        <svg width={width} height={height}>
            <Group left={MARGIN.left} top={MARGIN.top}>
                {rows.map((r, i) => {
                    const top = y(i) ?? 0;
                    const field = Math.max(0, r.waited - r.asReviewer);
                    return (
                        <g key={i}>
                            <text x={-6} y={top + y.bandwidth() / 2} textAnchor="end" dominantBaseline="middle" className="fill-content-muted text-[10px]">
                                {names[i]!.length > 18 ? `${names[i]!.slice(0, 17)}…` : names[i]}
                            </text>
                            <Bar x={0} y={top} width={x(field)} height={y.bandwidth()} className={FIELD_CLASS} fill="currentColor" rx={2} />
                            <Bar x={x(field)} y={top} width={x(r.asReviewer)} height={y.bandwidth()} className={REVIEW_CLASS} fill="currentColor" rx={2} />
                        </g>
                    );
                })}
                <AxisBottom top={innerH} scale={x} numTicks={Math.max(2, Math.floor(innerW / 80))} stroke="currentColor" tickStroke="currentColor" tickLabelProps={{ className: 'fill-content-muted text-[10px]' }} />
            </Group>
        </svg>
    );
}

export function TimeWaitingChart({ read }: { read: AnalyticsRead<WaitingResponse> }) {
    const tWait = useTranslations('analytics.waiting');
    const data = read.data;
    const rows = data ? (data.people ?? (data.self ? [data.self] : [])) : [];
    const labels = { former: tWait('former'), unnamed: tWait('unnamed'), deactivated: (name: string) => tWait('deactivated', { name }) };
    const names = rows.map((r) => partyName(labels, r));
    const totals = data?.totals;
    const summary = totals ? (
        <>
            {totals.share === null
                ? tWait('summary.noOpenTime')
                : tWait('summary.share', { share: Math.round(totals.share * 100), waiting: totals.itemTimeWaiting, open: totals.openItemTime })}{' '}
            {totals.ended.count > 0 && tWait('summary.ended', { count: totals.ended.count, p50: totals.ended.p50 ?? 0, p85: totals.ended.p85 ?? 0 })}{' '}
            {tWait('summary.now', { count: totals.waitingNow })}
        </>
    ) : data ? (
        // Without analytics.people: one's own row, no totals (decision 335).
        tWait('summary.ownRow')
    ) : undefined;
    const now = rows.flatMap((r, i) => r.waitingNowItems.map((w) => [names[i]!, w.key, w.title, tWait('days', { days: w.age }), w.asReviewer ? tWait('kind.review') : tWait('kind.waitingOn')] as const));
    // With the totals, nothing waited is an empty chart; one's own row alone is always shown, zeros included.
    const nothing = !!data?.totals && data.totals.items === 0 && data.totals.waitingNow === 0;
    return (
        <ChartSection
            title={tWait('title')}
            testId="analytics-time-waiting"
            legend={[
                { label: tWait('legend.waitingOn'), className: FIELD_CLASS },
                { label: tWait('legend.review'), className: REVIEW_CLASS },
            ]}
            summary={summary}
            loading={read.isLoading && !data}
            failed={!!read.error}
            tooLarge={read.tooLarge}
            empty={nothing}
            chart={() => (
                <div
                    className="h-full w-full"
                    role="img"
                    aria-label={rows.map((r, i) => tWait('aria', { name: names[i]!, days: r.waited, review: r.asReviewer })).join(' ')}
                >
                    <ParentSize>{({ width, height }) => (width > 0 && height > 0 ? <Bars rows={rows} names={names} width={width} height={height} /> : null)}</ParentSize>
                </div>
            )}
            table={() => (
                <>
                    <FiguresTable
                        caption={tWait('caption')}
                        columns={[tWait('person'), tWait('waited'), tWait('asReviewer'), tWait('items'), tWait('ended'), tWait('waitingNow')]}
                        rows={rows.map(
                            (r, i) =>
                                [
                                    names[i]!,
                                    tWait('days', { days: r.waited }),
                                    tWait('days', { days: r.asReviewer }),
                                    r.items,
                                    r.ended.count === 0 ? tWait('noneEnded') : tWait('endedFigures', { count: r.ended.count, p50: r.ended.p50 ?? 0, p85: r.ended.p85 ?? 0 }),
                                    r.waitingNow,
                                ] as const,
                        )}
                    />
                    {now.length > 0 && (
                        <FiguresTable caption={tWait('nowCaption')} columns={[tWait('person'), tWait('item'), tWait('itemTitle'), tWait('age'), tWait('kind.label')]} rows={now} />
                    )}
                    {data?.waitingNowCut && <p className="text-xs text-content-muted">{tWait('nowCut')}</p>}
                </>
            )}
        />
    );
}
