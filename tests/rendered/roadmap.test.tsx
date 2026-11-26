/** @jest-environment jsdom */

/**
 * The roadmap (sub-phase 3.2c; decisions 203, 215, 216 and 217): the table
 * shows the same rows as the chart with no axe violations, every row's "Open
 * timeline" naming the item timeline; the "No dates" list; a scope over the
 * limit says so and draws nothing; the chart renders the widget read-only
 * (no editor, toolbar or menu, nothing from the vendor's CDN) and choosing a
 * bar opens the project's timeline; the Roadmap page's tab bar.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

const push = jest.fn();
let pathname = '/t/acme/roadmap';
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => pathname,
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { RoadmapView } from '@/components/goals/RoadmapView';
import { RoadmapTabs } from '@/components/goals/goal-parts';
import { uiStorageKey } from '@/lib/ui-storage';

import { ROADMAP } from '../helpers/roadmap-fixture';
import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const ROUTE = 'GET /roadmap';

function setMode(mode: 'chart' | 'table') {
    window.localStorage.setItem(uiStorageKey('roadmap', 'mode'), JSON.stringify(mode));
}

afterEach(() => {
    window.localStorage.clear();
    push.mockReset();
});

describe('the table (the accessible equivalent)', () => {
    it('lists goal, initiative and project rows with their dates, progress, health, flags and timeline links', async () => {
        setMode('table');
        installFetch({ [ROUTE]: { body: ROADMAP } });
        const { container } = renderWorkspace(<RoadmapView filters={{}} />);
        const table = await screen.findByTestId('roadmap-table');
        const launch = await within(table).findByRole('link', { name: 'Open the timeline of Launch' });
        expect(launch).toHaveAttribute('href', '/t/acme/work-items?layout=timeline&initiativeId=i1');
        expect(within(table).getByRole('link', { name: 'Open the timeline of Beta' })).toHaveAttribute('href', '/t/acme/projects/BET?layout=timeline');
        expect(within(table).getByText(/1 late milestone; Finishes after the initiative's due date/)).toBeInTheDocument();
        expect(within(table).getByText('No initiative')).toBeInTheDocument();
        expect(within(table).getAllByText('At risk').length).toBeGreaterThan(0);
        expect(screen.getByTestId('roadmap-summary')).toHaveTextContent(/Planned dates/);
        expect(await axe(container)).toHaveNoViolations();
    });

    it('a scope over the limit says so and draws nothing', async () => {
        setMode('table');
        installFetch({ [ROUTE]: { status: 422, body: { error: { code: 'ROADMAP_TOO_LARGE', message: 'too large', details: { reason: 'ROADMAP_TOO_LARGE', count: 612, limit: 500, what: 'projects' } } } } });
        renderWorkspace(<RoadmapView filters={{}} />);
        expect(await screen.findByTestId('roadmap-too-large')).toHaveTextContent('This roadmap would show 612 projects; it shows at most 500.');
        expect(screen.queryByTestId('roadmap-table')).toBeNull();
    });

    it('sends the filters it is given', async () => {
        setMode('table');
        const { calls } = installFetch({ [ROUTE]: { body: ROADMAP } });
        renderWorkspace(<RoadmapView filters={{ initiativeId: 'i1', archived: 'true' }} />);
        await screen.findByTestId('roadmap-table');
        const read = calls.find((c) => c.path === '/roadmap')!;
        expect(Object.fromEntries(read.search)).toEqual({ initiativeId: 'i1', archived: 'true' });
    });
});

describe('the chart (the widget, read-only)', () => {
    const original = HTMLCanvasElement.prototype.getContext;
    const SIZES = { clientWidth: 1600, clientHeight: 900, offsetWidth: 1600, offsetHeight: 900 };
    const saved: Record<string, PropertyDescriptor | undefined> = {};
    let savedObserver: typeof ResizeObserver;
    beforeAll(() => {
        const ctx2d = new Proxy({} as Record<string, unknown>, {
            get: (target, prop) => (prop in target ? target[prop as string] : prop === 'measureText' ? (t: string) => ({ width: t.length * 7 }) : () => undefined),
            set: (target, prop, value) => {
                target[prop as string] = value;
                return true;
            },
        });
        HTMLCanvasElement.prototype.getContext = (() => ctx2d) as unknown as typeof HTMLCanvasElement.prototype.getContext;
        for (const [prop, value] of Object.entries(SIZES)) {
            saved[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
            Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
        }
        savedObserver = window.ResizeObserver;
        window.ResizeObserver = class {
            constructor(private cb: ResizeObserverCallback) {}
            observe(target: Element) {
                queueMicrotask(() => this.cb([{ target, contentRect: { width: SIZES.clientWidth, height: SIZES.clientHeight } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver));
            }
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
    });
    afterAll(() => {
        HTMLCanvasElement.prototype.getContext = original;
        for (const [prop, desc] of Object.entries(saved)) {
            if (desc) Object.defineProperty(HTMLElement.prototype, prop, desc);
            else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
        }
        window.ResizeObserver = savedObserver;
    });

    it('draws the bars read-only with the "No dates" list, and a chosen bar opens the project\'s timeline', async () => {
        installFetch({ [ROUTE]: { body: ROADMAP } });
        const { container } = renderWorkspace(<RoadmapView filters={{}} />);
        const region = await screen.findByRole('region', { name: 'Roadmap chart' });
        expect(region).toHaveAccessibleDescription(/table view shows the same rows/);
        await waitFor(() => expect(container.querySelector('.isl-timeline-bar')).not.toBeNull());
        // Never editable: the widget is read-only, no editor, toolbar or menu, nothing from the vendor's CDN.
        expect(container.querySelector('.isl-timeline[data-editable]')).toBeNull();
        expect(container.querySelector('.wx-editor, .wx-toolbar, .wx-menu')).toBeNull();
        expect(document.querySelector('link[href*="cdn.svar.dev"]')).toBeNull();
        const bar = [...container.querySelectorAll('.isl-timeline-bar')].find((b) => b.textContent === 'Alpha')!;
        expect(bar).toHaveAttribute('data-kind', 'roadmap-project');
        fireEvent.mouseDown(bar);
        fireEvent.mouseUp(bar);
        fireEvent.click(bar);
        fireEvent.dblClick(bar);
        await waitFor(() => expect(push).toHaveBeenCalledWith('/t/acme/projects/ALP?layout=timeline'));
        expect(container.querySelector('.wx-editor, .wx-sidearea, [role="dialog"]')).toBeNull();
        const noDates = screen.getByTestId('roadmap-no-dates');
        expect(within(noDates).getByRole('link', { name: 'Open the timeline of Someday' })).toHaveAttribute('href', '/t/acme/work-items?layout=timeline&initiativeId=i2');
        await act(async () => {
            fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
        });
        expect(await screen.findByTestId('roadmap-table')).toBeInTheDocument();
    });
});

describe('the tab bar (decision 222)', () => {
    it('marks the Roadmap page current on its own path only', () => {
        pathname = '/t/acme/roadmap';
        const { unmount } = renderWorkspace(<RoadmapTabs />);
        expect(screen.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Goals' })).not.toHaveAttribute('aria-current');
        unmount();
        pathname = '/t/acme/roadmap/goals/g1';
        renderWorkspace(<RoadmapTabs />);
        expect(screen.getByRole('link', { name: 'Roadmap' })).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('link', { name: 'Goals' })).toHaveAttribute('aria-current', 'page');
    });
});
