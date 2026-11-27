'use client';

/**
 * One scope's billable-rate history (sub-phase 3.4d; owner decisions 272 and
 * 273): the workspace's, a project's or a member's rates, newest first, each
 * in force from its date until the next; "No rate" for a row that says none
 * at this level from its date. A row whose date has not come is removed
 * through the undo toast; a rate is set for a date, replacing that date's
 * row. Shown only to a rates holder: the page decides, never this component.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { Input } from '@/components/ui/input';
import { formatMoney, parseMoney } from '@/lib/time/money';
import type { BillableRateData } from '@/lib/time/totals';

import { useTimeTotalsActions } from './data/use-time-totals';
import { formatDay } from './time-format';

export type RateScope = { level: 'WORKSPACE' } | { level: 'PROJECT'; projectId: string } | { level: 'MEMBER'; userId: string };

function inScope(rate: BillableRateData, scope: RateScope): boolean {
    if (rate.level !== scope.level) return false;
    if (scope.level === 'PROJECT') return rate.projectId === scope.projectId;
    if (scope.level === 'MEMBER') return rate.userId === scope.userId;
    return true;
}

/** The rate in force today among `rates` of one scope, or undefined. */
export function rateToday(rates: readonly BillableRateData[], today: string): BillableRateData | undefined {
    return [...rates].filter((r) => r.effectiveFrom <= today).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
}

export function RateHistory({
    idPrefix,
    scope,
    rates,
    currency,
    today,
    label,
}: {
    idPrefix: string;
    scope: RateScope;
    rates: readonly BillableRateData[];
    currency: string | null;
    today: string;
    /** What the rates are of, for the list's and the form's names. */
    label: string;
}) {
    const t = useTranslations('time.rates');
    const actions = useTimeTotalsActions();
    const mine = rates.filter((r) => inScope(r, scope)).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    const [date, setDate] = useState(today);
    const [amount, setAmount] = useState('');
    const [none, setNone] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!currency) return setError(t('currencyFirst'));
        if (!date) return setError(t('pickDate'));
        const minor = none ? null : parseMoney(amount, currency);
        if (!none && minor === null) return setError(t('invalidAmount'));
        setSaving(true);
        const out = await actions.setRate(scope, { effectiveFrom: date, hourlyRateMinor: minor });
        setSaving(false);
        if (out instanceof Error) return setError((out as { reason?: string }).reason ?? t('failed'));
        setError(null);
        setAmount('');
        setNone(false);
    };

    return (
        <div className="space-y-tight" data-testid={`${idPrefix}-rates`}>
            {mine.length === 0 ? (
                <p className="text-sm text-content-muted">{t('none')}</p>
            ) : (
                <ul className="divide-y divide-border-subtle" aria-label={t('historyOf', { of: label })}>
                    {mine.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-default py-tight text-sm">
                            <span>
                                {t('fromDate', { date: formatDay(r.effectiveFrom, 'dateYear') })}
                                {': '}
                                <span className="font-medium text-content-emphasis">
                                    {r.hourlyRateMinor === null ? t('noRate') : currency ? t('perHour', { amount: formatMoney(r.hourlyRateMinor, currency) }) : String(r.hourlyRateMinor)}
                                </span>
                            </span>
                            {r.removable && <Button variant="ghost" size="sm" text={t('remove')} aria-label={t('removeFrom', { date: formatDay(r.effectiveFrom, 'dateYear') })} onClick={() => actions.removeRate(r)} />}
                        </li>
                    ))}
                </ul>
            )}
            <form onSubmit={submit} className="flex flex-wrap items-end gap-default" aria-label={t('setFor', { of: label })}>
                <label className="flex flex-col gap-tight text-xs text-content-muted" htmlFor={`${idPrefix}-rate-date`}>
                    {t('from')}
                    <DatePicker id={`${idPrefix}-rate-date`} value={parseYMD(date)} onChange={(d) => setDate(toYMD(d) ?? '')} />
                </label>
                <label className="flex flex-col gap-tight text-xs text-content-muted" htmlFor={`${idPrefix}-rate-amount`}>
                    {currency ? t('hourlyRateIn', { currency }) : t('hourlyRate')}
                    <Input id={`${idPrefix}-rate-amount`} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={none} inputMode="decimal" autoComplete="off" />
                </label>
                <label className="flex items-center gap-tight text-sm" htmlFor={`${idPrefix}-rate-none`}>
                    <Checkbox id={`${idPrefix}-rate-none`} checked={none} onCheckedChange={(c) => setNone(c === true)} />
                    {t('noRateFrom')}
                </label>
                <Button id={`${idPrefix}-rate-save`} type="submit" variant="secondary" size="sm" text={t('set')} loading={saving} disabled={!currency} />
            </form>
            {error && (
                <p role="alert" className="text-sm text-content-error">
                    {error}
                </p>
            )}
        </div>
    );
}
