/** @jest-environment jsdom */

/**
 * Estimates in the views (sub-phase 3.4a; owner decisions 257 to 259): the
 * detail's Estimate field in the item's team's unit (points as a number,
 * hours parsed from "2h 30m"), sent with `If-Match` and the unit it was typed
 * in, a value the parser refuses never sent; no field for a team that does
 * not estimate; the list's estimate column; the board card's badge; the
 * burn-up's Items / Points switch and its summary line; no axe violations.
 *
 * Written fresh for Islestone.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/work-items/ISL-1',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { BurnUpChart } from '@/components/cycles/BurnUpChart';
import { EstimateText } from '@/components/work-items/fields/EstimateInput';
import { toRow } from '@/components/work-items/data/use-work-item-mutations';
import { WorkItemDetail } from '@/components/work-items/WorkItemDetail';
import type { WorkItemViewConfig } from '@/lib/work-items/types';

import { CONFIG, detail, installFetch, MEMBERS, PROJECT, renderWorkspace, row, TEAM } from '../helpers/work-items-harness';

const withUnit = (estimateUnit: 'POINTS' | 'HOURS' | null): WorkItemViewConfig => ({ ...CONFIG, teams: [{ id: TEAM, name: 'Core', estimateUnit }] });

function routes(over: Partial<ReturnType<typeof row>> = {}, extra: Parameters<typeof installFetch>[0] = {}) {
    return installFetch({
        'GET /work-items/wi-1': { body: detail(row(1, over)) },
        'GET /work-items/wi-1/ancestry': { body: { item: { id: 'wi-1', key: 'ISL-1', title: 'Item 1' }, parents: [], project: null, initiative: null, goals: [], directGoals: null, hiddenLevels: 0 } },
        'GET /users/assignable': { body: MEMBERS },
        'GET /work-items/wi-1/watchers': { body: [] },
        [`GET /projects/${PROJECT}/custom-fields`]: { body: [] },
        ...extra,
    });
}

describe("the detail's estimate", () => {
    it('shows points, sends a change with If-Match and the unit, and has no axe violations', async () => {
        const { calls } = routes({ estimatePoints: 3 }, { 'PUT /work-items/wi-1/estimate': { body: detail(row(1, { estimatePoints: 5, version: 2 })) } });
        const { container } = renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: withUnit('POINTS') });
        const input = await screen.findByRole('textbox', { name: 'Estimate' });
        expect(input).toHaveValue('3');
        fireEvent.change(input, { target: { value: '5' } });
        fireEvent.blur(input);
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put).toMatchObject({ path: '/work-items/wi-1/estimate', body: { value: 5, unit: 'POINTS' }, ifMatch: '"1"' });
        expect(await axe(container)).toHaveNoViolations();
    });

    it('reads hours as a duration, sends minutes, and refuses what it cannot parse without sending it', async () => {
        const { calls } = routes({ estimatePoints: 4, estimateMinutes: null }, { 'PUT /work-items/wi-1/estimate': { body: detail(row(1, { estimateMinutes: 150, version: 2 })) } });
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: withUnit('HOURS') });
        const input = await screen.findByRole('textbox', { name: 'Estimate' });
        // The points the item kept from before are not the estimate under hours.
        expect(input).toHaveValue('');
        fireEvent.change(input, { target: { value: 'two hours' } });
        fireEvent.blur(input);
        expect(await screen.findByText(/Give a duration such as 2h 30m/)).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
        fireEvent.change(input, { target: { value: '2h 30m' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ value: 150, unit: 'HOURS' }));
    });

    it('offers no estimate for a team that does not estimate', async () => {
        routes({ estimatePoints: 3 });
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: withUnit(null) });
        await screen.findByRole('textbox', { name: /Title/ });
        expect(screen.queryByRole('textbox', { name: 'Estimate' })).toBeNull();
    });

    it('a Viewer cannot change it', async () => {
        routes({ estimatePoints: 3 });
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: withUnit('POINTS'), role: 'VIEWER' });
        expect(await screen.findByRole('textbox', { name: 'Estimate' })).toBeDisabled();
    });
});

describe('the cached row', () => {
    it('keeps both estimate columns, so a list or card placed after a write shows the estimate', () => {
        expect(toRow(row(1, { estimatePoints: 5, estimateMinutes: 90 }))).toMatchObject({ estimatePoints: 5, estimateMinutes: 90 });
        expect(toRow(row(1))).toMatchObject({ estimatePoints: null, estimateMinutes: null });
    });
});

describe('an estimate as text', () => {
    it('reads points and hours, and nothing for none or a team that does not estimate', () => {
        const { rerender, container } = renderWorkspace(<EstimateText unit="POINTS" value={1} />);
        expect(container).toHaveTextContent('1 pt');
        rerender(<EstimateText unit="POINTS" value={5} />);
        expect(container).toHaveTextContent('5 pts');
        rerender(<EstimateText unit="HOURS" value={150} />);
        expect(container).toHaveTextContent('2h 30m');
        rerender(<EstimateText unit={null} value={5} />);
        expect(container.textContent).toBe('');
    });
});

describe("the burn-up's measures", () => {
    const points = [
        { date: '2026-11-16', scope: 8, started: 3, completed: 0, unestimated: 2 },
        { date: '2026-11-17', scope: 13, started: 8, completed: 5, unestimated: 1 },
    ];

    it('offers the server\'s measures, shows the summary line and the unestimated column, with no axe violations', async () => {
        const onMeasure = jest.fn();
        const { container } = renderWorkspace(<BurnUpChart points={points} measure="points" measures={['items', 'points']} onMeasure={onMeasure} />);
        expect(screen.getByTestId('burn-up-summary')).toHaveTextContent('13 points in scope, 1 item not estimated');
        const table = screen.getByRole('table', { name: /at the end of each day/ });
        expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Day', 'Scope', 'Started', 'Completed', 'Not estimated']);
        fireEvent.click(screen.getByRole('radio', { name: 'Items' }));
        expect(onMeasure).toHaveBeenCalledWith('items');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('reads hours as durations, and offers no switch when only items are counted', () => {
        const { rerender } = renderWorkspace(<BurnUpChart points={[{ date: '2026-11-16', scope: 150, started: 60, completed: 0, unestimated: 0 }]} measure="hours" measures={['items', 'hours']} onMeasure={() => undefined} />);
        expect(screen.getByTestId('burn-up-summary')).toHaveTextContent('2h 30m in scope, every item estimated');
        expect(within(screen.getByRole('table', { name: /at the end of each day/ })).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2h 30m', '1h', '0m', '0']);
        rerender(<BurnUpChart points={[{ date: '2026-11-16', scope: 1, started: 0, completed: 0 }]} measures={['items']} onMeasure={() => undefined} />);
        expect(screen.queryByRole('radio', { name: 'Items' })).toBeNull();
        expect(screen.queryByTestId('burn-up-summary')).toBeNull();
    });
});
