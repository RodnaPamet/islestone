'use client';

/**
 * Settings → Notifications (sub-phase 2.7c; owner decision 136): the
 * workspace's notification settings, over the 1.6 API
 * (`/notification-settings`, `admin.manage`): email on or off, the sender name
 * and address, the BCC mailbox, the kinds muted in-app for everyone, the
 * queued-email counts and "Send queued email now". These are the ceiling
 * members' own preferences show.
 *
 * Whether the member may see and change them is asked on the server
 * (`notificationSettingsAffordances`); without it the page says so and reads
 * nothing.
 *
 * Written fresh for Islestone.
 */
import type { NotificationType } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useSWRConfig } from 'swr';

import { Button } from '@inflect/ui/components/ui/button';
import { Card } from '@inflect/ui/components/ui/card';
import { Heading } from '@inflect/ui/components/ui/typography';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

export const NOTIFICATION_SETTINGS_PATHS = {
    settings: '/notification-settings',
    runJob: '/notification-settings/run-job',
} as const;

type Counts = { pending: number; sent: number; failed: number };
export interface NotificationSettingsView {
    settings: { enabled: boolean; defaultFromName: string; defaultFromEmail: string; bccMailbox: string | null; mutedInAppTypes: NotificationType[] };
    stats: { last24h: Counts; last7d: Counts; last30d: Counts };
    inAppTypes: Array<{ type: NotificationType; title: string; muted: boolean }>;
}

const WINDOWS = ['last24h', 'last7d', 'last30d'] as const;

