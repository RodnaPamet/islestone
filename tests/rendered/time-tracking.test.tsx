/** @jest-environment jsdom */

/**
 * Time entries and timers in the browser (sub-phase 3.4b; owner decisions
 * 260 to 267 and 277): the item's Time panel (time spent beside an hours
 * estimate, "Add time" sent as minutes, a delete held behind the undo toast,
 * nothing offered to a caller the server says may not record), My time's
 * week grid (a real grid with a roving tabindex, labelled cells, an empty
 * cell adding time, a single entry changed with `If-Match`), the top
 * chrome's timer with Stop, and no axe violations.
 *
 * Written fresh for Islestone.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/time',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { MyTimeView } from '@/components/time/MyTimeView';
import { TimerChip } from '@/components/time/TimerChip';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { TimePanel } from '@/components/work-items/detail/TimePanel';
import type { TimeEntryData, TimeWeekData, WorkItemTimeData } from '@/lib/time/entries';
import type { TimeAffordances } from '@/lib/time/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const RECORDER: TimeAffordances = { view: true, track: true, approve: false, record: true };

function entry(over: Partial<TimeEntryData> = {}): TimeEntryData {
    return {
        id: 'te-1',
        userId: 'u-ada',
        workItemId: 'wi-1',
        projectId: 'p-1',
        workDate: '2026-11-24',
        minutes: 90,
        source: 'MANUAL',
        billable: false,
        description: null,
        version: 1,
        createdAt: '2026-11-24T10:00:00.000Z',
        updatedAt: '2026-11-24T10:00:00.000Z',
        ...over,
    };
}

function itemTime(over: Partial<WorkItemTimeData> = {}): WorkItemTimeData {
    return {
        workItemId: 'wi-1',
        totalMinutes: 130,
        ownMinutes: 90,
        entries: [
            { ...entry({ id: 'te-2', userId: 'u-bob', minutes: 40, workDate: '2026-11-25', description: 'Reviewed the copy' }), personName: 'Bob' },
            { ...entry(), personName: 'Ada' },
        ],
        pageInfo: { hasNextPage: false },
        viewer: { track: true, viewAll: true },
        ...over,
    };
}

const visible = { kind: 'visible' as const, id: 'wi-1', key: 'ISL-1', title: 'Write the brief', projectId: 'p-1', closed: false };

function week(entries: TimeWeekData['entries']): TimeWeekData {
    const days = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
    return {
        userId: 'u-ada',
        weekStart: '2026-11-23',
        entries,
        dayTotals: days.map((date) => ({ date, minutes: entries.filter((e) => e.workDate === date).reduce((s, e) => s + (e.minutes ?? 0), 0) })),
        totalMinutes: entries.reduce((s, e) => s + (e.minutes ?? 0), 0),
        viewer: { edit: true },
    };
}

/** The week's timesheet read (3.4c): approval off, never submitted, open to edits. */
const openSheet = {
    userId: 'u-ada',
    weekStart: '2026-11-23',
    approvalRequired: false,
    timesheet: null,
    frozen: false,
    timerOn: false,
    sums: { minutes: 0, billableMinutes: 0, entries: 0 },
    viewer: { submit: false, withdraw: false, edit: true },
};

beforeEach(() => {
    __resetPendingUndoToastsForTest();
});

