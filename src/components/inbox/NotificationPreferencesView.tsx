'use client';

/**
 * Notification preferences (sub-phase 2.7c; owner decision 132): one row per
 * kind of notification, with the bell on or off and email off, at once or in
 * the daily digest. Everything shown comes from the server
 * (`GET /notification-preferences`): the choices each kind offers (at once
 * only for the direct kinds), the member's choice or the default, and where
 * the workspace's settings cap it, as a disabled control with the reason.
 * A change is saved at once (`PUT`), and the grid is read again.
 *
 * Written fresh for Islestone.
 */
import type { EmailDelivery } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useSWRConfig } from 'swr';

import { Button } from '@inflect/ui/components/ui/button';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Combobox } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/hooks';
import { Switch } from '@/components/ui/switch';
import { apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import type { PreferenceRowData, PreferencesData } from '@/lib/notifications/inbox';
import { digestReadsItems } from '@/lib/notifications/preferences';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

import { INBOX_PATHS, inboxRefusal } from './use-inbox';

/** `children`: further sections of the member's own settings (3.3b's Calendar sync), rendered after the table. */
export function NotificationPreferencesView({ children }: { children?: ReactNode } = {}) {
    const t = useTranslations('notificationPreferences');
    const tInbox = useTranslations('inbox');
    const toast = useToast();
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const { data, error } = useTenantSWR<PreferencesData>(INBOX_PATHS.preferences);
    const [saving, setSaving] = useState<string | null>(null);

    const save = async (body: { type: PreferenceRowData['type']; inApp: boolean; email: EmailDelivery } | { type: PreferenceRowData['type']; reset: true }) => {
        setSaving(body.type);
        try {
            const next = await apiSend<PreferencesData>('PUT', apiUrl(INBOX_PATHS.preferences), { rows: [body] });
            await mutate(apiUrl(INBOX_PATHS.preferences), next, { revalidate: false });
            toast.success(t('saved'));
        } catch (err) {
            toast.error(inboxRefusal(err, t('failed')));
            await mutate(apiUrl(INBOX_PATHS.preferences));
        } finally {
            setSaving(null);
        }
    };

    return (
        <DashboardLayout header={{ title: t('title'), description: t('description'), back: { smart: true } }} data-testid="notification-preferences-page">
            {error && <p role="alert">{inboxRefusal(error, t('loadFailed'))}</p>}
            <p className="text-sm text-content-muted">{t('digestHelp')}</p>
            <p className="text-sm text-content-muted">{t('immediateHelp')}</p>
            {data && (
                <table className="data-table w-full text-sm" aria-label={t('tableLabel')}>
                    <thead>
                        <tr>
                            <th scope="col" className="text-left">
                                {t('col.type')}
                            </th>
                            <th scope="col" className="text-left">
                                {t('col.inApp')}
                            </th>
                            <th scope="col" className="text-left">
                                {t('col.email')}
                            </th>
                            <th scope="col">
                                <span className="sr-only">{t('reset')}</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.rows.map((row) => {
                            const label = tInbox(`types.${row.type}`);
                            const busy = saving === row.type;
                            const options = row.emailChoices.map((c) => ({ value: c, label: t(`email.${c}`) }));
                            return (
                                <tr key={row.type} data-testid={`preference-${row.type}`}>
                                    <th scope="row" className="text-left font-medium">
                                        {label}
                                        {row.isDefault && <span className="ml-tight text-xs text-content-muted">({t('defaultMark')})</span>}
                                    </th>
                                    <td>
                                        <Switch
                                            id={`pref-inapp-${row.type}`}
                                            checked={row.effectiveInApp}
                                            disabled={busy || row.inAppCap === 'WORKSPACE_MUTED'}
                                            // The digest lists most kinds from the Inbox: turning the
                                            // bell off turns their daily email off with it.
                                            onCheckedChange={(v) =>
                                                void save({ type: row.type, inApp: v, email: !v && row.email === 'DAILY' && !digestReadsItems(row.type) ? 'OFF' : row.email })
                                            }
                                            aria-label={t('inAppFor', { type: label })}
                                        />
                                        {row.inAppCap && <p className="text-xs text-content-muted">{t(`cap.${row.inAppCap}`)}</p>}
                                    </td>
                                    <td>
                                        <div className="w-48 max-w-full">
                                            <Combobox
                                                id={`pref-email-${row.type}`}
                                                selected={options.find((o) => o.value === (row.emailCap ? row.effectiveEmail : row.email)) ?? null}
                                                setSelected={(o) => o && void save({ type: row.type, inApp: row.inApp, email: o.value as EmailDelivery })}
                                                options={options}
                                                disabled={busy || row.emailCap === 'WORKSPACE_EMAIL_OFF'}
                                                caret
                                                hideSearch
                                                buttonProps={{ 'aria-label': t('emailFor', { type: label }) }}
                                            />
                                        </div>
                                        {row.emailCap && <p className="text-xs text-content-muted">{t(`cap.${row.emailCap}`)}</p>}
                                    </td>
                                    <td>
                                        {!row.isDefault && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                text={t('reset')}
                                                aria-label={t('resetFor', { type: label })}
                                                disabled={busy}
                                                onClick={() => void save({ type: row.type, reset: true })}
                                            />
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
            {children}
        </DashboardLayout>
    );
}
