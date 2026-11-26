'use client';

/**
 * The member's own "Calendar sync" section on Inbox → Notification
 * preferences (roadmap 3.3b; ADR 0011 §5; owner decisions 229, 235 and 239).
 * It says what leaves (titles, due dates and links of the member's open
 * items, and their projects' milestones, in a calendar called Islestone),
 * offers "Connect Google Calendar" / "Connect Outlook Calendar" where the
 * server says a provider is offered, shows each connection's state and
 * offers Disconnect (through the undo toast). A Viewer's feed is read-only
 * and says so. Since 3.3c (decision 232): "Resync my calendar" puts back the
 * events the member deleted in their calendar, and a deleted Islestone
 * calendar offers "Recreate" beside Disconnect. The page shows the section only to a caller the server
 * admits (`work_items.view`, the deployment switch open).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';

import { Button } from '@inflect/ui/components/ui/button';
import { Card } from '@inflect/ui/components/ui/card';
import { Heading } from '@inflect/ui/components/ui/typography';
import type { CalendarProviderName } from '@/lib/calendar-sync/types';

import { useMyCalendarSync } from './use-calendar-sync';

const OUTCOMES = ['connected', 'declined', 'failed', 'sync_off', 'not_authorised', 'no_refresh_token', 'refused'] as const;
type Outcome = (typeof OUTCOMES)[number];

export function CalendarSyncSection({ outcome }: { outcome?: string | null }) {
    const t = useTranslations('calendarSync.member');
    const { data, error, connect, disconnect, act } = useMyCalendarSync();
    const shown = OUTCOMES.find((o) => o === outcome) as Outcome | undefined;
    const name = (p: CalendarProviderName) => (p === 'GOOGLE' ? t('google') : t('microsoft'));

    return (
        <Card as="section" aria-labelledby="calendar-sync-heading" className="space-y-default" data-testid="calendar-sync-section">
            <Heading level={2} id="calendar-sync-heading">
                {t('heading')}
            </Heading>
            <p className="text-sm">{t('whatLeaves')}</p>
            {shown && (
                <p role="status" className="text-sm">
                    {t(`outcome.${shown}`)}
                </p>
            )}
            {error && <p role="alert">{t('loadFailed')}</p>}
            {data && (
                <>
                    {!data.syncEnabled && <p className="text-sm text-content-muted">{t('syncOff')}</p>}
                    {data.readOnly ? <p className="text-sm text-content-muted">{t('readOnly')}</p> : <p className="text-sm text-content-muted">{t('readBack')}</p>}
                    <ul className="space-y-default">
                        {data.providers.map(({ provider, offered, unavailable }) => {
                            const connection = data.connections.find((c) => c.provider === provider);
                            return (
                                <li key={provider} className="space-y-tight">
                                    <p className="text-sm font-medium">{name(provider)}</p>
                                    {connection ? (
                                        <>
                                            <p className="text-sm">{t(`state.${connection.state}`)}</p>
                                            {connection.state === 'REVOKED' && <p className="text-sm text-content-muted">{t('revokedHelp')}</p>}
                                            {connection.state === 'CALENDAR_REMOVED' && <p className="text-sm text-content-muted">{t('calendarRemovedHelp')}</p>}
                                            {connection.state === 'CONNECTED' && connection.removedInCalendar > 0 && (
                                                <p className="text-sm text-content-muted">{t('removedInCalendar', { count: connection.removedInCalendar })}</p>
                                            )}
                                            {connection.state === 'CONNECTED' && data.items.inWindow > data.items.limit && (
                                                <p className="text-sm text-content-muted">{t('capped', { limit: data.items.limit, count: data.items.inWindow })}</p>
                                            )}
                                            <div className="flex flex-wrap gap-default">
                                                {connection.state === 'REVOKED' && offered && (
                                                    <Button variant="secondary" text={t('reconnect', { provider: name(provider) })} onClick={() => void connect(provider)} />
                                                )}
                                                {connection.state === 'CALENDAR_REMOVED' && offered && (
                                                    <Button variant="secondary" text={t('recreate', { provider: name(provider) })} onClick={() => void act(provider, 'recreate')} />
                                                )}
                                                {connection.state === 'CONNECTED' && offered && (
                                                    <Button variant="secondary" text={t('resync', { provider: name(provider) })} onClick={() => void act(provider, 'resync')} />
                                                )}
                                                {connection.state !== 'DISCONNECTING' && (
                                                    <Button variant="secondary" text={t('disconnect', { provider: name(provider) })} onClick={() => disconnect(provider)} />
                                                )}
                                            </div>
                                            {provider === 'GOOGLE' && connection.state !== 'DISCONNECTING' && <p className="text-xs text-content-muted">{t('googleRemoval')}</p>}
                                        </>
                                    ) : offered ? (
                                        <Button variant="primary" text={t('connect', { provider: name(provider) })} onClick={() => void connect(provider)} />
                                    ) : (
                                        unavailable && unavailable !== 'SYNC_OFF' && <p className="text-sm text-content-muted">{t(`unavailable.${unavailable}`)}</p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </Card>
    );
}
