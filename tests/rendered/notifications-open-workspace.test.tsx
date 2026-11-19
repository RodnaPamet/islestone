/** @jest-environment jsdom */

/**
 * The bell lists the OPEN workspace's notifications, marks them read there,
 * and links to that workspace's Inbox (inflect-compliance #4643).
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (sub-phase 1.7). Islestone has no flat `/api/notifications` route (sub-phase
 * 1.6 ports the workspace routes only), so outside a workspace the bell renders
 * nothing; and the bell links to the Inbox, ADR 0006's view over a member's
 * notifications. The inbox page's cases wait for the Inbox (2.7).
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

let mockParams: Record<string, string> = { tenantSlug: 'acme' };
jest.mock('next/navigation', () => ({
    useParams: () => mockParams,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/t/acme/inbox',
    useSearchParams: () => new URLSearchParams(),
}));

import { NotificationsBell } from '@/components/layout/notifications-bell';
import { MARK_NOTIFICATION_READ_REQUEST } from '@/lib/notifications/mark-read';

const fetchMock = jest.fn();
const ROW = {
    id: 'n1',
    type: 'GENERAL',
    title: 'Review the launch plan',
    body: 'Ada asked for your review.',
    read: false,
    linkUrl: '/t/acme/projects',
    createdAt: new Date().toISOString(),
};
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
    mockParams = { tenantSlug: 'acme' };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ok([ROW]));
    (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});
afterEach(cleanup);

const calledUrls = () => fetchMock.mock.calls.map(([url]) => String(url));

describe('the bell — the open workspace', () => {
    it("lists the open workspace's notifications", async () => {
        render(<NotificationsBell />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(calledUrls()).toContain('/api/t/acme/notifications');
        expect(calledUrls()).not.toContain('/api/notifications');
    });

    it('shows each notification by its title and body', async () => {
        const user = userEvent.setup();
        render(<NotificationsBell />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await user.click(screen.getByRole('button', { name: '1 unread notifications' }));
        const row = await screen.findByTestId('notification-row-n1');
        expect(row.textContent).toContain('Review the launch plan');
        expect(row.textContent).toContain('Ada asked for your review.');
        expect(row.getAttribute('href')).toBe('/t/acme/projects');
    });

    it('marks read in the open workspace, with the request that route accepts', async () => {
        const user = userEvent.setup();
        render(<NotificationsBell />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await user.click(screen.getByTestId('top-chrome-notifications-bell'));
        await user.click(await screen.findByTestId('notifications-mark-all-read'));
        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/t/acme/notifications/n1',
                expect.objectContaining({
                    method: MARK_NOTIFICATION_READ_REQUEST.method,
                    body: MARK_NOTIFICATION_READ_REQUEST.body,
                }),
            ),
        );
    });

    it("links to the workspace's Inbox", async () => {
        const user = userEvent.setup();
        render(<NotificationsBell />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await user.click(screen.getByTestId('top-chrome-notifications-bell'));
        const link = await screen.findByRole('link', { name: 'Open the Inbox' });
        expect(link.getAttribute('href')).toBe('/t/acme/inbox');
    });

    it('renders nothing and fetches nothing outside a workspace', () => {
        mockParams = { orgSlug: 'acme-group' };
        const { container } = render(<NotificationsBell />);
        expect(container.firstChild).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
