/** @jest-environment jsdom */

/**
 * Capacity, time off and allocation in the browser (sub-phases 3.5a and 3.5b;
 * owner decisions 284 to 300 and 303): the Workload page's grid (a real grid
 * with a roving tabindex and labelled cells carrying allocation, capacity,
 * over capacity, time off and a filter's share; the row's figures; the
 * Unassigned row; the filters sent; a cell opening the week's items in a
 * sheet, its items listed or withheld), My Work's line, "My capacity and time off"
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
import { MyWorkloadLine } from '@/components/workload/MyWorkloadLine';
import { WorkloadView } from '@/components/workload/WorkloadView';
import type { TimeOffDayData, WorkloadCellData, WorkloadData, WorkloadMembersData, WorkloadPersonRow } from '@/lib/workload/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const ALL = { view: true, recordOwnTimeOff: true, manage: true };

const person = (over: Partial<WorkloadPersonRow> & Pick<WorkloadPersonRow, 'userId' | 'name'>): WorkloadPersonRow => ({
    active: true,
    capacity: [2400, 2400],
    weeklyMinutes: [2400, 2400],
    timeOffMinutes: [0, 0],
    timeOffDays: [[], []],
    allocated: [0, 0],
    over: [0, 0],
    share: null,
    later: 0,
    noDates: { count: 0, minutes: 0 },
    notEstimated: 0,
    pointsWork: { count: 0, points: 0 },
    ...over,
});

const workload: WorkloadData = {
    weeks: ['2026-11-23', '2026-11-30'],
    today: '2026-11-27',
    timeZone: 'Europe/Sofia',
    people: [
        person({
            userId: 'u-ada',
            name: 'Ada',
            capacity: [2400, 1920],
            timeOffMinutes: [0, 480],
            timeOffDays: [[], ['2026-12-01']],
            allocated: [2040, 2760],
            over: [0, 840],
            later: 600,
            noDates: { count: 2, minutes: 180 },
            notEstimated: 3,
            pointsWork: { count: 1, points: 5 },
        }),
        person({ userId: 'u-bob', name: 'Bob', capacity: [1440, 1440], weeklyMinutes: [1440, 1440] }),
        person({ userId: 'u-cy', name: 'Cy', active: false, capacity: [0, 0], allocated: [60, 0], over: [60, 0] }),
    ],
    unassigned: { allocated: [300, 0], share: null, later: 0, noDates: { count: 0, minutes: 0 } },
    calendars: [{ id: 'workspace-default', timeZone: 'Europe/Sofia' }],
    timeSpentCounted: true,
    filters: { userIds: null, projectId: null, teamId: null, recipientListId: null, over: false },
};

const cellOfAda: WorkloadCellData = {
    userId: 'u-ada',
    name: 'Ada',
    active: true,
    week: '2026-11-30',
    capacityMinutes: 1920,
    weeklyMinutes: 2400,
    allocatedMinutes: 2760,
    overMinutes: 840,
    timeOff: [{ day: '2026-12-01', minutes: null }],
    items: [
        {
            id: 'w-1', key: 'WEB-12', title: 'Launch page', projectId: 'p-web', projectName: 'Website', startDate: '2026-11-30', dueDate: '2026-12-04',
            estimateMinutes: 2400, remainingMinutes: 2400, minutes: 2400, reason: 'SPREAD', workingDays: 5, from: '2026-11-30', to: '2026-12-04',
        },
        {
            id: 'w-2', key: 'WEB-3', title: 'Old bug', projectId: 'p-web', projectName: 'Website', startDate: null, dueDate: '2026-11-10',
            estimateMinutes: 480, remainingMinutes: 360, minutes: 360, reason: 'OVERDUE', workingDays: 1, from: '2026-11-30', to: '2026-11-30',
        },
    ],
    moreItems: 0,
    itemsShown: true,
    timeSpentCounted: true,
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
    it('shows allocation against capacity by week in a labelled grid, moves focus by arrow keys, and has no axe violations', async () => {
        installFetch({ 'GET /workload': { body: workload }, 'GET /time-off': timeOffAnswer([day()]), 'GET /members/u-ada/capacity': capacity });
        const { container } = renderWorkspace(<WorkloadView affordances={ALL} userId="u-ada" today="2026-11-27" />);
        const grid = await screen.findByRole('grid', { name: /Workload by week/ });
        const first = within(grid).getByRole('gridcell', { name: 'Ada, week of 23 Nov 2026: 34h allocated of 40h' });
        expect(first).toHaveAttribute('tabindex', '0');
        expect(first).toHaveTextContent('34h / 40h');
        const over = within(grid).getByRole('gridcell', { name: 'Ada, week of 30 Nov 2026: 46h allocated of 32h, over by 14h; time off on 1 day, 8h' });
        expect(over).toHaveTextContent('Over by 14h');
        expect(over).toHaveTextContent('Time off 8h');
        expect(over).toHaveAttribute('data-over', 'true');
        expect(first).not.toHaveAttribute('data-over');
        // The row ends with what could not be placed.
        const figures = screen.getByTestId('workload-figures-u-ada');
        expect(figures).toHaveTextContent('No dates: 2 · 3h');
        expect(figures).toHaveTextContent('Not estimated: 3');
        expect(figures).toHaveTextContent('Points work: 1 · 5 points');
        expect(figures).toHaveTextContent('Later: 10h');
        // A deactivated member with work, and the work assigned to nobody.
        expect(within(grid).getByRole('gridcell', { name: 'Cy, week of 23 Nov 2026: 1h allocated of 0h, over by 1h' })).toBeInTheDocument();
        expect(within(grid).getByTestId('workload-row-u-cy')).toHaveTextContent('Deactivated');
        expect(within(grid).getByRole('gridcell', { name: 'Unassigned, week of 23 Nov 2026: 5h allocated' })).toBeInTheDocument();
        act(() => first.focus());
        fireEvent.keyDown(first, { key: 'ArrowRight' });
        expect(over).toHaveFocus();
        fireEvent.keyDown(over, { key: 'ArrowDown' });
        expect(within(grid).getByRole('gridcell', { name: /^Bob, week of 30 Nov 2026/ })).toHaveFocus();
        expect(await screen.findByTestId('my-capacity')).toHaveTextContent("40h a week (the workspace's default)");
        expect(await axe(container)).toHaveNoViolations();
    });

    it("opens a week's items in a sheet, each opening the item, and has no axe violations", async () => {
        const { calls } = installFetch({
            'GET /workload': { body: workload },
            'GET /workload/cell': { body: cellOfAda },
            'GET /time-off': timeOffAnswer([]),
            'GET /members/u-ada/capacity': capacity,
        });
        renderWorkspace(<WorkloadView affordances={ALL} userId="u-ada" today="2026-11-27" />);
        const grid = await screen.findByRole('grid', { name: /Workload by week/ });
        fireEvent.keyDown(within(grid).getByRole('gridcell', { name: /^Ada, week of 30 Nov 2026/ }), { key: 'Enter' });
        const sheet = await screen.findByTestId('workload-cell-sheet');
        await waitFor(() => expect(within(sheet).getByTestId('workload-cell-summary')).toHaveTextContent('46h allocated of 32h, over by 14h'));
        const cell = calls.find((c) => c.path === '/workload/cell')!;
        expect(cell.search.get('userId')).toBe('u-ada');
        expect(cell.search.get('week')).toBe('2026-11-30');
        expect(sheet).toHaveTextContent('Time off: 1 Dec (whole day)');
        const table = within(sheet).getByTestId('workload-cell-table');
        expect(table).toHaveTextContent('WEB-12');
        expect(table).toHaveTextContent('Spread over 5 working days, 30 Nov to 4 Dec');
        expect(table).toHaveTextContent('Overdue: on the next working day');
        expect(table).toHaveTextContent('6h left of 8h');
        expect(await axe(sheet)).toHaveNoViolations();
    });

    it('withholds the items from a caller who may not read work items', async () => {
        installFetch({
            'GET /workload': { body: workload },
            'GET /workload/cell': { body: { ...cellOfAda, items: [], itemsShown: false } },
            'GET /time-off': timeOffAnswer([]),
            'GET /members/u-ada/capacity': capacity,
        });
        renderWorkspace(<WorkloadView affordances={ALL} userId="u-ada" today="2026-11-27" />);
        const grid = await screen.findByRole('grid', { name: /Workload by week/ });
        fireEvent.click(within(grid).getByRole('gridcell', { name: /^Ada, week of 30 Nov 2026/ }));
        const sheet = await screen.findByTestId('workload-cell-sheet');
        expect(await within(sheet).findByText('You cannot see work items, so the items are not listed.')).toBeInTheDocument();
        expect(within(sheet).queryByTestId('workload-cell-table')).toBeNull();
    });

    it("sends the filters from the address and shows a project's share", async () => {
        // The filters are read from the address (synced to the URL).
        window.history.replaceState(null, '', '/t/acme/workload?projectId=p-web&over=true');
        const shared: WorkloadData = { ...workload, people: [{ ...workload.people[0]!, share: [600, 0] }], unassigned: null, filters: { ...workload.filters, projectId: 'p-web', over: true } };
        const { calls } = installFetch({ 'GET /workload': { body: shared }, 'GET /time-off': timeOffAnswer([]), 'GET /members/u-ada/capacity': capacity });
        renderWorkspace(
            <WorkloadView affordances={ALL} userId="u-ada" today="2026-11-27" options={{ projects: [{ id: 'p-web', name: 'Website' }], teams: [], recipientLists: [], readsItems: false }} />,
        );
        const grid = await screen.findByRole('grid', { name: /Workload by week/ });
        const read = calls.find((c) => c.path === '/workload')!;
        expect(read.search.get('projectId')).toBe('p-web');
        expect(read.search.get('over')).toBe('true');
        const first = within(grid).getByRole('gridcell', { name: 'Ada, week of 23 Nov 2026: 34h allocated of 40h; 10h in Website' });
        expect(first).toHaveTextContent('10h of 34h in Website');
        expect(within(grid).queryByTestId('workload-row-unassigned')).toBeNull();
    });
});

describe("My Work's line (decision 300)", () => {
    it("says this week's and next week's load, the over week as such, and links to the Workload page", async () => {
        const mine: WorkloadData = { ...workload, people: [workload.people[0]!], unassigned: null };
        const { calls } = installFetch({ 'GET /workload': { body: mine } });
        renderWorkspace(<MyWorkloadLine userId="u-ada" />);
        const line = await screen.findByTestId('my-workload-line');
        expect(line).toHaveTextContent('This week 34h of 40h · next week over by 14h');
        expect(within(line).getByRole('link', { name: 'Open Workload' })).toHaveAttribute('href', '/t/acme/workload?userId=u-ada');
        const read = calls.find((c) => c.path === '/workload')!;
        expect(read.search.get('userId')).toBe('me');
        expect(read.search.get('weeks')).toBe('2');
    });

    it('is hidden when the person has no counted work in either week', async () => {
        const idle: WorkloadData = { ...workload, people: [person({ userId: 'u-ada', name: 'Ada' })], unassigned: null };
        const { calls } = installFetch({ 'GET /workload': { body: idle } });
        renderWorkspace(<MyWorkloadLine userId="u-ada" />);
        await waitFor(() => expect(calls.some((c) => c.path === '/workload')).toBe(true));
        expect(screen.queryByTestId('my-workload-line')).toBeNull();
    });
});

describe('the Workload page, time off', () => {
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
