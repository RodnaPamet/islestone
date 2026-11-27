/** @jest-environment jsdom */

/**
 * The Analytics page in the browser (sub-phase 3.6a; owner decisions 324 and
 * 329; docs/porting/maps/3.6.md, "Where analytics appear"): the counts, the
 * five fixed charts each with its table (the accessible fallback), the
 * window and the set-aside status filters named, a chart over its bound
 * saying so with the count (never a cut chart) while the others draw, each
 * read its own request with the window, and no axe violations; time waiting
 * (3.6b) with every party's rows when the server gives them, the reader's own
 * row alone otherwise, and a chart over its review bound. visx's
 * `ParentSize` measures nothing in jsdom, so the tables are what is read.
 *
 * Written fresh for Islestone.
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/analytics',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { AnalyticsView } from '@/components/analytics/AnalyticsView';
import type { CountsResponse, DurationsResponse, FlowResponse, ThroughputResponse, WaitingPartyRow, WaitingResponse } from '@/lib/analytics/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const ALL = { view: true, share: true, people: true };
const frame = { from: '2026-09-07', to: '2026-11-29', asOf: '2026-11-27', timeZone: 'Europe/Sofia', calendarTeamId: null, setAside: [] as Array<'stateId' | 'stateCategory' | 'due'> };

const counts: CountsResponse = { ...frame, open: 12, started: 4, doneInWindow: 30, createdInWindow: 25 };
const throughput: ThroughputResponse = {
    ...frame,
    setAside: ['stateCategory'],
    bin: 'week',
    bins: [
        { start: '2026-11-16', end: '2026-11-22', count: 7, whole: true },
        { start: '2026-11-23', end: '2026-11-27', count: 3, whole: false },
    ],
    total: 10,
    median: 7,
};
const durations: DurationsResponse = {
    ...frame,
    measure: 'cycle',
    cycleTime: { count: 2, p50: 1.5, p85: 3, p95: 3 },
    leadTime: { count: 3, p50: 4, p85: 6.2, p95: 6.2 },
    doneWithoutStarting: 1,
    points: [
        { workItemId: 'w1', key: 'PLT-1', title: 'Ship it', completedOn: '2026-11-26', cycleTime: 1.5, leadTime: 4 },
        { workItemId: 'w2', key: 'PLT-2', title: 'Skip it', completedOn: '2026-11-25', cycleTime: null, leadTime: 6.2 },
    ],
    pointsNewestOnly: false,
    age: [{ workItemId: 'w3', key: 'PLT-3', title: 'Still going', startedOn: '2026-11-10', age: 12.4 }],
    ageTotal: 1,
};

const ZERO_ENDED = { count: 0, p50: null, p85: null };
const anaRow: WaitingPartyRow = {
    party: { kind: 'member', userId: 'u-ana', name: 'Ana', active: true },
    waited: 3.5,
    asReviewer: 2,
    items: 2,
    ended: { count: 2, p50: 1, p85: 2.5 },
    waitingNow: 1,
    waitingNowItems: [{ workItemId: 'w9', key: 'PLT-9', title: 'Sign it off', asReviewer: true, age: 4.2 }],
};
const debRow: WaitingPartyRow = { party: { kind: 'member', userId: 'u-deb', name: 'Deb', active: false }, waited: 1, asReviewer: 0, items: 1, ended: { count: 1, p50: 1, p85: 1 }, waitingNow: 0, waitingNowItems: [] };
const formerRow: WaitingPartyRow = { party: { kind: 'former' }, waited: 0.5, asReviewer: 0, items: 1, ended: ZERO_ENDED, waitingNow: 0, waitingNowItems: [] };
const totals: WaitingResponse['totals'] = { waited: 5, asReviewer: 2, itemTimeWaiting: 4.5, openItemTime: 18, share: 0.25, items: 4, ended: { count: 3, p50: 1, p85: 2.5 }, waitingNow: 1 };
const waitingAll: WaitingResponse = { ...frame, totals, self: anaRow, people: [anaRow, debRow, formerRow], waitingNowCut: false, items: 9 };
const waitingOwn: WaitingResponse = { ...frame, totals, self: anaRow, waitingNowCut: false, items: 9 };

describe('the Analytics page', () => {
    it('shows the counts and every chart with its table, names the set-aside filters, and has no axe violations', async () => {
        const fetch = installFetch({
            'GET /analytics/counts': { body: counts },
            'GET /analytics/throughput': { body: throughput },
            'GET /analytics/durations': { body: durations },
            'GET /analytics/waiting': { body: waitingAll },
            'GET /analytics/flow': (rec) => ({
                body: {
                    ...frame,
                    resolution: 'day',
                    items: 16,
                    days: [{ date: '2026-11-27', backlog: 2, unstarted: 3, started: 4, done: 7 }],
                    burnUp: rec.search.get('burnUp') === '1' ? { measure: 'items', measures: ['items'], points: [{ date: '2026-11-27', scope: 16, started: 11, completed: 7 }] } : null,
                } satisfies FlowResponse,
            }),
        });
        const { container } = renderWorkspace(<AnalyticsView affordances={ALL} today="2026-11-27" />);
        expect(await screen.findByTestId('analytics-count-open')).toHaveTextContent('12');
        expect(screen.getByTestId('analytics-count-done')).toHaveTextContent('30');

        const throughputSection = screen.getByRole('region', { name: 'Throughput' });
        expect(within(throughputSection).getByText('10 done; a median week of 7.')).toBeInTheDocument();
        fireEvent.click(within(throughputSection).getByRole('button', { name: 'Show table' }));
        expect(within(throughputSection).getByRole('table', { name: 'Items done per period' })).toBeInTheDocument();
        expect(within(throughputSection).getByRole('rowheader', { name: '2026-11-16' })).toBeInTheDocument();

        const cycle = screen.getByRole('region', { name: 'Cycle time' });
        expect(within(cycle).getByText(/2 done: 50% within 1.5 days, 85% within 3, 95% within 3/)).toBeInTheDocument();
        expect(within(cycle).getByText(/1 item was done without starting/)).toBeInTheDocument();
        expect(within(cycle).getByRole('table', { name: 'Age of open, started items, the oldest first' })).toBeInTheDocument();
        expect(within(cycle).getByRole('cell', { name: '12.4 days' })).toBeInTheDocument();

        const lead = screen.getByRole('region', { name: 'Lead time' });
        expect(within(lead).getByRole('rowheader', { name: '6 to 7 days' })).toBeInTheDocument();

        const flow = screen.getByRole('region', { name: 'Cumulative flow' });
        expect(within(flow).getByText(/16 items followed/)).toBeInTheDocument();
        expect(await screen.findByRole('region', { name: 'Burn-up' })).toBeInTheDocument();

        expect(screen.getByTestId('analytics-frame')).toHaveTextContent('Set aside: Category');

        // Each read is its own request, over the twelve weeks ending today.
        const reads = fetch.calls.filter((c) => c.path.startsWith('/analytics/'));
        expect(new Set(reads.map((c) => c.path))).toEqual(new Set(['/analytics/counts', '/analytics/throughput', '/analytics/durations', '/analytics/flow', '/analytics/waiting']));
        for (const r of reads) expect([r.search.get('from'), r.search.get('to')]).toEqual(['2026-09-05', '2026-11-27']);
        expect(await axe(container)).toHaveNoViolations();
    });

    it('says a chart over its bound is too large, with the count, while the other charts draw', async () => {
        installFetch({
            'GET /analytics/counts': { body: counts },
            'GET /analytics/throughput': { body: throughput },
            'GET /analytics/durations': { body: durations },
            'GET /analytics/flow': { status: 422, body: { error: { code: 'ANALYTICS_TOO_LARGE', message: 'Too many', details: { reason: 'ANALYTICS_TOO_LARGE', what: 'items', count: 20001, limit: 20000 } } } },
        });
        renderWorkspace(<AnalyticsView affordances={ALL} today="2026-11-27" />);
        const flow = await screen.findByRole('region', { name: 'Cumulative flow' });
        expect(await within(flow).findByText('This scope follows more than 20000 items (20001). Narrow the filter or the window.')).toBeInTheDocument();
        expect(await screen.findByText('10 done; a median week of 7.')).toBeInTheDocument();
    });

    it('reads another window when one is chosen', async () => {
        const fetch = installFetch({ 'GET /analytics/counts': { body: counts }, 'GET /analytics/throughput': { body: throughput }, 'GET /analytics/durations': { body: durations } });
        renderWorkspace(<AnalyticsView affordances={ALL} today="2026-11-27" />);
        fireEvent.click(await screen.findByRole('radio', { name: '4 weeks' }));
        await screen.findByTestId('analytics-count-open');
        expect(fetch.calls.some((c) => c.path === '/analytics/throughput' && c.search.get('from') === '2026-10-31')).toBe(true);
    });

    it("shows time waiting per party when the server gives every row: a deactivated member marked, removed members as one row, what waits now", async () => {
        installFetch({ 'GET /analytics/counts': { body: counts }, 'GET /analytics/waiting': { body: waitingAll } });
        renderWorkspace(<AnalyticsView affordances={ALL} today="2026-11-27" />);
        const section = await screen.findByRole('region', { name: 'Time waiting' });
        expect(await within(section).findByText(/Open items spent 25% of their open time waiting on someone \(4.5 of 18 working days\)/)).toBeInTheDocument();
        expect(within(section).getByText(/3 waits ended: a median of 1 days, 85% within 2.5/)).toBeInTheDocument();
        expect(within(section).queryByText(/You see your own row/)).not.toBeInTheDocument();
        const table = within(section).getByRole('table', { name: 'Time waited per person in the window, in working days' });
        expect(within(table).getByRole('rowheader', { name: 'Ana' })).toBeInTheDocument();
        expect(within(table).getByRole('rowheader', { name: 'Deb (deactivated)' })).toBeInTheDocument();
        expect(within(table).getByRole('rowheader', { name: 'Former members' })).toBeInTheDocument();
        expect(within(table).getByRole('cell', { name: '2: median 1 days, 85% within 2.5' })).toBeInTheDocument();
        const now = within(section).getByRole('table', { name: 'What waits now, the oldest first' });
        expect(within(now).getByRole('cell', { name: 'PLT-9' })).toBeInTheDocument();
        expect(within(now).getByRole('cell', { name: 'Reviewer' })).toBeInTheDocument();
        expect(within(section).getByRole('img', { name: /Waited on Ana 3.5 days, 2 of them as a reviewer/ })).toBeInTheDocument();
    });

    it("shows the reader's own row alone, and says so, when the server gives no one else's", async () => {
        installFetch({ 'GET /analytics/counts': { body: counts }, 'GET /analytics/waiting': { body: waitingOwn } });
        renderWorkspace(<AnalyticsView affordances={{ ...ALL, people: false }} today="2026-11-27" />);
        const section = await screen.findByRole('region', { name: 'Time waiting' });
        expect(await within(section).findByText(/You see your own row; other people's rows are shown to those allowed to see them/)).toBeInTheDocument();
        const table = within(section).getByRole('table', { name: 'Time waited per person in the window, in working days' });
        expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Ana']);
    });

    it('says time waiting is too large when its review bound is crossed', async () => {
        installFetch({
            'GET /analytics/counts': { body: counts },
            'GET /analytics/waiting': { status: 422, body: { error: { code: 'ANALYTICS_TOO_LARGE', message: 'Too many', details: { reason: 'ANALYTICS_TOO_LARGE', what: 'reviews', count: 50001, limit: 50000 } } } },
        });
        renderWorkspace(<AnalyticsView affordances={ALL} today="2026-11-27" />);
        const section = await screen.findByRole('region', { name: 'Time waiting' });
        expect(await within(section).findByText('More than 50000 reviewers were asked in this scope and window (50001). Narrow the filter or the window.')).toBeInTheDocument();
    });
});
