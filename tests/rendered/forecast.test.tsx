/** @jest-environment jsdom */

/**
 * The forecast in the browser (sub-phase 3.6c; owner decisions 318 to 325;
 * docs/porting/maps/3.6.md, "Where analytics appear"): a scope page's
 * Forecast section (the three likely dates, never "confidence", the chance by
 * the due date, the basis and assumptions, the caution), "Details" opening
 * the sheet with the history, share and basis a person may change (each
 * change a new read), the distribution and the "Chance finished by" curve
 * each with its table, and "How this was computed" with the seed and the
 * scope's own record; a refusal's sentence with its counts and no date; the
 * list's Forecast action; a forecast over its bound named; no axe
 * violations. visx's `ParentSize` measures nothing in jsdom, so the tables
 * are what is read.
 *
 * Written fresh for Islestone.
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/projects/PLT',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { ForecastAction, ForecastSection } from '@/components/analytics/forecast/ForecastSection';
import { chancePercent } from '@/components/analytics/forecast/ForecastPanel';
import type { ForecastResponse } from '@/lib/analytics/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const platform = { id: 'p1', name: 'Platform', keyPrefix: 'PLT' };
const web = { id: 'p2', name: 'Web', keyPrefix: 'WEB' };

const dated: ForecastResponse = {
    asOf: '2026-11-27',
    timeZone: 'Europe/Sofia',
    calendarTeamId: null,
    setAside: [],
    scope: { kind: 'project', dueDate: '2026-12-18' },
    remaining: 30,
    basedOn: { kind: 'projects', projects: [platform, web], team: null },
    offered: { projects: [platform, web], team: { id: 't1', name: 'Core' } },
    history: { weeks: 12, from: '2026-09-04', to: '2026-11-26', completions: 42, workingDays: 60 },
    share: 100,
    trials: 10_000,
    seed: 123456789,
    refused: null,
    cautions: ['FEW_COMPLETIONS'],
    likely: { p50: { date: '2026-12-10', beyond: false }, p85: { date: '2026-12-17', beyond: false }, p95: { date: '2026-12-22', beyond: false } },
    due: { date: '2026-12-18', finished: 8_734, passed: false },
    histogram: {
        resolution: 'day',
        buckets: [
            { start: '2026-12-09', end: '2026-12-09', trials: 4_000 },
            { start: '2026-12-10', end: '2026-12-10', trials: 6_000 },
        ],
        beyond: 0,
    },
    curve: [
        { date: '2026-12-09', finished: 4_000 },
        { date: '2026-12-10', finished: 10_000 },
    ],
    record: { status: 'SHOWN', size: 30, p50: { scorable: 34, held: 18 }, p85: { scorable: 34, held: 29 }, p95: { scorable: 33, held: 32 } },
};

describe('the Forecast section', () => {
    it('shows the likely dates, the chance by the due date, the basis, the assumption and the caution, and has no axe violations', async () => {
        const fetch = installFetch({ 'GET /analytics/forecast': { body: dated } });
        const { container } = renderWorkspace(<ForecastSection filters={{ projectId: 'p1' }} />);
        const section = await screen.findByRole('region', { name: 'Forecast' });
        expect(await within(section).findByTestId('forecast-p50')).toHaveTextContent('10 Dec 2026');
        expect(within(section).getByTestId('forecast-p85')).toHaveTextContent('17 Dec 2026');
        expect(within(section).getByTestId('forecast-p95')).toHaveTextContent('22 Dec 2026');
        expect(within(section).getByText('85% likely')).toBeInTheDocument();
        expect(within(section).queryByText(/confidence/i)).toBeNull();
        expect(within(section).getByTestId('forecast-due')).toHaveTextContent('87% chance of finishing by the due date, 18 Dec 2026.');
        expect(within(section).getByText(/30 open items\. Based on Platform, Web: 42 items finished in the last 12 weeks\./)).toBeInTheDocument();
        expect(within(section).getByText('Assumes these items get all of that throughput and no new items are added.')).toBeInTheDocument();
        expect(within(section).getByRole('note')).toHaveTextContent('Based on few items; the range is wide.');
        const read = fetch.calls.find((c) => c.path === '/analytics/forecast')!;
        expect(read.search.get('projectId')).toBe('p1');
        expect(read.search.get('share')).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('opens the details: the controls, the distribution and the curve with their tables, the seed and the record; a change is a new read', async () => {
        const fetch = installFetch({ 'GET /analytics/forecast': (rec) => ({ body: { ...dated, share: Number(rec.search.get('share') ?? 100) } }) });
        renderWorkspace(<ForecastSection filters={{ projectId: 'p1' }} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
        const sheet = await screen.findByTestId('forecast-detail');
        const histogram = within(sheet).getByRole('region', { name: 'Distribution' });
        expect(within(histogram).getByRole('table', { name: 'Trials finishing per working day' })).toBeInTheDocument();
        expect(within(histogram).getByRole('rowheader', { name: '10 Dec 2026' })).toBeInTheDocument();
        const curve = within(sheet).getByRole('region', { name: 'Chance finished by' });
        expect(within(curve).getByRole('cell', { name: '40%' })).toBeInTheDocument();
        expect(within(curve).getByRole('cell', { name: '100%' })).toBeInTheDocument();
        expect(within(sheet).getByTestId('forecast-seed')).toHaveTextContent('10,000 trials; seed 123456789.');
        expect(within(sheet).getByTestId('forecast-record')).toHaveTextContent('Of 34 earlier forecasts here, the 85% date held 29 times');
        expect(within(sheet).getByRole('radio', { name: 'Core team' })).toBeInTheDocument();

        fireEvent.click(within(sheet).getByRole('radio', { name: '50%' }));
        expect(await within(await screen.findByTestId('forecast-detail')).findByText('Assumes these items get 50% of that throughput and no new items are added.')).toBeInTheDocument();
        expect(fetch.calls.some((c) => c.path === '/analytics/forecast' && c.search.get('share') === '50')).toBe(true);
        fireEvent.click(within(await screen.findByTestId('forecast-detail')).getByRole('radio', { name: '26 weeks' }));
        await screen.findByTestId('forecast-detail');
        expect(fetch.calls.some((c) => c.path === '/analytics/forecast' && c.search.get('historyWeeks') === '26' && c.search.get('share') === '50')).toBe(true);
    });

    it('gives a refusal as its sentence with the counts, and no date', async () => {
        installFetch({
            'GET /analytics/forecast': {
                body: { ...dated, refused: { reason: 'TOO_FEW_COMPLETIONS', completions: 12, needed: 20, weeks: 12 }, likely: null, due: null, histogram: null, curve: null, cautions: [], record: { status: 'NONE' } },
            },
        });
        renderWorkspace(<ForecastSection filters={{ projectId: 'p1' }} />);
        expect(await screen.findByTestId('forecast-refused')).toHaveTextContent('Not enough history to forecast: 12 items finished in the last 12 weeks; a forecast needs at least 20.');
        expect(screen.queryByTestId('forecast-dates')).toBeNull();
        expect(screen.queryByText(/Assumes/)).toBeNull();
    });

    it('says a later-than date past two years, and a due date that has passed', async () => {
        installFetch({ 'GET /analytics/forecast': { body: { ...dated, likely: { ...dated.likely!, p95: { date: '2028-11-27', beyond: true } }, due: { date: '2026-11-20', finished: null, passed: true } } } });
        renderWorkspace(<ForecastSection filters={{ projectId: 'p1' }} />);
        expect(await screen.findByTestId('forecast-p95')).toHaveTextContent('Later than 27 Nov 2028');
        expect(screen.getByTestId('forecast-due')).toHaveTextContent('The due date, 20 Nov 2026, is today or has passed.');
    });
});

describe('the list\'s Forecast action', () => {
    it('opens the sheet for the current filters, and names a forecast over its bound', async () => {
        const fetch = installFetch({
            'GET /analytics/forecast': { status: 422, body: { error: { code: 'ANALYTICS_TOO_LARGE', message: 'Too many', details: { reason: 'ANALYTICS_TOO_LARGE', what: 'completions', count: 50_001, limit: 50_000 } } } },
        });
        renderWorkspace(<ForecastAction filters={{ labelId: 'bug', order: 'manual' }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Forecast' }));
        expect(await screen.findByTestId('forecast-too-large')).toHaveTextContent('more than 50,000 completed items');
        const read = fetch.calls.find((c) => c.path === '/analytics/forecast')!;
        expect(read.search.get('labelId')).toBe('bug');
        expect(read.search.get('order')).toBeNull();
    });
});

describe('chancePercent', () => {
    it('reads 0 or 100 only when none or all of the trials finished', () => {
        expect(chancePercent(0, 10_000)).toBe(0);
        expect(chancePercent(1, 10_000)).toBe(1);
        expect(chancePercent(9_999, 10_000)).toBe(99);
        expect(chancePercent(10_000, 10_000)).toBe(100);
        expect(chancePercent(8_734, 10_000)).toBe(87);
    });
});
