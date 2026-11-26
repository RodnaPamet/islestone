'use client';

/**
 * Settings → Calendar sync (roadmap 3.3b; ADR 0011 §5 and §6; owner decisions
 * 234 and 237): "Allow members to sync their calendars" and, for Microsoft
 * 365, "Authorise Microsoft 365" and "Withdraw" (through the undo toast). It
 * shows how many members are connected, never who. Whether the caller may
 * manage it is asked on the server (`integrations.manage`); without it the
 * page says so and reads nothing.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Card } from '@inflect/ui/components/ui/card';
import { Heading } from '@inflect/ui/components/ui/typography';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Switch } from '@/components/ui/switch';

import { useCalendarSyncSettings } from './use-calendar-sync';

const OUTCOMES = ['consent_granted', 'consent_declined', 'consent_failed'] as const;

export function CalendarSyncSettings({ title, canManage, open, outcome }: { title: string; canManage: boolean; open: boolean; outcome?: string | null }) {
    const t = useTranslations('calendarSync.settings');
    const { data, error, setEnabled, authoriseMicrosoft, withdrawMicrosoft } = useCalendarSyncSettings(canManage && open);
    const [busy, setBusy] = useState(false);
    const shown = OUTCOMES.find((o) => o === outcome);

    return (
        <DashboardLayout header={{ title, description: t('description'), back: { smart: true } }} data-testid="calendar-sync-settings-page">
            {!open && <p className="text-sm text-content-muted">{t('closed')}</p>}
            {open && !canManage && <p className="text-sm text-content-muted">{t('noAccess')}</p>}
            {shown && (
                <p role="status" className="text-sm">
                    {t(`outcome.${shown}`)}
                </p>
            )}
            {error && <p role="alert">{t('loadFailed')}</p>}
            {data && (
                <>
                    <Card as="section" aria-labelledby="calendar-sync-switch-heading" className="space-y-default">
                        <Heading level={2} id="calendar-sync-switch-heading">
                            {t('switchHeading')}
                        </Heading>
                        <div className="flex items-start gap-default">
                            <Switch
                                id="calendar-sync-enabled"
                                checked={data.syncEnabled}
                                disabled={busy}
                                onCheckedChange={(v) => {
                                    setBusy(true);
                                    void setEnabled(v).finally(() => setBusy(false));
                                }}
                                aria-label={t('allow')}
                            />
                            <div>
                                <p className="text-sm font-medium">{t('allow')}</p>
                                <p className="text-xs text-content-muted">{t('allowHelp')}</p>
                            </div>
                        </div>
                        <p className="text-sm">{t('connected', { google: data.google.connected, microsoft: data.microsoft.connected })}</p>
                        {data.removing > 0 && <p className="text-sm text-content-muted">{t('removing', { count: data.removing })}</p>}
                        {!data.google.configured && !data.microsoft.configured && <p className="text-sm text-content-muted">{t('noProvider')}</p>}
                    </Card>
                    {data.microsoft.configured && (
                        <Card as="section" aria-labelledby="calendar-sync-microsoft-heading" className="space-y-default">
                            <Heading level={2} id="calendar-sync-microsoft-heading">
                                {t('microsoftHeading')}
                            </Heading>
                            <p className="text-sm">{data.microsoft.consentGranted ? t('microsoftGranted') : t('microsoftNotGranted')}</p>
                            <p className="text-xs text-content-muted">{t('microsoftHelp')}</p>
                            <div className="flex flex-wrap gap-default">
                                <Button variant={data.microsoft.consentGranted ? 'secondary' : 'primary'} text={t('authorise')} onClick={() => void authoriseMicrosoft()} />
                                {data.microsoft.consentGranted && <Button variant="secondary" text={t('withdraw')} onClick={() => withdrawMicrosoft()} />}
                            </div>
                        </Card>
                    )}
                </>
            )}
        </DashboardLayout>
    );
}
