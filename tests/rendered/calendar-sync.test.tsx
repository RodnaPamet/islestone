/** @jest-environment jsdom */

/**
 * Calendar sync in the browser (roadmap 3.3b; ADR 0011; owner decisions 229,
 * 234, 235 and 237):
 *
 *   - the member's section says what leaves (titles, due dates and links, and
 *     their projects' milestones), offers a provider only where the server
 *     says so, navigates to the provider's URL the connect answers, says a
 *     Viewer's feed is read-only, shows the callback's outcome and a
 *     revoked connection's remedy, and sends Disconnect only when the undo
 *     window closes (Undo sends nothing);
 *   - since 3.3c (decision 232): an editor is told what is read back; a
 *     connection with events deleted in the calendar says how many and offers
 *     "Resync", which sends `{ action: 'resync' }` at once; a deleted Islestone
 *     calendar offers "Recreate" beside Disconnect;
 *   - Settings → Calendar sync turns the switch on, shows counts never
 *     people, starts "Authorise Microsoft 365" and holds "Withdraw" behind the
 *     undo toast; without the key or the operator's switch it reads nothing;
 *   - jest-axe on each.
 *
 * Queries by role and label.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/inbox/preferences',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

const assign = jest.fn();
jest.mock('@/components/calendar-sync/navigate', () => ({ leaveFor: (url: string) => assign(url) }));

import { CalendarSyncSection } from '@/components/calendar-sync/CalendarSyncSection';
import { CalendarSyncSettings } from '@/components/calendar-sync/CalendarSyncSettings';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import type { CalendarSyncSettingsView, MyCalendarSyncView } from '@/lib/calendar-sync/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    assign.mockReset();
});
afterEach(() => __resetPendingUndoToastsForTest());

function mine(over: Partial<MyCalendarSyncView> = {}): MyCalendarSyncView {
    return {
        syncEnabled: true,
        readOnly: false,
        providers: [
            { provider: 'GOOGLE', offered: true, unavailable: null },
            { provider: 'MICROSOFT', offered: false, unavailable: 'MICROSOFT_NOT_AUTHORISED' },
        ],
        connections: [],
        items: { inWindow: 0, limit: 1000 },
        ...over,
    };
}

describe("the member's Calendar sync section", () => {
    it('says what leaves, offers only what the server offers, and leaves for the provider on Connect', async () => {
        const { calls } = installFetch({
            'GET /calendar-sync/connections': { body: mine() },
            'POST /calendar-sync/connect': { body: { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' } },
        });
        const { container } = renderWorkspace(<CalendarSyncSection />);
        expect(await screen.findByText(/Your open items' titles, due dates and links, and your projects' milestones, in a calendar called Islestone/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Connect Outlook Calendar' })).toBeNull();
        expect(screen.getByText(/has not authorised calendar access yet/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Connect Google Calendar' }));
        await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=x'));
        expect(calls.find((c) => c.method === 'POST')?.search.get('provider')).toBe('google');
        expect(await axe(container)).toHaveNoViolations();
    });

    it("says a Viewer's feed is read-only, shows the callback's outcome, a revoked connection's remedy and the cap", async () => {
        installFetch({
            'GET /calendar-sync/connections': {
                body: mine({
                    readOnly: true,
                    connections: [{ provider: 'GOOGLE', state: 'REVOKED', connectedAt: '2026-11-20T08:00:00.000Z', lastSyncedAt: null, revokedReason: 'ACCESS_WITHDRAWN', removedInCalendar: 0 }],
                    items: { inWindow: 1240, limit: 1000 },
                }),
            },
        });
        renderWorkspace(<CalendarSyncSection outcome="declined" />);
        expect(await screen.findByText(/nothing is read back from your calendar/)).toBeInTheDocument();
        expect(screen.queryByText(/changes its due date here, as your own edit/)).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('access was declined at the provider');
        expect(screen.getByText(/Access was withdrawn. Reconnect to resume, or remove the Islestone calendar yourself/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reconnect Google Calendar' })).toBeInTheDocument();
        // The cap is said only for a live connection.
        expect(screen.queryByText(/1000 of 1240/)).toBeNull();
    });

    it('3.3c: tells an editor what is read back, offers Resync with the deleted count, and sends it at once', async () => {
        const connected = mine({ connections: [{ provider: 'GOOGLE', state: 'CONNECTED', connectedAt: '2026-11-20T08:00:00.000Z', lastSyncedAt: null, revokedReason: null, removedInCalendar: 2 }] });
        const { calls } = installFetch({
            'GET /calendar-sync/connections': { body: connected },
            'POST /calendar-sync/connections': { body: { state: 'CONNECTED', resynced: 2 } },
        });
        const { container } = renderWorkspace(<CalendarSyncSection />);
        expect(await screen.findByText(/changes its due date here, as your own edit/)).toBeInTheDocument();
        expect(screen.getByText(/2 events you deleted in your calendar are not put back/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Recreate the Islestone calendar' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Resync Google Calendar' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ action: 'resync' }));
        expect(calls.find((c) => c.method === 'POST')?.search.get('provider')).toBe('google');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('3.3c: a deleted Islestone calendar offers Recreate and Disconnect, not Resync', async () => {
        const removed = mine({ connections: [{ provider: 'GOOGLE', state: 'CALENDAR_REMOVED', connectedAt: '2026-11-20T08:00:00.000Z', lastSyncedAt: null, revokedReason: null, removedInCalendar: 0 }] });
        const { calls } = installFetch({
            'GET /calendar-sync/connections': { body: removed },
            'POST /calendar-sync/connections': { body: { state: 'CONNECTED', resynced: 0 } },
        });
        renderWorkspace(<CalendarSyncSection />);
        expect(await screen.findByText(/The Islestone calendar was deleted from your account, so nothing is synced/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Resync Google Calendar' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Disconnect Google Calendar' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Recreate the Islestone calendar' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ action: 'recreate' }));
    });

    it('sends Disconnect only when the undo window closes; Undo sends nothing', async () => {
        const connected = mine({ connections: [{ provider: 'GOOGLE', state: 'CONNECTED', connectedAt: '2026-11-20T08:00:00.000Z', lastSyncedAt: null, revokedReason: null, removedInCalendar: 0 }], items: { inWindow: 1240, limit: 1000 } });
        const first = installFetch({ 'GET /calendar-sync/connections': { body: connected } });
        renderWorkspace(<CalendarSyncSection />);
        expect(await screen.findByText('1000 of 1240 items are in your calendar: the nearest ones.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect Google Calendar' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        expect(first.calls.some((c) => c.method === 'DELETE')).toBe(false);

        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const { calls } = installFetch({
                'GET /calendar-sync/connections': { body: connected },
                'DELETE /calendar-sync/connections': { body: { state: 'DISCONNECTING' } },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Disconnect Google Calendar' }));
            expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(5_100);
            });
            expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.search.get('provider'))).toEqual(['google']);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('Settings → Calendar sync', () => {
    const VIEW: CalendarSyncSettingsView = {
        syncEnabled: false,
        version: 1,
        google: { configured: true, connected: 3 },
        microsoft: { configured: true, connected: 1, consentGranted: true, consentGrantedAt: '2026-11-20T08:00:00.000Z', consentRevokedAt: null },
        removing: 0,
    };

    it('turns the switch on, shows counts never people, and starts the Microsoft consent', async () => {
        const { calls } = installFetch({
            'GET /calendar-sync/settings': { body: VIEW },
            'PUT /calendar-sync/settings': { body: { ...VIEW, syncEnabled: true } },
            'POST /calendar-sync/microsoft-consent': { body: { consentUrl: 'https://login.microsoftonline.com/organizations/v2.0/adminconsent?state=y' } },
        });
        const { container } = renderWorkspace(<CalendarSyncSettings title="Calendar sync" canManage open outcome="consent_granted" />);
        expect(await screen.findByText('Connected: 3 Google, 1 Outlook.')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Microsoft 365 is authorised');
        fireEvent.click(screen.getByRole('switch', { name: 'Allow members to sync their calendars' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ syncEnabled: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Authorise Microsoft 365' }));
        await waitFor(() => expect(assign).toHaveBeenCalledWith('https://login.microsoftonline.com/organizations/v2.0/adminconsent?state=y'));
        expect(await axe(container)).toHaveNoViolations();
    });

    it('holds Withdraw behind the undo toast', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const { calls } = installFetch({
                'GET /calendar-sync/settings': { body: VIEW },
                'DELETE /calendar-sync/microsoft-consent': { body: { ...VIEW, microsoft: { ...VIEW.microsoft, consentGranted: false } } },
            });
            renderWorkspace(<CalendarSyncSettings title="Calendar sync" canManage open />);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(50);
            });
            fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
            expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(5_100);
            });
            expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/calendar-sync/microsoft-consent']);
        } finally {
            jest.useRealTimers();
        }
    });

    it('reads nothing without the key or the operator switch, and says why', async () => {
        const { calls } = installFetch({});
        renderWorkspace(<CalendarSyncSettings title="Calendar sync" canManage={false} open />);
        expect(screen.getByText('Only Owners and Admins can see and change calendar sync.')).toBeInTheDocument();
        renderWorkspace(<CalendarSyncSettings title="Calendar sync" canManage open={false} />);
        expect(screen.getByText('Calendar sync is not available on this deployment.')).toBeInTheDocument();
        expect(calls).toEqual([]);
    });
});
