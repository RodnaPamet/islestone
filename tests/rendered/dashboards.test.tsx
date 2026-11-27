/** @jest-environment jsdom */

/**
 * Dashboards in the browser (sub-phase 3.6d; docs/porting/maps/3.6.md,
 * "Editing"; owner decisions 326 to 328): edit mode offered only on the
 * server's `viewer.change`; "Add widget" sending the whole list with the
 * dashboard's version as `If-Match`; a widget's settings; a widget's removal
 * through the undo toast (Undo sends nothing, the window's close sends the
 * list without it); a version conflict showing the server's layout and
 * saying it was changed by someone else; "Customise" saving a personal copy of the
 * default and opening it in edit mode; a widget saved in an unreadable form
 * saying so; a dashboard one may not change offering neither Edit nor
 * Delete; a cycle window naming a team with no current cycle; and no axe
 * violations in edit mode. visx's `ParentSize` measures nothing in jsdom.
 *
 * Written fresh for Islestone.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/analytics',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { DashboardView } from '@/components/analytics/dashboard/DashboardView';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import type { DashboardData, DashboardWidgetData } from '@/lib/analytics/dashboard';
import { DEFAULT_DASHBOARD } from '@/lib/analytics/default-dashboard';
import type { CountsResponse } from '@/lib/analytics/types';

import { CONFIG, installFetch, renderWorkspace } from '../helpers/work-items-harness';

const PAGE = { createPersonal: true, createShared: true };
const frame = { from: '2026-09-07', to: '2026-11-27', asOf: '2026-11-27', timeZone: 'UTC', calendarTeamId: null, setAside: [] };
const counts: CountsResponse = { ...frame, open: 5, started: 2, doneInWindow: 9, createdInWindow: 4 };

const countsWidget: DashboardWidgetData = {
    id: 'w-counts',
    type: 'COUNTS',
    title: 'Open work',
    shape: { type: 'COUNTS', config: { scope: { filters: { projectId: ['proj-1'] } }, window: { kind: 'weeks', weeks: 12 } } },
    position: { x: 0, y: 0 },
    size: { w: 12, h: 3 },
};

function dashboard(over: Partial<DashboardData> = {}): DashboardData {
    return {
        id: 'd1',
        name: 'Team health',
        visibility: 'PERSONAL',
        version: 3,
        mine: true,
        createdByFormerMember: false,
        updatedAt: '2026-11-27T08:00:00.000Z',
        widgets: [countsWidget],
        viewer: { change: true, delete: true, share: true },
        ...over,
    };
}

const LIST = { dashboards: [], truncated: false, default: DEFAULT_DASHBOARD };

beforeEach(() => {
    push.mockReset();
    __resetPendingUndoToastsForTest();
    window.localStorage.clear();
});
afterEach(() => __resetPendingUndoToastsForTest());

describe('a dashboard', () => {
    it('adds a widget in edit mode, sending the whole list with the version as If-Match, and has no axe violations', async () => {
        const { calls } = installFetch({
            'GET /dashboards': { body: LIST },
            'GET /analytics/counts': { body: counts },
            'PUT /dashboards/d1/widgets': (rec) => ({
                body: dashboard({ version: 4, widgets: [countsWidget, { ...(rec.body as { widgets: DashboardWidgetData[] }).widgets[1]!, id: 'w-new', shape: null } as DashboardWidgetData] }),
            }),
        });
        const { container } = renderWorkspace(<DashboardView dashboard={dashboard()} affordances={PAGE} today="2026-11-27" />);
        const widget = await screen.findByRole('region', { name: 'Open work' });
        expect(within(widget).getByText('Last 12 weeks, 1 filter')).toBeInTheDocument();
        expect(await within(widget).findByTestId('analytics-count-done')).toHaveTextContent('9');
        // The read is the widget's own scope and window.
        const read = calls.find((c) => c.path === '/analytics/counts')!;
        expect([read.search.get('projectId'), read.search.get('from'), read.search.get('to')]).toEqual(['proj-1', '2026-09-05', '2026-11-27']);

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.getByRole('button', { name: 'Settings of Open work' })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();

        fireEvent.click(screen.getByRole('button', { name: 'Add widget' }));
        const dialog = await screen.findByTestId('widget-picker');
        fireEvent.click(within(dialog).getByRole('radio', { name: '4 weeks' }));
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Day' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Add widget' }).at(-1)!);
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.ifMatch).toBe('"3"');
        const sent = (put.body as { widgets: Array<Record<string, unknown>> }).widgets;
        expect(sent).toHaveLength(2);
        expect(sent[0]).toEqual(expect.objectContaining({ id: 'w-counts', type: 'COUNTS' }));
        expect(sent[1]).toEqual(
            expect.objectContaining({
                type: 'THROUGHPUT',
                config: { scope: { filters: {} }, window: { kind: 'weeks', weeks: 4 }, bin: 'day' },
                // Below every widget there is.
                position: { x: 0, y: 3 },
            }),
        );
    });

    it('removes a widget through the undo toast: Undo sends nothing; the window closing sends the list without it', async () => {
        const first = installFetch({ 'GET /dashboards': { body: LIST }, 'GET /analytics/counts': { body: counts } });
        renderWorkspace(<DashboardView dashboard={dashboard()} affordances={PAGE} today="2026-11-27" startEditing />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remove Open work' }));
        expect(screen.queryByRole('region', { name: 'Open work' })).not.toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        expect(await screen.findByRole('region', { name: 'Open work' })).toBeInTheDocument();
        expect(first.calls.some((c) => c.method === 'PUT')).toBe(false);

        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const { calls } = installFetch({ 'GET /dashboards': { body: LIST }, 'GET /analytics/counts': { body: counts }, 'PUT /dashboards/d1/widgets': { body: dashboard({ version: 4, widgets: [] }) } });
            fireEvent.click(screen.getByRole('button', { name: 'Remove Open work' }));
            expect(calls.some((c) => c.method === 'PUT')).toBe(false);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(5_100);
            });
            const put = calls.filter((c) => c.method === 'PUT');
            expect(put).toHaveLength(1);
            expect(put[0]!.body).toEqual({ widgets: [] });
            expect(put[0]!.ifMatch).toBe('"3"');
        } finally {
            jest.useRealTimers();
        }
    });

    it("shows the server's layout and says so when the dashboard changed elsewhere", async () => {
        const server = dashboard({ version: 7, widgets: [{ ...countsWidget, id: 'w-other', title: 'Their figures' }] });
        installFetch({
            'GET /dashboards': { body: LIST },
            'GET /analytics/counts': { body: counts },
            'PUT /dashboards/d1/widgets': { status: 409, body: { error: { code: 'CONFLICT', message: 'Changed', details: { reason: 'VERSION_CONFLICT', version: 7, dashboard: server } } } },
        });
        renderWorkspace(<DashboardView dashboard={dashboard()} affordances={PAGE} today="2026-11-27" startEditing />);
        fireEvent.click(await screen.findByRole('button', { name: 'Settings of Open work' }));
        const dialog = await screen.findByTestId('widget-picker');
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'Renamed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        // The dialog says so, and keeps the person's text; closed, the page shows the server's layout.
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('This dashboard was changed by someone else; it shows their version now.');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(await screen.findByRole('region', { name: 'Their figures' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Open work' })).not.toBeInTheDocument();
    });

    it('offers neither Edit nor Delete on a dashboard the viewer may not change, and Duplicate saves a personal copy', async () => {
        const { calls } = installFetch({
            'GET /dashboards': { body: LIST },
            'GET /analytics/counts': { body: counts },
            'POST /dashboards': { status: 201, body: dashboard({ id: 'd-copy', name: 'Team health (copy)' }) },
        });
        renderWorkspace(<DashboardView dashboard={dashboard({ visibility: 'SHARED', mine: false, viewer: { change: false, delete: false, share: false } })} affordances={{ createPersonal: true, createShared: false }} today="2026-11-27" />);
        await screen.findByRole('region', { name: 'Open work' });
        expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete dashboard' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
        await waitFor(() => expect(push).toHaveBeenCalledWith('/t/acme/analytics/dashboards/d-copy?edit=1'));
        const post = calls.find((c) => c.method === 'POST')!;
        expect(post.body).toEqual(expect.objectContaining({ name: 'Team health (copy)', visibility: 'PERSONAL' }));
        expect((post.body as { widgets: unknown[] }).widgets).toEqual([expect.not.objectContaining({ id: expect.anything() })]);
    });

    it('says a widget saved in an unreadable form cannot be read, and a cycle window with no current cycle has none', async () => {
        installFetch({ 'GET /dashboards': { body: LIST } });
        const unreadable: DashboardWidgetData = { ...countsWidget, id: 'w-old', title: null, type: 'BURN_UP', shape: null };
        const cycle: DashboardWidgetData = { ...countsWidget, id: 'w-cycle', title: 'This cycle', shape: { type: 'COUNTS', config: { scope: { filters: {} }, window: { kind: 'cycle', teamId: 'team-1' } } } };
        renderWorkspace(<DashboardView dashboard={dashboard({ widgets: [unreadable, cycle] })} affordances={PAGE} today="2026-11-27" />);
        expect(within(await screen.findByRole('region', { name: 'Burn-up' })).getByText(/saved in a form this version cannot read/)).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'This cycle' })).getByText('Core has no current cycle.')).toBeInTheDocument();
    });

    it('reads a cycle window as the team’s current cycle up to today', async () => {
        const { calls } = installFetch({ 'GET /dashboards': { body: LIST }, 'GET /analytics/counts': { body: counts } });
        const cycle: DashboardWidgetData = { ...countsWidget, id: 'w-cycle', title: 'This cycle', shape: { type: 'COUNTS', config: { scope: { filters: {} }, window: { kind: 'cycle', teamId: 'team-1' } } } };
        renderWorkspace(<DashboardView dashboard={dashboard({ widgets: [cycle] })} affordances={PAGE} today="2026-11-27" />, {
            config: { ...CONFIG, cycles: [{ id: 'c1', teamId: 'team-1', number: 4, name: null, startsOn: '2026-11-16', endsOn: '2026-11-29', status: 'current' }] },
        });
        expect(await screen.findByText('Current cycle of Core, all the work you can see')).toBeInTheDocument();
        await waitFor(() => expect(calls.some((c) => c.path === '/analytics/counts')).toBe(true));
        const read = calls.find((c) => c.path === '/analytics/counts')!;
        expect([read.search.get('from'), read.search.get('to')]).toEqual(['2026-11-16', '2026-11-27']);
    });
});

describe('the default dashboard', () => {
    it('saves a personal copy with Customise and opens it in edit mode', async () => {
        const { calls } = installFetch({ 'GET /dashboards': { body: LIST }, 'POST /dashboards': { status: 201, body: dashboard({ id: 'd-mine', name: 'My dashboard', widgets: DEFAULT_DASHBOARD.widgets }) } });
        renderWorkspace(<DashboardView dashboard={null} affordances={PAGE} today="2026-11-27" />);
        expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Customise' }));
        await waitFor(() => expect(push).toHaveBeenCalledWith('/t/acme/analytics/dashboards/d-mine?edit=1'));
        const post = calls.find((c) => c.method === 'POST')!;
        expect(post.body).toEqual(expect.objectContaining({ name: 'My dashboard', visibility: 'PERSONAL' }));
        expect((post.body as { widgets: Array<{ type: string }> }).widgets.map((w) => w.type)).toEqual(['COUNTS', 'THROUGHPUT', 'CYCLE_TIME', 'LEAD_TIME', 'CUMULATIVE_FLOW', 'BURN_UP', 'TIME_WAITING']);
    });

    it('offers no Customise to a viewer who may keep no dashboard', () => {
        installFetch({ 'GET /dashboards': { body: LIST } });
        renderWorkspace(<DashboardView dashboard={null} affordances={{ createPersonal: false, createShared: false }} today="2026-11-27" />);
        expect(screen.queryByRole('button', { name: 'Customise' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'New dashboard' })).not.toBeInTheDocument();
    });
});
