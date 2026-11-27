'use client';

/**
 * Settings → Time tracking (sub-phase 3.4c; docs/porting/maps/3.4.md,
 * "Settings → Time tracking"; owner decisions 268 and 269): "Timesheets need
 * approval" (off until an Owner or Admin turns it on) and the workspace
 * recipient list told of submitted weeks (none: every holder of
 * `time.approve`). Turning approval off leaves submitted weeks to be decided.
 *
 * Rates (3.4d; decisions 272 to 274), to a rates holder only (`rates`, asked
 * on the server): the workspace's currency (chosen before the first rate, not
 * changed while rates exist; changed by whoever also manages the workspace),
 * the workspace's rate and its history, and members' rates.
 *
 * The writes are offered when `manage` (`admin.manage`) or `rates`
 * (`time.rates`) is true, asked on the server; nothing here asks a role or a
 * key.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Card } from '@inflect/ui/components/ui/card';
import { Heading } from '@inflect/ui/components/ui/typography';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Combobox } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/hooks';
import { Switch } from '@/components/ui/switch';
import { useAllUsableRecipientLists } from '@/components/recipient-lists/use-recipient-lists';
import { RateHistory, rateToday } from '@/components/time/RateHistory';
import { useBillableRates } from '@/components/time/data/use-time-totals';
import { useTimeSettings, useTimesheetWrites } from '@/components/time/data/use-timesheets';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import { ApiClientError } from '@/lib/data/api-client';
import { formatMoney } from '@/lib/time/money';

/** The currencies `Intl` knows, for the picker. */
function currencyCodes(): string[] {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    return supported ? supported('currency') : ['EUR', 'USD', 'GBP', 'BGN', 'JPY'];
}

export function TimeTrackingSettings({ manage, rates = false }: { manage: boolean; rates?: boolean }) {
    const t = useTranslations('settings.timeTracking');
    const settings = useTimeSettings();
    const lists = useAllUsableRecipientLists(manage);
    const writes = useTimesheetWrites();
    const toast = useToast();
    const data = settings.data;

    const save = async (input: { approvalRequired?: boolean; approvalRecipientListId?: string | null; currency?: string | null }) => {
        if (!data) return;
        const out = await writes.saveSettings(input, data.version);
        if (out instanceof ApiClientError) toast.error(out.message || t('failed'));
        else toast.success(t('saved'));
    };

    const workspaceLists = (lists.data ?? []).filter((l) => l.projectId === null && !l.archived);
    const options = [
        { value: '', label: t('everyApprover') },
        ...workspaceLists.map((l) => ({ value: l.id, label: l.name })),
        ...(data?.approvalRecipientListId && !workspaceLists.some((l) => l.id === data.approvalRecipientListId) ? [{ value: data.approvalRecipientListId, label: t('listArchived') }] : []),
    ];

    return (
        <DashboardLayout header={{ title: t('title'), description: t('description'), back: { smart: true } }} data-testid="time-tracking-settings">
            {!manage && <p className="text-sm text-content-muted">{t('readOnly')}</p>}
            {settings.error && <p role="alert">{t('loadFailed')}</p>}
            {data && (
                <Card as="section" aria-labelledby="time-tracking-timesheets" className="space-y-default">
                    <Heading level={2} id="time-tracking-timesheets">
                        {t('timesheets')}
                    </Heading>
                    <div className="flex items-start justify-between gap-default">
                        <div>
                            <p className="text-sm font-medium text-content-emphasis">{t('approvalRequired')}</p>
                            <p className="text-xs text-content-muted">{t('approvalRequiredHint')}</p>
                        </div>
                        <Switch id="time-approval-required" checked={data.approvalRequired} disabled={!manage} onCheckedChange={(v) => void save({ approvalRequired: v })} aria-label={t('approvalRequired')} />
                    </div>
                    <div className="space-y-tight">
                        <p className="text-sm font-medium text-content-emphasis">{t('whoIsTold')}</p>
                        <p className="text-xs text-content-muted">{t('whoIsToldHint')}</p>
                        <Combobox
                            id="time-approval-list"
                            selected={options.find((o) => o.value === (data.approvalRecipientListId ?? '')) ?? null}
                            setSelected={(o) => manage && o && (o.value || null) !== data.approvalRecipientListId && void save({ approvalRecipientListId: o.value || null })}
                            options={options}
                            disabled={!manage}
                            caret
                            buttonProps={{ 'aria-label': t('whoIsTold') }}
                        />
                    </div>
                </Card>
            )}
            {data && rates && <RatesSettings currency={data.currency} mayChangeCurrency={data.viewer.currency} onCurrency={(c) => void save({ currency: c })} />}
        </DashboardLayout>
    );
}