describe("the item's Time panel", () => {
    it('shows time spent beside an hours estimate and the entries, and has no axe violations', async () => {
        installFetch({ 'GET /work-items/wi-1/time': { body: itemTime() }, 'GET /time-entries/timer': { body: { timer: null } } });
        const { container } = renderWorkspace(<TimePanel itemId="wi-1" itemKey="ISL-1" estimateMinutes={480} />);
        expect(await screen.findByTestId('time-summary')).toHaveTextContent('Time spent 2h 10m · Estimate 8h');
        expect(screen.getAllByTestId('time-entry-row')).toHaveLength(2);
        expect(screen.getByText('Reviewed the copy')).toBeInTheDocument();
        // Only one's own entry offers Change and Delete.
        const rows = screen.getAllByTestId('time-entry-row');
        expect(within(rows[0]!).queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(within(rows[1]!).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('adds time typed as a duration, sent as minutes', async () => {
        const { calls } = installFetch({
            'GET /work-items/wi-1/time': { body: itemTime() },
            'GET /time-entries/timer': { body: { timer: null } },
            'POST /time-entries': { status: 201, body: entry({ id: 'te-3', minutes: 75 }) },
        });
        renderWorkspace(<TimePanel itemId="wi-1" itemKey="ISL-1" estimateMinutes={null} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add time' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Time spent' }), { target: { value: '1h 15m' } });
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description (optional)' }), { target: { value: 'Drafted it' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ workItemId: 'wi-1', minutes: 75, billable: false, description: 'Drafted it' });
    });

    it('refuses a duration it cannot read without sending it', async () => {
        const { calls } = installFetch({ 'GET /work-items/wi-1/time': { body: itemTime() }, 'GET /time-entries/timer': { body: { timer: null } } });
        renderWorkspace(<TimePanel itemId="wi-1" itemKey="ISL-1" estimateMinutes={null} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add time' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Time spent' }), { target: { value: '25h' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(/between 1 minute and 24 hours/);
        expect(calls.some((c) => c.method === 'POST')).toBe(false);
    });

    it('deletes through the undo toast: nothing is sent before the window closes', async () => {
        const { calls } = installFetch({
            'GET /work-items/wi-1/time': { body: itemTime() },
            'GET /time-entries/timer': { body: { timer: null } },
            'DELETE /time-entries/te-1': { body: { deleted: true } },
        });
        renderWorkspace(<TimePanel itemId="wi-1" itemKey="ISL-1" estimateMinutes={null} />);
        await screen.findAllByTestId('time-entry-row');
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it("offers nothing to record when the server says so, and shows only one's own time without time.view", async () => {
        installFetch({
            'GET /work-items/wi-1/time': { body: itemTime({ totalMinutes: null, entries: [{ ...entry(), personName: 'Ada' }], viewer: { track: false, viewAll: false } }) },
            'GET /time-entries/timer': { body: { timer: null } },
        });
        renderWorkspace(<TimePanel itemId="wi-1" itemKey="ISL-1" estimateMinutes={null} />);
        expect(await screen.findByTestId('time-summary')).toHaveTextContent('Your time 1h 30m');
        expect(screen.queryByRole('button', { name: 'Add time' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Start timer' })).toBeNull();
    });

    it('starts a timer, then shows it on with Stop', async () => {
        let running = false;
        const timer = { entry: entry({ id: 'te-run', minutes: null, source: 'TIMER' }), timerStartedAt: '2026-11-27T08:00:00.000Z', item: visible, serverNow: '2026-11-27T08:00:00.000Z', stoppedCounting: false };
        const { calls } = installFetch({
            'GET /work-items/wi-1/time': { body: itemTime() },
            'GET /time-entries/timer': () => ({ body: { timer: running ? timer : null } }),
            'POST /time-entries/timer': () => {
                running = true;
                return { status: 201, body: timer };
            },
        });
        renderWorkspace(<TimePanel itemId="wi-1" itemKey="ISL-1" estimateMinutes={null} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Start timer' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ workItemId: 'wi-1' }));
        expect(typeof (calls.find((c) => c.method === 'POST')?.body as { timeZone?: unknown } | undefined)?.timeZone).toBe('string');
        expect(await screen.findByRole('button', { name: 'Stop timer' })).toBeInTheDocument();
    });
});

describe('My time', () => {
    const affordable = (data: TimeWeekData, extra: Parameters<typeof installFetch>[0] = {}) =>
        installFetch({ 'GET /time-entries': { body: data }, 'GET /time-entries/timer': { body: { timer: null } }, 'GET /timesheets/week': { body: openSheet }, ...extra });

    it('is a labelled grid of items and days with totals, and has no axe violations', async () => {
        affordable(week([{ ...entry(), item: visible }, { ...entry({ id: 'te-2', workDate: '2026-11-24', minutes: 30 }), item: visible }, { ...entry({ id: 'te-3', workItemId: null, workDate: '2026-11-26', minutes: 15 }), item: { kind: 'deleted' } }]));
        const { container } = renderWorkspace(<MyTimeView affordances={RECORDER} today="2026-11-27" weekStart="2026-11-23" />);
        const grid = await screen.findByRole('grid', { name: /Your time/ });
        expect(within(grid).getByRole('gridcell', { name: 'ISL-1, Tuesday 24 November, 2h' })).toBeInTheDocument();
        expect(within(grid).getByRole('rowheader', { name: 'Deleted item' })).toBeInTheDocument();
        expect(screen.getByTestId('my-time-week-total')).toHaveTextContent('2h 15m');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('moves between cells with the arrow keys and Home and End', async () => {
        affordable(week([{ ...entry(), item: visible }]));
        renderWorkspace(<MyTimeView affordances={RECORDER} today="2026-11-27" weekStart="2026-11-23" />);
        await screen.findByRole('grid');
        // Today (Friday) is the cell in the tab order.
        const friday = screen.getByTestId('my-time-cell-0-4');
        expect(friday).toHaveAttribute('tabindex', '0');
        friday.focus();
        fireEvent.keyDown(friday, { key: 'ArrowLeft' });
        expect(screen.getByTestId('my-time-cell-0-3')).toHaveFocus();
        fireEvent.keyDown(screen.getByTestId('my-time-cell-0-3'), { key: 'Home' });
        expect(screen.getByTestId('my-time-cell-0-0')).toHaveFocus();
        fireEvent.keyDown(screen.getByTestId('my-time-cell-0-0'), { key: 'End' });
        expect(screen.getByTestId('my-time-cell-0-6')).toHaveFocus();
        expect(screen.getByTestId('my-time-cell-0-6')).toHaveAttribute('tabindex', '0');
    });

    it('adds time from an empty cell for its item and day', async () => {
        const { calls } = affordable(week([{ ...entry(), item: visible }]), { 'POST /time-entries': { status: 201, body: entry({ id: 'te-9', workDate: '2026-11-25', minutes: 45 }) } });
        renderWorkspace(<MyTimeView affordances={RECORDER} today="2026-11-27" weekStart="2026-11-23" />);
        await screen.findByRole('grid');
        const wednesday = screen.getByTestId('my-time-cell-0-2');
        wednesday.focus();
        fireEvent.keyDown(wednesday, { key: 'Enter' });
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Time spent' }), { target: { value: '45m' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ workItemId: 'wi-1', workDate: '2026-11-25', minutes: 45 }));
    });

    it('changes a single entry with If-Match', async () => {
        const { calls } = affordable(week([{ ...entry({ version: 3 }), item: visible }]), { 'PATCH /time-entries/te-1': { body: entry({ minutes: 120, version: 4 }) } });
        renderWorkspace(<MyTimeView affordances={RECORDER} today="2026-11-27" weekStart="2026-11-23" />);
        await screen.findByRole('grid');
        fireEvent.click(screen.getByTestId('my-time-cell-0-1'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('textbox', { name: 'Time spent' })).toHaveValue('1h 30m');
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Time spent' }), { target: { value: '2h' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/time-entries/te-1', ifMatch: '"3"' }));
        expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ minutes: 120 });
    });

    it('offers no writes to a caller who approves weeks but records none', async () => {
        installFetch({ 'GET /time-entries/timer': { body: { timer: null } } });
        renderWorkspace(<MyTimeView affordances={{ view: true, track: false, approve: true, record: false }} today="2026-11-27" weekStart="2026-11-23" />, { role: 'ADMIN' });
        expect(await screen.findByText(/approve weeks but record no time/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add time' })).toBeNull();
    });
});

describe("the top chrome's timer", () => {
    it('shows the running timer with its item and stops it', async () => {
        const timer = { entry: entry({ id: 'te-run', minutes: null, source: 'TIMER' }), timerStartedAt: new Date(Date.now() - 42 * 60_000).toISOString(), item: visible, serverNow: new Date().toISOString(), stoppedCounting: false };
        const { calls } = installFetch({ 'GET /time-entries/timer': { body: { timer } }, 'POST /time-entries/timer/stop': { body: { entry: entry({ id: 'te-run', minutes: 42 }), discarded: false } } });
        renderWorkspace(<TimerChip />, { role: 'MEMBER' });
        const chip = await screen.findByTestId('timer-chip');
        expect(chip).toHaveTextContent('ISL-1');
        await waitFor(() => expect(chip).toHaveTextContent('0:42'));
        fireEvent.click(within(chip).getByRole('button', { name: 'Stop timer' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/time-entries/timer/stop')).toBe(true));
    });

    it('says when a timer stopped counting at 12 hours', async () => {
        const timer = { entry: entry({ id: 'te-run', minutes: null, source: 'TIMER' }), timerStartedAt: new Date(Date.now() - 20 * 3_600_000).toISOString(), item: visible, serverNow: new Date().toISOString(), stoppedCounting: true };
        installFetch({ 'GET /time-entries/timer': { body: { timer } } });
        renderWorkspace(<TimerChip />, { role: 'MEMBER' });
        expect(await screen.findByText('Stopped counting at 12 hours')).toBeInTheDocument();
        expect(screen.getByTestId('timer-chip')).toHaveTextContent('12:00');
    });

    it('reads nothing for a Viewer, who records no time, and renders nothing outside a workspace', async () => {
        const { calls } = installFetch({});
        renderWorkspace(<TimerChip />, { role: 'VIEWER' });
        await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
        });
        expect(calls.some((c) => c.path === '/time-entries/timer')).toBe(false);
        const { container } = render(<TimerChip />);
        expect(container).toBeEmptyDOMElement();
    });
});
