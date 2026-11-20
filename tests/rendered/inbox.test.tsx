/** @jest-environment jsdom */

/**
 * The Inbox and notification preferences (sub-phase 2.7c; owner decisions
 * 132 and 134):
 *
 *   - the Inbox lists the Unread view first, with the count; the tabs ask the
 *     server for their view; a kind narrows the read; "Mark read" and "Mark
 *     all read" are sent; Done leaves the list at once and is sent only when
 *     the undo window closes, and Undo sends nothing; J moves the selection
 *     and E marks it Done;
 *   - the preferences grid shows what the server resolved: each kind's
 *     choices (at once only where offered), a capped cell disabled with its
 *     reason, a change sent as one row, a reset;
 *   - Settings → Notifications sends a mute and the sender form;
 *   - jest-axe on each.
 *
 * Queries by role and label.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/inbox',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { InboxView } from '@/components/inbox/InboxView';
import { NotificationPreferencesView } from '@/components/inbox/NotificationPreferencesView';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { KeyboardShortcutProvider } from '@/lib/hooks/use-keyboard-shortcut';
import type { NotificationRowData, PreferenceRowData } from '@/lib/notifications/inbox';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    mockPush.mockReset();
});
afterEach(() => __resetPendingUndoToastsForTest());

function note(id: string, over: Partial<NotificationRowData> = {}): NotificationRowData {
    return {
        id,
        type: 'WORK_ITEM_WATCH_UPDATE',
        title: `Note ${id}`,
        body: `ISL-1 "Ship": commented (${id})`,
        read: false,
        readAt: null,
        archivedAt: null,
        linkUrl: `/t/acme/work-items/w-${id}`,
        workItemId: `w-${id}`,
        createdAt: '2030-03-10T08:00:00.000Z',
        ...over,
    };
}

const page = (items: NotificationRowData[], unreadCount = items.filter((i) => !i.read).length) => ({
    body: { items, pageInfo: { hasNextPage: false }, unreadCount },
});

describe('the Inbox', () => {
    it('lists Unread first with the count, and the tabs and the kind ask the server for their view', async () => {
        const { calls } = installFetch({
            'GET /notifications': (req) =>
                req.search.get('view') === 'unread' ? page([note('1'), note('2')]) : page([note('1'), note('3', { read: true })], 2),
        });
        const { container } = renderWorkspace(<InboxView title="Inbox" />);
        const list = await screen.findByRole('list', { name: 'Notifications' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Unread (2)', pressed: true })).toBeInTheDocument();
        expect(calls[0]!.search.get('view')).toBe('unread');

        fireEvent.click(screen.getByRole('button', { name: 'All' }));
        await waitFor(() => expect(calls.some((c) => c.search.get('view') === 'all')).toBe(true));
        expect(await screen.findByText('Note 3')).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('marks one read, and every one read', async () => {
        const { calls } = installFetch({
            'GET /notifications': page([note('1'), note('2')]),
            'PATCH /notifications/1': { body: { updated: 1 } },
            'POST /notifications/bulk': { body: { updated: 2 } },
        });
        renderWorkspace(<InboxView title="Inbox" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Mark read: Note 1' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ read: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ action: 'mark-all-read' }));
    });

    it('opening a row marks it read and follows its link', async () => {
        const { calls } = installFetch({ 'GET /notifications': page([note('1')]), 'PATCH /notifications/1': { body: { updated: 1 } } });
        renderWorkspace(<InboxView title="Inbox" />);
        fireEvent.click(await screen.findByRole('button', { name: /^Unread: Note 1/ }));
        expect(mockPush).toHaveBeenCalledWith('/t/acme/work-items/w-1');
        await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ read: true }));
    });

    it('Done leaves the list at once, and Undo brings it back without sending anything', async () => {
        const { calls } = installFetch({ 'GET /notifications': page([note('1'), note('2')]) });
        renderWorkspace(<InboxView title="Inbox" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Mark as done: Note 1' }));
        await waitFor(() => expect(screen.queryByText('Note 1')).toBeNull());
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        expect(await screen.findByText('Note 1')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    });

    it('sends Done when the window closes; in the list, K selects the row above and E marks it Done', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const { calls } = installFetch({
                'GET /notifications': page([note('1'), note('2')]),
                'PATCH /notifications/1': { body: { updated: 1 } },
            });
            renderWorkspace(
                <KeyboardShortcutProvider>
                    <InboxView title="Inbox" />
                </KeyboardShortcutProvider>,
            );
            await act(async () => {
                await jest.advanceTimersByTimeAsync(50);
            });
            // Focus on the second row selects it; K moves to the first.
            const second = await screen.findByRole('button', { name: /^Unread: Note 2/ });
            act(() => second.focus());
            fireEvent.keyDown(second, { key: 'k' });
            fireEvent.keyDown(document.activeElement ?? second, { key: 'e' });
            expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(5_100);
            });
            expect(calls.filter((c) => c.method === 'PATCH').map((c) => [c.path, c.body])).toEqual([['/notifications/1', { done: true }]]);
        } finally {
            jest.useRealTimers();
        }
    });

    it('says so when the view is empty', async () => {
        installFetch({ 'GET /notifications': page([]) });
        renderWorkspace(<InboxView title="Inbox" />);
        expect(await screen.findByText('Nothing unread. You are all caught up.')).toBeInTheDocument();
    });
});

function pref(type: PreferenceRowData['type'], over: Partial<PreferenceRowData> = {}): PreferenceRowData {
    return {
        type,
        inApp: true,
        email: 'DAILY',
        isDefault: true,
        effectiveInApp: true,
        effectiveEmail: 'DAILY',
        inAppCap: null,
        emailCap: null,
        emailChoices: ['OFF', 'DAILY'],
        ...over,
    };
}

describe('notification preferences', () => {
    const DATA = {
        rows: [
            pref('WORK_ITEM_ASSIGNED', { email: 'IMMEDIATE', effectiveEmail: 'IMMEDIATE', emailChoices: ['OFF', 'IMMEDIATE', 'DAILY'] }),
            pref('WORK_ITEM_WATCH_UPDATE', { isDefault: false, effectiveInApp: false, inAppCap: 'WORKSPACE_MUTED', effectiveEmail: 'OFF', emailCap: 'WORKSPACE_MUTED' }),
        ],
        workspace: { emailEnabled: true, mutedInAppTypes: ['WORK_ITEM_WATCH_UPDATE'] },
    };

    it('shows each kind with its choices, a capped cell disabled with its reason, and sends one row per change', async () => {
        const { calls } = installFetch({ 'GET /notification-preferences': { body: DATA }, 'PUT /notification-preferences': { body: DATA } });
        const { container } = renderWorkspace(<NotificationPreferencesView />);
        const bell = await screen.findByRole('switch', { name: 'Assigned to you: in the Inbox and bell' });
        expect(bell).toBeChecked();
        expect(screen.getByRole('switch', { name: 'Watched work items: in the Inbox and bell' })).toBeDisabled();
        expect(screen.getAllByText('Turned off for the whole workspace by an admin.').length).toBeGreaterThan(0);

        fireEvent.click(bell);
        await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ rows: [{ type: 'WORK_ITEM_ASSIGNED', inApp: false, email: 'IMMEDIATE' }] }));

        fireEvent.click(screen.getByRole('button', { name: 'Watched work items: use the default' }));
        await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')[1]?.body).toEqual({ rows: [{ type: 'WORK_ITEM_WATCH_UPDATE', reset: true }] }));
        expect(await axe(container)).toHaveNoViolations();
    });
});

describe('Settings → Notifications', () => {
    const VIEW = {
        settings: { enabled: true, defaultFromName: 'Acme', defaultFromEmail: 'noreply@acme.test', bccMailbox: null, mutedInAppTypes: [] },
        stats: { last24h: { pending: 1, sent: 2, failed: 0 }, last7d: { pending: 1, sent: 9, failed: 0 }, last30d: { pending: 1, sent: 30, failed: 1 } },
        inAppTypes: [
            { type: 'WORK_ITEM_ASSIGNED', title: 'You were assigned a work item', muted: false },
            { type: 'WORK_ITEM_DUE', title: 'Work item due', muted: false },
        ],
    };

    it('mutes a kind for everyone, saves the sender, and drains the queue', async () => {
        const { calls } = installFetch({
            'GET /notification-settings': { body: VIEW },
            'PUT /notification-settings': { body: VIEW.settings },
            'POST /notification-settings/run-job': { body: { success: true, stats: { sent: 1, failed: 0, skipped: 0 } } },
        });
        const { container } = renderWorkspace(<NotificationSettings title="Notifications" canManage />);
        fireEvent.click(await screen.findByRole('switch', { name: 'Due dates: in the Inbox and bell for everyone' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ mutedInAppTypes: ['WORK_ITEM_DUE'] }));

        fireEvent.change(screen.getByLabelText('BCC mailbox'), { target: { value: 'copy@acme.test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(calls.filter((c) => c.method === 'PUT')[1]?.body).toEqual({ defaultFromName: 'Acme', defaultFromEmail: 'noreply@acme.test', bccMailbox: 'copy@acme.test' }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Send queued email now' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ jobType: 'processOutbox' }));
        expect(await axe(container)).toHaveNoViolations();
    });
});
