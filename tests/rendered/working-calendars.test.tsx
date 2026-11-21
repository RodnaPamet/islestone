/** @jest-environment jsdom */

/**
 * Settings → Working calendars (roadmap 3.1a; decisions 189 to 193): the
 * workspace's calendar (the default until saved), its form sending sorted
 * weekdays, holidays added and removed through the undo toast, "Copy last
 * year's" sending the next year's dates, the teams with their own calendar or
 * the workspace's, and a team's page giving the team its own calendar and
 * taking it back through the undo toast. Every write is offered only with the
 * server's `manageWorkConfig`. Queries by role and label; jest-axe.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/settings/working-calendars',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { TeamWorkingCalendarSettings, WorkingCalendarsSettings } from '@/components/settings/WorkingCalendarSettings';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import type { TeamWorkingCalendarData, WorkingCalendarData, WorkingCalendarsOverview } from '@/lib/scheduling/working-calendar';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const ALL: WorkConfigAffordances = { manageWorkConfig: true, createProject: true, editProject: true, archiveProject: true, manageCustomFields: true };
const NONE: WorkConfigAffordances = { manageWorkConfig: false, createProject: false, editProject: false, archiveProject: false, manageCustomFields: false };

function calendar(over: Partial<WorkingCalendarData> = {}): WorkingCalendarData {
    return {
        id: 'cal-ws',
        teamId: null,
        name: 'Workspace',
        timeZone: 'Europe/Sofia',
        workingWeekdays: [1, 2, 3, 4, 5],
        holidays: [
            { id: 'h-1', day: '2027-01-01', name: 'New Year' },
            { id: 'h-2', day: '2027-03-03', name: 'Liberation Day' },
        ],
        version: 3,
        isDefault: false,
        ...over,
    };
}

function overview(ws: WorkingCalendarData = calendar()): WorkingCalendarsOverview {
    return {
        workspace: ws,
        teams: [
            { teamId: 't-core', teamName: 'Core', calendarId: null },
            { teamId: 't-island', teamName: 'Island', calendarId: 'cal-island' },
        ],
    };
}

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    jest.useRealTimers();
});

describe('Settings → Working calendars', () => {
    it('shows the calendar, its holidays and the teams; no axe violations', async () => {
        installFetch({ 'GET /working-calendar': { body: overview() } });
        const { container } = renderWorkspace(<WorkingCalendarsSettings affordances={ALL} />);
        expect(await screen.findByRole('heading', { level: 2, name: 'Workspace calendar' })).toBeInTheDocument();
        expect(screen.getByLabelText('Monday')).toBeChecked();
        expect(screen.getByLabelText('Saturday')).not.toBeChecked();
        const holidays = screen.getByRole('table', { name: 'Holidays' });
        expect(within(holidays).getByText('Liberation Day')).toBeInTheDocument();
        const teams = screen.getByTestId('working-calendar-teams');
        expect(within(teams).getByText('Uses the workspace calendar')).toBeInTheDocument();
        expect(within(teams).getByText('Its own calendar')).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('says when nothing is saved yet', async () => {
        installFetch({ 'GET /working-calendar': { body: overview(calendar({ id: null, isDefault: true, holidays: [], timeZone: 'UTC', version: 0 })) } });
        renderWorkspace(<WorkingCalendarsSettings affordances={ALL} />);
        expect(await screen.findByText(/Not saved yet: the workspace counts Monday to Friday, with no holidays, in UTC/)).toBeInTheDocument();
        expect(screen.getByText('No holidays yet.')).toBeInTheDocument();
    });

    it('saves the weekdays sorted, with the zone and the name', async () => {
        const { calls } = installFetch({ 'GET /working-calendar': { body: overview() }, 'PUT /working-calendar': { body: calendar() } });
        renderWorkspace(<WorkingCalendarsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByLabelText('Sunday'));
        fireEvent.click(screen.getByLabelText('Friday'));
        fireEvent.click(screen.getByRole('button', { name: 'Save working calendar' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ name: 'Workspace', timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4, 7] });
    });

    it('refuses a week with no working day before anything is sent', async () => {
        const { calls } = installFetch({ 'GET /working-calendar': { body: overview(calendar({ workingWeekdays: [1] })) } });
        renderWorkspace(<WorkingCalendarsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByLabelText('Monday'));
        fireEvent.click(screen.getByRole('button', { name: 'Save working calendar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one working weekday.');
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it("copies the latest year's holidays to the next", async () => {
        const { calls } = installFetch({
            'GET /working-calendar': { body: overview() },
            'POST /working-calendar/holidays': { status: 201, body: { calendar: calendar(), added: ['2028-01-01', '2028-03-03'], skipped: [] } },
        });
        renderWorkspace(<WorkingCalendarsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: "Copy 2027's holidays to 2028" }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
            holidays: [
                { day: '2028-01-01', name: 'New Year' },
                { day: '2028-03-03', name: 'Liberation Day' },
            ],
        });
    });

    it('removes a holiday only when the undo window closes, and Undo sends nothing', async () => {
        jest.useFakeTimers();
        const { calls } = installFetch({ 'GET /working-calendar': { body: overview() }, 'DELETE /working-calendar/holidays/h-2': { body: calendar() } });
        renderWorkspace(<WorkingCalendarsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remove the holiday Liberation Day (2027-03-03)' }));
        await waitFor(() => expect(screen.queryByText('Liberation Day')).not.toBeInTheDocument());
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        await act(async () => {
            jest.advanceTimersByTime(6000);
        });
        await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/working-calendar/holidays/h-2'))).toBe(true));
    });

    it('offers no write without manageWorkConfig', async () => {
        installFetch({ 'GET /working-calendar': { body: overview() } });
        renderWorkspace(<WorkingCalendarsSettings affordances={NONE} />);
        expect(await screen.findByText('Only workspace admins change working calendars.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save working calendar' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Remove the holiday/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('form', { name: 'Add holiday' })).not.toBeInTheDocument();
        expect(screen.getByLabelText('Monday')).toBeDisabled();
    });
});

describe("Settings → Working calendars → a team's calendar", () => {
    const team = (cal: WorkingCalendarData | null): TeamWorkingCalendarData => ({ teamId: 't-core', teamName: 'Core', calendar: cal });

    it("gives the team its own calendar from the workspace's settings", async () => {
        const own = calendar({ id: 'cal-core', teamId: 't-core', name: 'Core', holidays: [] });
        const { calls } = installFetch({
            'GET /teams/t-core/working-calendar': { body: team(null) },
            'GET /working-calendar': { body: overview() },
            'PUT /teams/t-core/working-calendar': { body: team(own) },
        });
        const { container } = renderWorkspace(<TeamWorkingCalendarSettings teamId="t-core" affordances={ALL} />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Working calendar of Core' })).toBeInTheDocument();
        await screen.findByRole('heading', { level: 2, name: 'Uses the workspace calendar' });
        expect(await axe(container)).toHaveNoViolations();
        await waitFor(() => expect(calls.some((c) => c.method === 'GET' && c.path.endsWith('/working-calendar') && !c.path.includes('/teams/'))).toBe(true));
        fireEvent.click(screen.getByRole('button', { name: 'Give this team its own calendar' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ name: 'Core', timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4, 5] });
    });

    it("copies the workspace's holidays, and goes back to the workspace calendar through the undo toast", async () => {
        jest.useFakeTimers();
        const own = calendar({ id: 'cal-core', teamId: 't-core', name: 'Core', holidays: [{ id: 'h-9', day: '2027-01-01', name: 'New Year' }] });
        const { calls } = installFetch({
            'GET /teams/t-core/working-calendar': { body: team(own) },
            'GET /working-calendar': { body: overview() },
            'POST /teams/t-core/working-calendar/holidays': { status: 201, body: { calendar: own, added: ['2027-03-03'], skipped: [] } },
            'DELETE /teams/t-core/working-calendar': { body: team(null) },
        });
        renderWorkspace(<TeamWorkingCalendarSettings teamId="t-core" affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: "Copy the workspace's holidays" }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        // Only the dates the team does not have yet.
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ holidays: [{ day: '2027-03-03', name: 'Liberation Day' }] });
        fireEvent.click(screen.getByRole('button', { name: 'Use the workspace calendar' }));
        expect(await screen.findByRole('heading', { level: 2, name: 'Uses the workspace calendar' })).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        await act(async () => {
            jest.advanceTimersByTime(6000);
        });
        await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/teams/t-core/working-calendar'))).toBe(true));
    });
});
