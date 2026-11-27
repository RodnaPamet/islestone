/** @jest-environment jsdom */

/**
 * Time totals, the export and billable rates in the browser (sub-phase 3.4d;
 * owner decisions 271 to 275): the totals table and its total line, money
 * only where the read sends it (decision 274), the grouping and the filter
 * sent as the read's query, the CSV and Excel export downloaded (a refusal
 * shown), Settings → Time tracking's rates for a rates holder (a rate set,
 * a future one removed through the undo toast), the Time tabs, and no axe
 * violations.
 *
 * Written fresh for Islestone.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/time/totals',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { TimeTrackingSettings } from '@/components/settings/TimeTrackingSettings';
import { TimeTotalsView } from '@/components/time/TimeTotalsView';
import type { BillableRatesData, TimeTotalsData } from '@/lib/time/totals';
import type { TimeAffordances } from '@/lib/time/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const VIEWER: TimeAffordances = { view: true, track: false, approve: false, rates: false, record: false };
const OWNER: TimeAffordances = { view: true, track: true, approve: true, rates: true, record: true };
const PROJECTS = [{ id: 'p-1', name: 'Client A', keyPrefix: 'BLA' }];

function totals(over: Partial<TimeTotalsData> = {}): TimeTotalsData {
    return {
        filter: { from: '2026-11-01', to: '2026-11-27' },
        groupBy: 'project',
        groups: [
            {
                key: 'p-1',
                subject: { kind: 'project', projectId: 'p-1', name: 'Client A', keyPrefix: 'BLA', teamId: 't-1', deleted: false },
                minutes: 150,
                billableMinutes: 90,
                entries: 3,
                amountMinor: null,
                noRateMinutes: null,
            },
            {
                key: 'p-old',
                subject: { kind: 'project', projectId: 'p-old', name: 'Old client', keyPrefix: 'BLT', teamId: null, deleted: true },
                minutes: 15,
                billableMinutes: 0,
                entries: 1,
                amountMinor: null,
                noRateMinutes: null,
            },
        ],
        total: { minutes: 165, billableMinutes: 90, entries: 4, amountMinor: null, noRateMinutes: null },
        currency: null,
        viewer: { rates: false, export: true },
        ...over,
    };
}

describe('Time totals', () => {
    it("shows the groups and the total with no money for a viewer, a tombstone's project named, and no axe violations", async () => {
        const { calls } = installFetch({ 'GET /time-totals': { body: totals() }, 'GET /users/assignable': { body: [] } });
        const { container } = renderWorkspace(<TimeTotalsView affordances={VIEWER} today="2026-11-27" projects={PROJECTS} />, { role: 'VIEWER' });
        const table = await screen.findByTestId('time-totals-table');
        expect(await within(table).findByText('BLA Client A')).toBeInTheDocument();
        expect(within(table).getByText('BLT Old client (deleted)')).toBeInTheDocument();
        expect(within(table).queryByText(/Amount/)).not.toBeInTheDocument();
        expect(screen.getByTestId('time-totals-total')).toHaveTextContent('Total 2h 45m, billable 1h 30m, 4 entries');
        const read = calls.find((c) => c.path === '/time-totals')!;
        expect(Object.fromEntries(read.search)).toEqual({ from: '2026-11-01', to: '2026-11-27', groupBy: 'project' });
        // A viewer alone has one tab: none are shown.
        expect(screen.queryByTestId('time-tabs')).not.toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('shows amounts and "No rate" to a rates holder, and reads again grouped by person', async () => {
        const money = totals({
            groups: [{ ...totals().groups[0]!, amountMinor: 22_500, noRateMinutes: 30 }],
            total: { minutes: 150, billableMinutes: 90, entries: 3, amountMinor: 22_500, noRateMinutes: 30 },
            currency: 'EUR',
            viewer: { rates: true, export: true },
        });
        const { calls } = installFetch({ 'GET /time-totals': { body: money }, 'GET /users/assignable': { body: [] }, 'GET /time-entries/timer': { body: { timer: null } } });
        renderWorkspace(<TimeTotalsView affordances={OWNER} today="2026-11-27" projects={PROJECTS} />);
        const table = await screen.findByTestId('time-totals-table');
        expect(await within(table).findByText('Amount (EUR)')).toBeInTheDocument();
        expect(within(table).getByText('€225.00')).toBeInTheDocument();
        expect(within(table).getByText('30m with no rate')).toBeInTheDocument();
        expect(screen.getByTestId('time-totals-total')).toHaveTextContent('€225.00');
        expect(screen.getByTestId('time-tabs')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: 'Person' }));
        await waitFor(() => expect(calls.some((c) => c.path === '/time-totals' && c.search.get('groupBy') === 'person')).toBe(true));
    });

    it('downloads the export as CSV and Excel with the filter, and shows a refusal', async () => {
        const create = jest.fn(() => 'blob:x');
        const revoke = jest.fn();
        Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
        const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        let refuse = false;
        const { calls } = installFetch({
            'GET /time-totals': { body: totals() },
            'GET /users/assignable': { body: [] },
            'GET /time-totals/export': () =>
                refuse
                    ? { status: 422, body: { error: { code: 'TIME_EXPORT_TOO_LARGE', message: 'An export holds at most 50000 entries; narrow the filter.', details: { reason: 'TIME_EXPORT_TOO_LARGE' } } } }
                    : { body: 'Date,Person\r\n', headers: { 'Content-Disposition': 'attachment; filename="time-entries-2026-11-01-to-2026-11-27.csv"' } },
        });
        renderWorkspace(<TimeTotalsView affordances={VIEWER} today="2026-11-27" projects={PROJECTS} />, { role: 'VIEWER' });
        await screen.findByTestId('time-totals-table');
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
        await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
        const csv = calls.find((c) => c.path === '/time-totals/export')!;
        expect(Object.fromEntries(csv.search)).toEqual({ from: '2026-11-01', to: '2026-11-27', format: 'csv' });
        expect(create).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
        await waitFor(() => expect(calls.filter((c) => c.path === '/time-totals/export').map((c) => c.search.get('format'))).toEqual(['csv', 'xlsx']));
        refuse = true;
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
        expect(await screen.findByText('An export holds at most 50000 entries; narrow the filter.')).toBeInTheDocument();
        click.mockRestore();
    });
});

describe('Settings → Time tracking: rates', () => {
    const rates: BillableRatesData = {
        currency: 'EUR',
        today: '2026-11-27',
        rates: [
            { id: 'r-1', level: 'WORKSPACE', projectId: null, userId: null, hourlyRateMinor: 10_000, effectiveFrom: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', removable: false },
            { id: 'r-2', level: 'WORKSPACE', projectId: null, userId: null, hourlyRateMinor: 12_000, effectiveFrom: '2027-01-01', createdAt: '2026-11-01T00:00:00.000Z', removable: true },
        ],
    };

    it('lists the workspace rate history, sets a rate in minor units, removes a future one through the undo toast, and keeps the currency fixed', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
        try {
            const { calls } = installFetch({
                'GET /time-settings': { body: { approvalRequired: false, approvalRecipientListId: null, currency: 'EUR', version: 1, viewer: { manage: true, currency: true } } },
                'GET /recipient-lists': { body: [] },
                'GET /billable-rates': { body: rates },
                'GET /users/assignable': { body: [] },
                'PUT /billable-rates/workspace': { body: rates.rates[0] },
                'DELETE /billable-rates/r-2': { body: { deleted: true } },
            });
            renderWorkspace(<TimeTrackingSettings manage rates />);
            const list = await screen.findByRole('list', { name: 'Rates of the workspace' });
            expect(within(list).getByText('€100.00 an hour')).toBeInTheDocument();
            expect(within(list).getByText('€120.00 an hour')).toBeInTheDocument();
            expect(screen.getByText('Rates exist in this currency, so it cannot change.')).toBeInTheDocument();
            fireEvent.change(document.getElementById('workspace-rate-amount')!, { target: { value: '150.50' } });
            fireEvent.click(document.getElementById('workspace-rate-save')!);
            await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/billable-rates/workspace', body: { effectiveFrom: '2026-11-27', hourlyRateMinor: 15_050 } }));
            // Only the future rate offers Remove; nothing is sent until the undo window closes.
            const removes = within(list).getAllByRole('button', { name: /Remove the rate from/ });
            expect(removes).toHaveLength(1);
            fireEvent.click(removes[0]!);
            expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
            await act(async () => {
                jest.advanceTimersByTime(6_000);
            });
            await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/billable-rates/r-2')).toBe(true));
        } finally {
            jest.useRealTimers();
        }
    });

    it('shows no rates to whoever does not hold time.rates', async () => {
        installFetch({ 'GET /time-settings': { body: { approvalRequired: false, approvalRecipientListId: null, currency: 'EUR', version: 1, viewer: { manage: true, currency: false } } }, 'GET /recipient-lists': { body: [] } });
        renderWorkspace(<TimeTrackingSettings manage />);
        await screen.findByRole('switch', { name: 'Timesheets need approval' });
        expect(screen.queryByTestId('time-tracking-rates')).not.toBeInTheDocument();
    });
});