function refusal(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

export function NotificationSettings({ title, canManage }: { title: string; canManage: boolean }) {
    const t = useTranslations('settings.notifications');
    const tTypes = useTranslations('inbox.types');
    const toast = useToast();
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const { data, error } = useTenantSWR<NotificationSettingsView>(canManage ? NOTIFICATION_SETTINGS_PATHS.settings : null);
    // The sender form's edits; a field not edited shows the stored value.
    const [draft, setDraft] = useState<{ fromName?: string; fromEmail?: string; bcc?: string }>({});
    const [busy, setBusy] = useState(false);
    const fromName = draft.fromName ?? data?.settings.defaultFromName ?? '';
    const fromEmail = draft.fromEmail ?? data?.settings.defaultFromEmail ?? '';
    const bcc = draft.bcc ?? data?.settings.bccMailbox ?? '';
    const setFromName = (v: string) => setDraft((d) => ({ ...d, fromName: v }));
    const setFromEmail = (v: string) => setDraft((d) => ({ ...d, fromEmail: v }));
    const setBcc = (v: string) => setDraft((d) => ({ ...d, bcc: v }));

    const put = async (body: Record<string, unknown>) => {
        setBusy(true);
        try {
            await apiSend('PUT', apiUrl(NOTIFICATION_SETTINGS_PATHS.settings), body);
            setDraft({});
            toast.success(t('saved'));
        } catch (err) {
            toast.error(refusal(err, t('failed')));
        } finally {
            setBusy(false);
            await mutate(apiUrl(NOTIFICATION_SETTINGS_PATHS.settings));
        }
    };

    const sendNow = async () => {
        setBusy(true);
        try {
            const { stats } = await apiSend<{ stats: { sent: number; failed: number; skipped: number } }>('POST', apiUrl(NOTIFICATION_SETTINGS_PATHS.runJob), {
                jobType: 'processOutbox',
            });
            toast.success(t('sendNowDone', { sent: stats.sent, failed: stats.failed, skipped: stats.skipped }));
        } catch (err) {
            toast.error(refusal(err, t('failed')));
        } finally {
            setBusy(false);
            await mutate(apiUrl(NOTIFICATION_SETTINGS_PATHS.settings));
        }
    };

    return (
        <DashboardLayout header={{ title, description: t('description'), back: { smart: true } }} data-testid="notification-settings-page">
            {!canManage && <p className="text-sm text-content-muted">{t('noAccess')}</p>}
            {error && <p role="alert">{refusal(error, t('loadFailed'))}</p>}
            {data && (
                <>
                    <Card as="section" aria-labelledby="notif-email-heading" className="space-y-default">
                        <Heading level={2} id="notif-email-heading">
                            {t('emailHeading')}
                        </Heading>
                        <div className="flex items-start gap-default">
                            <Switch
                                id="notif-email-enabled"
                                checked={data.settings.enabled}
                                disabled={busy}
                                onCheckedChange={(v) => void put({ enabled: v })}
                                aria-label={t('emailEnabled')}
                            />
                            <div>
                                <p className="text-sm font-medium">{t('emailEnabled')}</p>
                                <p className="text-xs text-content-muted">{t('emailEnabledHelp')}</p>
                            </div>
                        </div>
                        <form
                            className="space-y-default"
                            onSubmit={(e) => {
                                e.preventDefault();
                                void put({ defaultFromName: fromName, defaultFromEmail: fromEmail, bccMailbox: bcc.trim() === '' ? null : bcc.trim() });
                            }}
                        >
                            <FormField label={t('fromName')}>
                                <Input id="notif-from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={200} required />
                            </FormField>
                            <FormField label={t('fromEmail')}>
                                <Input id="notif-from-email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} maxLength={320} required />
                            </FormField>
                            <FormField label={t('bcc')} description={t('bccHelp')}>
                                <Input id="notif-bcc" type="email" value={bcc} onChange={(e) => setBcc(e.target.value)} maxLength={320} />
                            </FormField>
                            <Button type="submit" variant="primary" text={t('save')} disabled={busy} />
                        </form>
                    </Card>
                    <Card as="section" aria-labelledby="notif-muted-heading" className="space-y-default">
                        <Heading level={2} id="notif-muted-heading">
                            {t('mutedHeading')}
                        </Heading>
                        <p className="text-sm text-content-muted">{t('mutedHelp')}</p>
                        <ul className="space-y-tight">
                            {data.inAppTypes.map((entry) => {
                                const label = tTypes(entry.type);
                                return (
                                    <li key={entry.type} className="flex items-center gap-default">
                                        <Switch
                                            id={`notif-muted-${entry.type}`}
                                            checked={!entry.muted}
                                            disabled={busy}
                                            onCheckedChange={(on) => {
                                                const muted = new Set(data.settings.mutedInAppTypes);
                                                if (on) muted.delete(entry.type);
                                                else muted.add(entry.type);
                                                void put({ mutedInAppTypes: [...muted] });
                                            }}
                                            aria-label={t('mutedFor', { type: label })}
                                        />
                                        <span className="text-sm">{label}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    </Card>
                    <Card as="section" aria-labelledby="notif-outbox-heading" className="space-y-default">
                        <Heading level={2} id="notif-outbox-heading">
                            {t('outboxHeading')}
                        </Heading>
                        <table className="data-table w-full text-sm">
                            <thead>
                                <tr>
                                    <th scope="col" className="text-left">
                                        {t('outboxCol.window')}
                                    </th>
                                    <th scope="col">{t('outboxCol.pending')}</th>
                                    <th scope="col">{t('outboxCol.sent')}</th>
                                    <th scope="col">{t('outboxCol.failed')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {WINDOWS.map((w) => (
                                    <tr key={w}>
                                        <th scope="row" className="text-left font-normal">
                                            {t(`window.${w}`)}
                                        </th>
                                        <td className="text-center">{data.stats[w].pending}</td>
                                        <td className="text-center">{data.stats[w].sent}</td>
                                        <td className="text-center">{data.stats[w].failed}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Button variant="secondary" text={t('sendNow')} disabled={busy || !data.settings.enabled} onClick={() => void sendNow()} />
                    </Card>
                </>
            )}
        </DashboardLayout>
    );
}