function RatesSettings({ currency, mayChangeCurrency, onCurrency }: { currency: string | null; mayChangeCurrency: boolean; onCurrency: (code: string) => void }) {
    const tRates = useTranslations('settings.timeTracking');
    const ratesQuery = useBillableRates();
    const { members, byId } = useMembers();
    const [memberId, setMemberId] = useState<string | null>(null);
    const book = ratesQuery.data;
    const hasRates = (book?.rates.length ?? 0) > 0;
    const currencyOptions = currencyCodes().map((c) => ({ value: c, label: c }));
    const memberRates = (book?.rates ?? []).filter((r) => r.level === 'MEMBER');
    const ratedMembers = [...new Set(memberRates.map((r) => r.userId!))];
    const memberOptions = members.map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id }));

    return (
        <Card as="section" aria-labelledby="time-tracking-rates" className="space-y-default" data-testid="time-tracking-rates">
            <Heading level={2} id="time-tracking-rates">
                {tRates('rates')}
            </Heading>
            <p className="text-xs text-content-muted">{tRates('ratesHint')}</p>
            {ratesQuery.error && <p role="alert">{tRates('ratesLoadFailed')}</p>}
            <div className="space-y-tight">
                <p className="text-sm font-medium text-content-emphasis">{tRates('currency')}</p>
                <p className="text-xs text-content-muted">{hasRates ? tRates('currencyFixed') : tRates('currencyHint')}</p>
                <Combobox
                    id="time-currency"
                    selected={currencyOptions.find((o) => o.value === currency) ?? null}
                    setSelected={(o) => o && o.value !== currency && onCurrency(o.value)}
                    options={currencyOptions}
                    disabled={!mayChangeCurrency || hasRates}
                    caret
                    placeholder={tRates('pickCurrency')}
                    buttonProps={{ 'aria-label': tRates('currency') }}
                />
            </div>
            {book && (
                <>
                    <div className="space-y-tight">
                        <Heading level={3}>{tRates('workspaceRate')}</Heading>
                        <RateHistory idPrefix="workspace" scope={{ level: 'WORKSPACE' }} rates={book.rates} currency={currency} today={book.today} label={tRates('theWorkspace')} />
                    </div>
                    <div className="space-y-tight">
                        <Heading level={3}>{tRates('memberRates')}</Heading>
                        <p className="text-xs text-content-muted">{tRates('memberRatesHint')}</p>
                        {ratedMembers.length > 0 && (
                            <ul className="text-sm" aria-label={tRates('memberRates')}>
                                {ratedMembers.map((id) => {
                                    const now = rateToday(memberRates.filter((r) => r.userId === id), book.today);
                                    return (
                                        <li key={id} className="flex justify-between gap-default py-tight">
                                            <span>{memberLabel(byId.get(id)) ?? tRates('formerMember')}</span>
                                            <span className="text-content-muted">
                                                {now ? (now.hourlyRateMinor === null ? tRates('noRate') : currency ? formatMoney(now.hourlyRateMinor, currency) : '') : tRates('notYet')}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        <Combobox
                            id="time-member-rate"
                            selected={memberOptions.find((o) => o.value === memberId) ?? null}
                            setSelected={(o) => setMemberId(o?.value ?? null)}
                            options={memberOptions}
                            caret
                            placeholder={tRates('pickMember')}
                            buttonProps={{ 'aria-label': tRates('pickMember') }}
                        />
                        {memberId && (
                            <RateHistory
                                idPrefix={`member-${memberId}`}
                                scope={{ level: 'MEMBER', userId: memberId }}
                                rates={book.rates}
                                currency={currency}
                                today={book.today}
                                label={memberLabel(byId.get(memberId)) ?? tRates('formerMember')}
                            />
                        )}
                    </div>
                </>
            )}
        </Card>
    );
}
