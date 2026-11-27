/** @jest-environment jsdom */

/**
 * Timesheets in the browser (sub-phase 3.4c; owner decisions 256, 268 to
 * 270): My time's status line (Submit, an empty week confirmed first, Take
 * back with `If-Match`, a frozen week's cells read-only, a returned week's
 * explanation), the Timesheets page (the waiting weeks, a week opened
 * read-only, Approve with `If-Match`, Return asking for its explanation
 * first), Settings → Time tracking (the switch, read-only for whoever may not
 * change it), and no axe violations.
 *
 * Written fresh for Islestone.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/time',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { TimeTrackingSettings } from '@/components/settings/TimeTrackingSettings';
import { MyTimeView } from '@/components/time/MyTimeView';
import { TimesheetsView } from '@/components/time/TimesheetsView';
import type { TimeEntryData, TimeWeekData } from '@/lib/time/entries';
import type { TimesheetData, TimesheetDetailData, TimesheetListRow, TimesheetWeekData } from '@/lib/time/timesheets';
import type { TimeAffordances } from '@/lib/time/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const RECORDER: TimeAffordances = { view: true, track: true, approve: false, record: true };
const visible = { kind: 'visible' as const, id: 'wi-1', key: 'ISL-1', title: 'Write the brief', projectId: 'p-1', closed: false };

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

function week(entries: TimeWeekData['entries']): TimeWeekData {
    return { userId: 'u-ada', weekStart: '2026-11-23', entries, dayTotals: [], totalMinutes: entries.reduce((s, e) => s + (e.minutes ?? 0), 0), viewer: { edit: true } };
}

function sheet(over: Partial<TimesheetData> = {}): TimesheetData {
    return {
        id: 'ts-1',
        userId: 'u-ada',
        weekStart: '2026-11-23',
        status: 'SUBMITTED',
        submittedAt: '2026-11-27T16:00:00.000Z',
        decidedAt: null,
        decidedByUserId: null,
        decidedByName: null,
        returnExplanation: null,
        version: 2,
        ...over,
    };
}

function status(over: Partial<TimesheetWeekData> = {}): TimesheetWeekData {
    return {
        userId: 'u-ada',
        weekStart: '2026-11-23',
        approvalRequired: true,
        timesheet: null,
        frozen: false,
        timerOn: false,
        sums: { minutes: 90, billableMinutes: 0, entries: 1 },
        viewer: { submit: true, withdraw: false, edit: true },
        ...over,
    };
}

const myTime = (s: TimesheetWeekData, extra: Parameters<typeof installFetch>[0] = {}, entries: TimeWeekData['entries'] = [{ ...entry(), item: visible }]) =>
    installFetch({ 'GET /time-entries': { body: week(entries) }, 'GET /time-entries/timer': { body: { timer: null } }, 'GET /timesheets/week': { body: s }, ...extra });

describe("My time's status line", () => {
    it('says the week is not submitted and submits it, with no axe violations', async () => {
        const { calls } = myTime(status(), { 'POST /timesheets': { status: 201, body: status({ timesheet: sheet({ version: 1 }), frozen: true, viewer: { submit: false, withdraw: true, edit: false } }) } });
        const { container } = renderWorkspace(<MyTimeView affordances={RECORDER} today="2026-11-27" weekStart="2026-11-23" />);
        expect(await screen.findByTestId('timesheet-status-text')).toHaveTextContent('This week is not submitted.');
        fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/timesheets')?.body).toEqual({ week: '2026-11-23' }));
        expect(await axe(container)).toHaveNoViolations();
    });

    it('asks before it submits an empty week', async () => {
        const { calls } = myTime(status({ sums: { minutes: 0, billableMinutes: 0, entries: 0 } }), {}, []);
        renderWorkspace(<MyTimeView affordances={RECORDER} today="2026-11-27" weekStart="2026-11-23" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
        expect((await screen.findAllByText('This week holds no time. Submit it anyway?')).length).toBeGreaterThan(0);
        expect(calls.some((c) => c.method === 'POST')).toBe(false);
    });

    it("keeps a submitted week's cells read-only and takes it back with If-Match", async () => {
        const { calls } = myTime(status({ timesheet: sheet(), frozen: true, viewer: { submit: false, withdraw: true, edit: false } }), {
            'POST /timesheets/ts-1/withdraw': { body: sheet({ status: 'WITHDRAWN', version: 3 }) },
        });
        renderWorkspace(<MyTimeView affordances={RECORDER} today="2026-11-27" weekStart="2026-11-23" />);
        expect(await screen.findByTestId('timesheet-status-text')).toHaveTextContent('Submitted 27 Nov.');
        await screen.findByRole('grid');
        expect(screen.queryByRole('button', { name: 'Add time' })).toBeNull();
        fireEvent.click(screen.getByTestId('my-time-cell-0-1'));
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Take back' }));
        await waitFor(() => expect(calls.find((c) => c.path === '/timesheets/ts-1/withdraw')).toMatchObject({ method: 'POST', ifMatch: '"2"' }));
    });

    it("shows a returned week's explanation and who returned it", async () => {
        myTime(status({ timesheet: sheet({ status: 'RETURNED', decidedByUserId: 'u-bob', decidedByName: 'Bob', decidedAt: '2026-11-28T09:00:00.000Z', returnExplanation: 'Tuesday is missing' }) }));
        renderWorkspace(<MyTimeView affordances={RECORDER} today="2026-11-27" weekStart="2026-11-23" />);
        expect(await screen.findByTestId('timesheet-status-text')).toHaveTextContent('Returned by Bob:');
        expect(screen.getByTestId('timesheet-explanation')).toHaveTextContent('Tuesday is missing');
        expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    });
});

describe('the Timesheets page', () => {
    const row: TimesheetListRow = { ...sheet({ userId: 'u-bob' }), personName: 'Bob', sums: { minutes: 150, billableMinutes: 60, entries: 2 } };
    const detail: TimesheetDetailData = {
        timesheet: sheet({ userId: 'u-bob' }),
        personName: 'Bob',
        entries: [
            { ...entry({ userId: 'u-bob', minutes: 90, billable: true, description: 'Drafted the brief' }), item: visible },
            { ...entry({ id: 'te-2', userId: 'u-bob', workDate: '2026-11-26', minutes: 60 }), item: visible },
        ],
        dayTotals: [],
        sums: { minutes: 150, billableMinutes: 90, entries: 2 },
        viewer: { approve: true, return: true, reopen: false },
    };
    const routes = (extra: Parameters<typeof installFetch>[0] = {}) =>
        installFetch({ 'GET /timesheets': { body: { rows: [row], pageInfo: { hasNextPage: false } } }, 'GET /timesheets/ts-1': { body: detail }, ...extra });

    it('lists the waiting weeks with their time, and has no axe violations', async () => {
        routes();
        const { container } = renderWorkspace(<TimesheetsView title="Timesheets" />);
        const table = await screen.findByTestId('timesheets-table');
        expect(await within(table).findByText('Bob')).toBeInTheDocument();
        expect(within(table).getByText('2h 30m')).toBeInTheDocument();
        expect(screen.getByTestId('time-tabs')).toBeInTheDocument();
        // The mirrored DataTable's row-chevron column has no header text (as every list page's test notes).
        expect(await axe(container, { rules: { 'empty-table-header': { enabled: false } } })).toHaveNoViolations();
    });

    it('opens a week read-only and approves it with If-Match', async () => {
        const { calls } = routes({ 'POST /timesheets/ts-1/approve': { body: sheet({ status: 'APPROVED', version: 3 }) } });
        renderWorkspace(<TimesheetsView title="Timesheets" />);
        fireEvent.click(await screen.findByText('Bob'));
        const detailPanel = await screen.findByTestId('timesheet-detail');
        expect(within(detailPanel).getByText('Drafted the brief')).toBeInTheDocument();
        fireEvent.click(within(detailPanel).getByRole('button', { name: 'Approve' }));
        await waitFor(() => expect(calls.find((c) => c.path === '/timesheets/ts-1/approve')).toMatchObject({ method: 'POST', ifMatch: '"2"' }));
    });

    it('returns a week only with an explanation', async () => {
        const { calls } = routes({ 'POST /timesheets/ts-1/return': { body: sheet({ status: 'RETURNED', version: 3, returnExplanation: 'Monday is missing' }) } });
        renderWorkspace(<TimesheetsView title="Timesheets" />);
        fireEvent.click(await screen.findByText('Bob'));
        fireEvent.click(within(await screen.findByTestId('timesheet-detail')).getByRole('button', { name: 'Return' }));
        const dialog = await screen.findByRole('dialog', { name: 'Return this week' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Return' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('an explanation is required');
        expect(calls.some((c) => c.path === '/timesheets/ts-1/return')).toBe(false);
        fireEvent.change(within(dialog).getByRole('textbox', { name: 'Explanation' }), { target: { value: 'Monday is missing' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Return' }));
        await waitFor(() => expect(calls.find((c) => c.path === '/timesheets/ts-1/return')).toMatchObject({ body: { explanation: 'Monday is missing' }, ifMatch: '"2"' }));
    });
});

describe('Settings → Time tracking', () => {
    it('turns approval on for whoever may change it, and has no axe violations', async () => {
        const { calls } = installFetch({
            'GET /time-settings': { body: { approvalRequired: false, approvalRecipientListId: null, version: 0, viewer: { manage: true } } },
            'GET /recipient-lists': { body: [] },
            'PUT /time-settings': { body: { approvalRequired: true, approvalRecipientListId: null, version: 1, viewer: { manage: true } } },
        });
        const { container } = renderWorkspace(<TimeTrackingSettings manage />);
        const toggle = await screen.findByRole('switch', { name: 'Timesheets need approval' });
        expect(await axe(container)).toHaveNoViolations();
        fireEvent.click(toggle);
        await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/time-settings', body: { approvalRequired: true }, ifMatch: null }));
    });

    it('is read-only for whoever may not change it', async () => {
        installFetch({ 'GET /time-settings': { body: { approvalRequired: true, approvalRecipientListId: null, version: 3, viewer: { manage: false } } } });
        renderWorkspace(<TimeTrackingSettings manage={false} />, { role: 'MEMBER' });
        expect(await screen.findByRole('switch', { name: 'Timesheets need approval' })).toBeDisabled();
        expect(screen.getByText('Only an Owner or Admin changes these settings.')).toBeInTheDocument();
    });
});
