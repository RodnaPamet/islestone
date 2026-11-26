'use client';

/**
 * Calendar sync's reads and writes in the browser (roadmap 3.3b; ADR 0011).
 * Reads through `useTenantSWR` at the routes' own paths; writes through
 * `apiSend`, then the read again. Connecting and authorising Microsoft 365
 * answer a provider URL the browser navigates to (a top-level navigation, so
 * the CSP is unchanged). Disconnecting and withdrawing the consent remove
 * events from people's calendars, so they go through the undo toast and are
 * sent when its window closes (`tests/guards/undo-toast-coverage.test.ts`).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import type { CalendarConnectionAction, CalendarProviderName, CalendarSyncSettingsView, MyCalendarSyncView } from '@/lib/calendar-sync/types';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

import { leaveFor } from './navigate';

export const CALENDAR_SYNC_PATHS = {
    settings: '/calendar-sync/settings',
    microsoftConsent: '/calendar-sync/microsoft-consent',
    connect: (provider: CalendarProviderName) => `/calendar-sync/connect?provider=${provider === 'GOOGLE' ? 'google' : 'microsoft'}`,
    connections: '/calendar-sync/connections',
    /** One connection of the caller's: DELETE disconnects, POST `{ action }` resyncs or recreates. */
    disconnect: (provider: CalendarProviderName) => `/calendar-sync/connections?provider=${provider === 'GOOGLE' ? 'google' : 'microsoft'}`,
} as const;

function refusal(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

export function useMyCalendarSync() {
    const tMember = useTranslations('calendarSync.member');
    const toast = useToast();
    const apiUrl = useTenantApiUrl();
    const triggerUndo = useToastWithUndo();
    const swr = useTenantSWR<MyCalendarSyncView>(CALENDAR_SYNC_PATHS.connections);

    const connect = useCallback(
        async (provider: CalendarProviderName) => {
            try {
                const { authorizeUrl } = await apiSend<{ authorizeUrl: string }>('POST', apiUrl(CALENDAR_SYNC_PATHS.connect(provider)));
                leaveFor(authorizeUrl);
            } catch (err) {
                toast.error(refusal(err, tMember('connectFailed')));
            }
        },
        [apiUrl, tMember, toast],
    );

    const disconnect = useCallback(
        (provider: CalendarProviderName) => {
            triggerUndo({
                message: tMember('disconnectToast'),
                undoMessage: tMember('undo'),
                action: () => apiSend('DELETE', apiUrl(CALENDAR_SYNC_PATHS.disconnect(provider))),
                onCommit: () => {
                    void swr.mutate();
                },
                onError: (err) => {
                    void swr.mutate();
                    toast.error(refusal(err, tMember('disconnectFailed')));
                },
            });
        },
        [apiUrl, swr, tMember, toast, triggerUndo],
    );

    // "Resync my calendar" and "Recreate" (3.3c, decision 232): sent at once (they put events back, they remove nothing).
    const act = useCallback(
        async (provider: CalendarProviderName, action: CalendarConnectionAction) => {
            try {
                await apiSend('POST', apiUrl(CALENDAR_SYNC_PATHS.disconnect(provider)), { action });
                toast.success(action === 'resync' ? tMember('resyncQueued') : tMember('recreateQueued'));
            } catch (err) {
                toast.error(refusal(err, tMember('actFailed')));
            } finally {
                await swr.mutate();
            }
        },
        [apiUrl, swr, tMember, toast],
    );

    return { ...swr, connect, disconnect, act };
}

export function useCalendarSyncSettings(enabled: boolean) {
    const tSettings = useTranslations('calendarSync.settings');
    const toast = useToast();
    const apiUrl = useTenantApiUrl();
    const triggerUndo = useToastWithUndo();
    const swr = useTenantSWR<CalendarSyncSettingsView>(enabled ? CALENDAR_SYNC_PATHS.settings : null);

    const setEnabled = useCallback(
        async (syncEnabled: boolean) => {
            try {
                await apiSend('PUT', apiUrl(CALENDAR_SYNC_PATHS.settings), { syncEnabled });
                toast.success(syncEnabled ? tSettings('turnedOn') : tSettings('turnedOff'));
            } catch (err) {
                toast.error(refusal(err, tSettings('failed')));
            } finally {
                await swr.mutate();
            }
        },
        [apiUrl, swr, tSettings, toast],
    );

    const authoriseMicrosoft = useCallback(async () => {
        try {
            const { consentUrl } = await apiSend<{ consentUrl: string }>('POST', apiUrl(CALENDAR_SYNC_PATHS.microsoftConsent));
            leaveFor(consentUrl);
        } catch (err) {
            toast.error(refusal(err, tSettings('failed')));
        }
    }, [apiUrl, tSettings, toast]);

    const withdrawMicrosoft = useCallback(() => {
        triggerUndo({
            message: tSettings('withdrawToast'),
            undoMessage: tSettings('undo'),
            action: () => apiSend('DELETE', apiUrl(CALENDAR_SYNC_PATHS.microsoftConsent)),
            onCommit: () => {
                void swr.mutate();
            },
            onError: (err) => {
                void swr.mutate();
                toast.error(refusal(err, tSettings('failed')));
            },
        });
    }, [apiUrl, swr, tSettings, toast, triggerUndo]);

    return { ...swr, setEnabled, authoriseMicrosoft, withdrawMicrosoft };
}
