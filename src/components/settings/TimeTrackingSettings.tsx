'use client';

/**
 * Settings → Time tracking (sub-phase 3.4c; docs/porting/maps/3.4.md,
 * "Settings → Time tracking"; owner decisions 268 and 269): "Timesheets need
 * approval" (off until an Owner or Admin turns it on) and the workspace
 * recipient list told of submitted weeks (none: every holder of
 * `time.approve`). Turning approval off leaves submitted weeks to be decided.
 * 3.4d adds the currency and the rates here.
 *
 * The write is offered when `manage` is true (`admin.manage`, asked on the
 * server); nothing here asks a role or a key.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';

import { Card } from '@inflect/ui/components/ui/card';
import { Heading } from '@inflect/ui/components/ui/typography';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Combobox } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/hooks';
import { Switch } from '@/components/ui/switch';
import { useAllUsableRecipientLists } from '@/components/recipient-lists/use-recipient-lists';
import { useTimeSettings, useTimesheetWrites } from '@/components/time/data/use-timesheets';
import { ApiClientError } from '@/lib/data/api-client';

export function TimeTrackingSettings({ manage }: { manage: boolean }) {
    const t = useTranslations('settings.timeTracking');
    const settings = useTimeSettings();
    const lists = useAllUsableRecipientLists(manage);
    const writes = useTimesheetWrites();
    const toast = useToast();
    const data = settings.data;

    const save = async (input: { approvalRequired?: boolean; approvalRecipientListId?: string | null }) => {
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
        </DashboardLayout>
    );
}
