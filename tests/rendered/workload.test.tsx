/** @jest-environment jsdom */

/**
 * Capacity and time off in the browser (sub-phase 3.5a; owner decisions 284
 * to 288, 297, 298 and 303): the Workload page's capacity grid (a real grid
 * with a roving tabindex and labelled cells), "My capacity and time off"
 * (the person's dates with their type, "Add time off" previewing the working
 * days and sending one batch with the versions of the dates it replaces, a
 * date changed in place, a removal held behind the undo toast), nothing
 * offered to a caller the server says may not write, a colleague's dates
 * without a type, Settings → Workload's members table and capacity dialog,
 * and no axe violations.
 *
 * Written fresh for Islestone.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/workload',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { TimeOffCalendar } from '@/components/workload/TimeOffCalendar';
import { WorkloadSettings } from '@/components/workload/WorkloadSettings';
import { WorkloadView } from '@/components/workload/WorkloadView';
import type { TimeOffDayData, WorkloadData, WorkloadMembersData } from '@/lib/workload/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const ALL = { view: true, recordOwnTimeOff: true, manage: true };

const workload: WorkloadData = {
    weeks: ['2026-11-23', '2026-11-30'],
    today: '2026-11-27',
    timeZone: 'Europe/Sofia',
    people: [
        { userId: 'u-ada', name: 'Ada', active: true, capacity: [2400, 1920], weeklyMinutes: [2400, 2400], timeOffMinutes: [0, 480], timeOffDays: [[], ['2026-12-01']] },
        { userId: 'u-bob', name: 'Bob', active: true, capacity: [1440, 1440], weeklyMinutes: [1440, 1440], timeOffMinutes: [0, 0], timeOffDays: [[], []] },
    ],
};

function day(over: Partial<TimeOffDayData> = {}): TimeOffDayData {
    return { userId: 'u-ada', day: '2026-11-26', minutes: null, version: 1, updatedByUserId: 'u-ada', type: 'SICK', ...over };
}

function timeOffAnswer(days: TimeOffDayData[], typeShown = true) {
    return (rec: { search: URLSearchParams }) => {
        const from = rec.search.get('from')!;
        const to = rec.search.get('to')!;
        return {
            body: {
                userId: rec.search.get('userId') ?? 'u-ada',
                from,
                to,
                typeShown,
                days: days.filter((d) => d.day >= from && d.day <= to),
                calendar: { workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-12-02'] },
            },
        };
    };
}

const capacity = { body: { userId: 'u-ada', defaultWeeklyMinutes: 2400, currentWeek: '2026-11-23', rows: [] } };

beforeEach(() => {
    __resetPendingUndoToastsForTest();
});

describe('the Workload page', () => {
    it('shows capacity by week in a labelled grid, moves focus by arrow keys, and has no axe violations', async () => {
        installFetch({ 'GET /workload': { body: workload }, 'GET /time-off': timeOffAnswer([day()]), 'GET /members/u-ada/capacity': capacity });
        const { container } = renderWorkspace(<WorkloadView affordances={ALL} userId="u-ada" today="2026-11-27" />);
        const grid = await screen.findByRole('grid', { name: /Capacity by week/ });
        const first = within(grid).getByRole('gridcell', { name: 'Ada, week of 23 Nov 2026: 40h capacity of 40h a week' });
        expect(first).toHaveAttribute('tabindex', '0');
        const off = within(grid).getByRole('gridcell', { name: 'Ada, week of 30 Nov 2026: 32h capacity of 40h a week; time off on 1 day, 8h' });
        expect(off).toHaveTextContent('Time off 8h');
        act(() => first.focus());
        fireEvent.keyDown(first, { key: 'ArrowRight' });
        expect(off).toHaveFocus();
        fireEvent.keyDown(off, { key: 'ArrowDown' });
        expect(within(grid).getByRole('gridcell', { name: /^Bob, week of 30 Nov 2026/ })).toHaveFocus();
        expect(await screen.findByTestId('my-capacity')).toHaveTextContent("40h a week (the workspace's default)");
        expect(await axe(container)).toHaveNoViolations();
    });

    it("shows the person's own dates with their type", async () => {
        installFetch({ 'GET /time-off': timeOffAnswer([day(), day({ day: '2026-11-25', minutes: 240, type: 'VACATION' })]) });
        const { container } = renderWorkspace(<TimeOffCalendar personId="u-ada" today="2026-11-27" canWrite idPrefix="t" />);
        const grid = await screen.findByRole('grid', { name: 'Time off in November 2026' });
        await waitFor(() => expect(within(grid).getByRole('gridcell', { name: 'Thursday 26 November: time off, Whole day, Sick' })).toBeInTheDocument());
        expect(within(grid).getByRole('gridcell', { name: 'Wednesday 25 November: time off, 4h, Vacation' })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });

    it("shows a colleague's dates and hours without a type, and offers no writes", async () => {
        installFetch({ 'GET /time-off': timeOffAnswer([day({ userId: 'u-bob', type: undefined })], false) });
        renderWorkspace(<TimeOffCalendar userId="u-bob" personId="u-bob" today="2026-11-27" canWrite={false} idPrefix="t" />);
        const cell = await screen.findByRole('gridcell', { name: 'Thursday 26 November: time off, Whole day' });
        expect(cell).not.toHaveTextContent('Sick');
        expect(screen.queryByRole('button', { name: 'Add time off' })).toBeNull();
        fireEvent.click(cell);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('adds time off over a range: previews the working days and sends one batch with the replaced date\'s version', async () => {
        const { calls } = installFetch({
            'GET /time-off': timeOffAnswer([day({ day: '2026-11-27', version: 3, minutes: 120, type: 'OTHER' })]),
            'PUT /time-off/days': { body: { userId: 'u-ada', days: [], removed: [] } },
        });
        renderWorkspace(<TimeOffCalendar personId="u-ada" today="2026-11-27" canWrite idPrefix="t" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add time off' }));
        const dialog = await screen.findByRole('dialog');
        // Opened on today, Friday 27 November, a date that already holds time off.
        await waitFor(() => expect(within(dialog).getByTestId('time-off-preview')).toHaveTextContent('Friday 27 Novemberreplaces 2h'));
        expect(within(dialog).getByText('Replaces the time off already on 1 date.')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Sick' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.path).toBe('/time-off/days');
        expect(put.body).toEqual({ days: [{ day: '2026-11-27', minutes: null, type: 'SICK', version: 3 }] });
    });

    it('changes one date in place under its version, and removes it through the undo toast', async () => {
        const { calls } = installFetch({
            'GET /time-off': timeOffAnswer([day({ version: 2 })]),
            'PUT /time-off/days': { body: { userId: 'u-ada', days: [], removed: [] } },
            'POST /time-off/days/remove': { body: { userId: 'u-ada', days: [], removed: ['2026-11-26'] } },
        });
        renderWorkspace(<TimeOffCalendar personId="u-ada" today="2026-11-27" canWrite idPrefix="t" />);
        const cell = await screen.findByRole('gridcell', { name: 'Thursday 26 November: time off, Whole day, Sick' });
        fireEvent.keyDown(cell, { key: 'Enter' });
        let dialog = await screen.findByRole('dialog', { name: /Time off on Thursday 26 November/ });
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Some hours each day' }));
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Hours off each day' }), { target: { value: '2h 30m' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ days: [{ day: '2026-11-26', minutes: 150, type: 'SICK', version: 2 }] });

        fireEvent.keyDown(await screen.findByRole('gridcell', { name: 'Thursday 26 November: time off, Whole day, Sick' }), { key: 'Enter' });
        dialog = await screen.findByRole('dialog', { name: /Time off on Thursday 26 November/ });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.path === '/time-off/days/remove')).toBe(false);
    });
});

describe('Settings → Workload', () => {
    const members: WorkloadMembersData = {
        defaultWeeklyMinutes: 2400,
        currentWeek: '2026-11-23',
        teams: [{ id: 'team-1', name: 'Ops' }],
        members: [
            { userId: 'u-ada', name: 'Ada', active: true, inForce: null, next: null },
            {
                userId: 'u-bob',
                name: 'Bob',
                active: true,
                inForce: { id: 'mc-1', userId: 'u-bob', effectiveFrom: '2026-11-02', weeklyMinutes: 1440, calendarTeamId: 'team-1', version: 1, createdAt: '2026-11-01T00:00:00.000Z' },
                next: { id: 'mc-2', userId: 'u-bob', effectiveFrom: '2026-11-30', weeklyMinutes: 1800, calendarTeamId: null, version: 4, createdAt: '2026-11-01T00:00:00.000Z' },
            },
        ],
    };

    it("lists members' capacity, changes it from a Monday with the row's version, and has no axe violations", async () => {
        const { calls } = installFetch({
            'GET /workload-settings': { body: { defaultWeeklyMinutes: 2400, version: 0 } },
            'GET /workload/members': { body: members },
            'GET /time-off': timeOffAnswer([]),
            'PUT /members/u-bob/capacity': { body: members.members[1]!.next },
        });
        const { container } = renderWorkspace(<WorkloadSettings title="Workload" affordances={ALL} today="2026-11-27" />);
        const table = await screen.findByTestId('workload-members');
        const bob = within(table).getByTestId('workload-member-u-bob');
        expect(bob).toHaveTextContent('24h');
        expect(bob).toHaveTextContent('Ops');
        expect(bob).toHaveTextContent('30h from 30 Nov 2026');
        expect(within(table).getByTestId('workload-member-u-ada')).toHaveTextContent('Default (40h)');
        fireEvent.click(within(bob).getByRole('button', { name: 'Change the capacity of Bob' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Hours a week' }), { target: { value: '32h' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        // The next Monday (30 Nov) already holds Bob's change: its version is named.
        expect(put.body).toEqual({ effectiveFrom: '2026-11-30', weeklyMinutes: 1920, calendarTeamId: 'team-1' });
        expect(put.ifMatch).toBe('"4"');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('shows the default read-only and no members to a caller who may not manage workload', async () => {
        const { calls } = installFetch({ 'GET /workload-settings': { body: { defaultWeeklyMinutes: 2250, version: 2 } } });
        renderWorkspace(<WorkloadSettings title="Workload" affordances={{ view: true, recordOwnTimeOff: true, manage: false }} today="2026-11-27" />);
        expect(await screen.findByTestId('workload-default-value')).toHaveTextContent('37h 30m a week');
        expect(screen.queryByTestId('workload-members')).toBeNull();
        expect(calls.some((c) => c.path === '/workload/members')).toBe(false);
    });
});
