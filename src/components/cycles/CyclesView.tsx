'use client';

/**
 * The Cycles page (sub-phase 2.5a): one section per team, its current cycle
 * with scope, started and completed, then its upcoming and completed cycles,
 * each linking to the cycle's page. A viewer the server offers
 * `manageCycles` gets the team's cycle schedule, "New cycle", and delete on an
 * upcoming cycle (through the undo toast). The list is the server's
 * (`GET /cycles`), read again after every write.
 *
 * Written fresh for Islestone (docs/porting/maps/2.5.md, "UI touch points").
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { CycleAffordances, CycleData } from '@/lib/work-items/types';

import { CycleFormDialog, CycleScheduleDialog } from './CycleDialogs';
import { useCycles, useCycleWrites } from './use-cycles';

export function cycleTitle(t: (key: string, values?: Record<string, string | number>) => string, c: Pick<CycleData, 'name' | 'number'>): string {
    return c.name?.trim() || t('numbered', { number: c.number });
}

function percent(done: number, scope: number): number {
    return scope === 0 ? 0 : Math.round((done / scope) * 100);
}

function CycleRow({ cycle, canDelete, onDelete }: { cycle: CycleData; canDelete: boolean; onDelete: (c: CycleData) => void }) {
    const tRow = useTranslations('cycles');
    const tenantHref = useTenantHref();
    const title = cycleTitle(tRow, cycle);
    return (
        <li className="flex flex-wrap items-center justify-between gap-tight border-t border-border-subtle py-2 first:border-t-0">
            <div className="min-w-0">
                <Link href={tenantHref(`/cycles/${cycle.id}`)} className="text-sm text-content-emphasis hover:underline">
                    {title}
                </Link>
                <p className="text-xs text-content-muted">
                    {tRow('dates', { start: cycle.startsOn, end: cycle.endsOn })} · {tRow(`status.${cycle.status}`)}
                </p>
            </div>
            <div className="flex items-center gap-tight text-xs text-content-muted">
                <span>{tRow('countsShort', { completed: cycle.counts.completed, scope: cycle.counts.scope })}</span>
                {canDelete && cycle.status === 'upcoming' && (
                    <Button variant="ghost" size="sm" text={tRow('delete')} aria-label={tRow('deleteNamed', { name: title })} onClick={() => onDelete(cycle)} />
                )}
            </div>
        </li>
    );
}

function CurrentCycle({ cycle }: { cycle: CycleData }) {
    const tCurrent = useTranslations('cycles');
    const tenantHref = useTenantHref();
    const done = percent(cycle.counts.completed, cycle.counts.scope);
    return (
        <div className="space-y-tight rounded-lg border border-border-default p-default" data-testid={`current-cycle-${cycle.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-tight">
                <Link href={tenantHref(`/cycles/${cycle.id}`)} className="text-base font-semibold text-content-emphasis hover:underline">
                    {cycleTitle(tCurrent, cycle)}
                </Link>
                <span className="text-xs text-content-muted">
                    {tCurrent('dates', { start: cycle.startsOn, end: cycle.endsOn })} ·{' '}
                    {cycle.status === 'ended' ? tCurrent('status.ended') : tCurrent('daysLeft', { count: cycle.daysLeft })}
                </span>
            </div>
            <dl className="grid grid-cols-3 gap-default text-sm">
                <div>
                    <dt className="text-xs text-content-muted">{tCurrent('stats.scope')}</dt>
                    <dd className="tabular-nums text-content-emphasis">{cycle.counts.scope}</dd>
                </div>
                <div>
                    <dt className="text-xs text-content-muted">{tCurrent('stats.started')}</dt>
                    <dd className="tabular-nums text-content-emphasis">{cycle.counts.started}</dd>
                </div>
                <div>
                    <dt className="text-xs text-content-muted">{tCurrent('stats.completed')}</dt>
                    <dd className="tabular-nums text-content-emphasis">{cycle.counts.completed}</dd>
                </div>
            </dl>
            <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={done}
                aria-label={tCurrent('progressAria', { percent: done })}
            >
                <div className="h-full bg-content-success" style={{ width: `${done}%` }} />
            </div>
        </div>
    );
}

export function CyclesView({
    title,
    teams,
    initialCycles,
    affordances,
}: {
    title: string;
    teams: Array<{ id: string; name: string }>;
    initialCycles: CycleData[];
    affordances: CycleAffordances;
}) {
    const t = useTranslations('cycles');
    const { data } = useCycles(initialCycles);
    const writes = useCycleWrites();
    const cycles = useMemo(() => data ?? initialCycles, [data, initialCycles]);
    const [creatingFor, setCreatingFor] = useState<string | null>(null);
    const [scheduleFor, setScheduleFor] = useState<{ id: string; name: string } | null>(null);

    return (
        <DashboardLayout header={{ title, description: t('description') }} data-testid="cycles-page">
            {teams.length === 0 && <p className="text-sm text-content-muted">{t('noTeams')}</p>}
            {teams.map((team) => {
                const own = cycles.filter((c) => c.teamId === team.id);
                const current = own.filter((c) => c.status === 'current' || c.status === 'ended');
                const upcoming = own.filter((c) => c.status === 'upcoming').sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
                const completed = own.filter((c) => c.status === 'completed');
                return (
                    <section key={team.id} aria-labelledby={`team-${team.id}`} className="space-y-default">
                        <div className="flex flex-wrap items-center justify-between gap-tight">
                            <h2 id={`team-${team.id}`} className="text-lg font-semibold text-content-emphasis">
                                {team.name}
                            </h2>
                            {affordances.manageCycles && (
                                <div className="flex items-center gap-tight">
                                    <Button
                                        variant="secondary"
                                        text={t('schedule.open')}
                                        aria-label={t('schedule.openFor', { team: team.name })}
                                        onClick={() => setScheduleFor(team)}
                                    />
                                    <Button
                                        variant="primary"
                                        icon={<Plus />}
                                        text={t('new')}
                                        aria-label={t('newFor', { team: team.name })}
                                        onClick={() => setCreatingFor(team.id)}
                                    />
                                </div>
                            )}
                        </div>
                        {current.length > 0 ? (
                            current.map((c) => <CurrentCycle key={c.id} cycle={c} />)
                        ) : (
                            <p className="text-sm text-content-muted">{t('noCurrent')}</p>
                        )}
                        {upcoming.length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-content-muted">{t('upcoming')}</h3>
                                <ul>
                                    {upcoming.map((c) => (
                                        <CycleRow key={c.id} cycle={c} canDelete={affordances.manageCycles} onDelete={writes.remove} />
                                    ))}
                                </ul>
                            </div>
                        )}
                        {completed.length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-content-muted">{t('completed')}</h3>
                                <ul>
                                    {completed.map((c) => (
                                        <CycleRow key={c.id} cycle={c} canDelete={false} onDelete={writes.remove} />
                                    ))}
                                </ul>
                            </div>
                        )}
                    </section>
                );
            })}
            {affordances.manageCycles && (
                <>
                    <CycleFormDialog open={creatingFor !== null} onOpenChange={(o) => !o && setCreatingFor(null)} teamId={creatingFor ?? ''} />
                    <CycleScheduleDialog
                        open={scheduleFor !== null}
                        onOpenChange={(o) => !o && setScheduleFor(null)}
                        teamId={scheduleFor?.id ?? ''}
                        teamName={scheduleFor?.name ?? ''}
                    />
                </>
            )}
        </DashboardLayout>
    );
}
