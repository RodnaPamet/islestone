/** @jest-environment jsdom */

/**
 * My Work (owner decisions 54, 76 and 152): six sections, each a read of the
 * shared list query with its own filters ("To review" asks the server for
 * `reviewerId=me`, 2.8b; "Waiting on me" for `waitingOnId=me`, 2.7a), a
 * count, an empty state and an explicit
 * "Load more"; closed categories hidden unless the category filter names
 * some; an item in several sections; a row opening the detail sheet; no axe
 * violations. Queries are by role and label.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/my-work',
    useSearchParams: () => new URLSearchParams(window.location.search),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { DUE_SOON_DAYS } from '@/app-layer/domain/work-item-due';
import { MY_WORK_PAGE_SIZE, MyWorkView } from '@/components/work-items/MyWorkView';

import { detail, installFetch, MEMBERS, renderWorkspace, row, type Recorded } from '../helpers/work-items-harness';

const ME = 'u-ada';
const shared = row(1, { title: 'Shared item', assigneeId: ME, createdByUserId: ME, dueDate: '2026-11-21' });

/** Which section a list read is, by its filters. */
function sectionOf(req: Recorded): 'toReview' | 'assigned' | 'waitingOn' | 'created' | 'watching' | 'dueSoon' | 'other' {
    const s = req.search;
    if (s.get('reviewerId') === 'me') return 'toReview';
    if (s.get('watching') === 'me') return 'watching';
    if (s.get('waitingOnId') === 'me') return 'waitingOn';
    if (s.get('createdById') === ME) return 'created';
    if (s.get('assigneeId') === ME && s.get('due') === 'soon') return 'dueSoon';
    if (s.get('assigneeId') === ME) return 'assigned';
    return 'other';
}

function routes(answers: Partial<Record<ReturnType<typeof sectionOf>, { items: ReturnType<typeof row>[]; hasNextPage?: boolean; nextCursor?: string; contentMatchesBounded?: boolean }>>) {
    return installFetch({
        'GET /work-items': (req) => {
            const a = answers[sectionOf(req)] ?? { items: [] };
            // A second page (after "Load more") answers one more row and ends.
            if (req.search.get('cursor')) return { body: { items: [row(99, { title: 'Page two item' })], pageInfo: { hasNextPage: false } } };
            return { body: { items: a.items, pageInfo: { hasNextPage: !!a.hasNextPage, nextCursor: a.nextCursor }, contentMatchesBounded: !!a.contentMatchesBounded } };
        },
        'GET /users/assignable': { body: MEMBERS },
        'GET /work-items/wi-1': { body: detail(shared) },
        'GET /work-items/wi-1/comments': { body: { items: [], pageInfo: { hasNextPage: false } } },
        'GET /work-items/wi-1/watchers': { body: [] },
        'GET /work-items/wi-1/activity': { body: { items: [], pageInfo: { hasNextPage: false } } },
    });
}

function renderMyWork() {
    return renderWorkspace(<MyWorkView userId={ME} title="My Work" />, { userId: ME });
}

const region = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/t/acme/my-work');
});

describe('My Work', () => {
    it('shows six sections, an item in each it belongs to, with counts and empty states, and no axe violations', async () => {
        routes({
            toReview: {
                items: [
                    row(4, {
                        title: 'Asks my review',
                        assigneeId: 'u-bob',
                        review: { state: 'open', roundNumber: 1, step: { name: 'Legal', dueOn: '2026-11-25', pendingCount: 2 } },
                    }),
                ],
            },
            assigned: { items: [shared, row(2, { title: 'Only assigned', assigneeId: ME })] },
            waitingOn: { items: [row(3, { title: 'Waits on me', assigneeId: 'u-grace', waitingOnUserId: ME })] },
            created: { items: [shared] },
            dueSoon: { items: [shared] },
            watching: { items: [] },
        });
        const { container } = renderMyWork();
        expect(screen.getByRole('heading', { level: 1, name: 'My Work' })).toBeInTheDocument();
        const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
        expect(names).toEqual(['To review', 'Assigned to me', 'Waiting on me', 'Created by me', 'Watching', 'Due soon']);

        // "To review" first, each row with its open step, how many it waits on and its due day.
        const toReview = region('To review');
        expect(await within(toReview).findByRole('link', { name: 'Asks my review' })).toBeInTheDocument();
        expect(within(toReview).getByText('Legal: 2 pending · due 2026-11-25')).toBeInTheDocument();
        expect(within(toReview).getByText('1')).toBeInTheDocument();
        expect(within(toReview).getByText('Open review steps that still ask you to sign off or return.')).toBeInTheDocument();

        expect(await within(region('Assigned to me')).findByRole('link', { name: 'Only assigned' })).toBeInTheDocument();
        expect(within(region('Assigned to me')).getByRole('link', { name: 'Shared item' })).toBeInTheDocument();
        expect(await within(region('Waiting on me')).findByRole('link', { name: 'Waits on me' })).toBeInTheDocument();
        expect(within(region('Waiting on me')).queryByRole('link', { name: 'Shared item' })).toBeNull();
        expect(await within(region('Created by me')).findByRole('link', { name: 'Shared item' })).toBeInTheDocument();
        expect(await within(region('Due soon')).findByRole('link', { name: 'Shared item' })).toBeInTheDocument();
        expect(await within(region('Watching')).findByText('Nothing you watch matches these filters.')).toBeInTheDocument();

        // Counts of the loaded rows.
        expect(within(region('Assigned to me')).getByText('2')).toBeInTheDocument();
        expect(within(region('Waiting on me')).getByText('1')).toBeInTheDocument();
        expect(within(region('Created by me')).getByText('1')).toBeInTheDocument();
        expect(within(region('Watching')).getByText('0')).toBeInTheDocument();
        expect(within(region('Due soon')).getByText(`Your open items that are overdue or due within ${DUE_SOON_DAYS} days.`)).toBeInTheDocument();

        // Two rules belong to the mirrored DataTable (src/components/ui/table,
        // never edited here): its row chevron's empty header cell, and its
        // scroll region's fixed label ("Table contents (scrollable)"), which
        // repeats when a page holds several tables. The sections' own regions
        // are unique: `region(name)` above would throw on a duplicate.
        expect(
            await axe(container, { rules: { 'empty-table-header': { enabled: false }, 'landmark-unique': { enabled: false } } }),
        ).toHaveNoViolations();
    });

    it('reads each section with its own filters, the person from the page, watching=me and waitingOnId=me, open categories by default', async () => {
        const { calls } = routes({});
        renderMyWork();
        await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.path === '/work-items')).toHaveLength(6));
        const reads = calls.filter((c) => c.method === 'GET' && c.path === '/work-items');
        const bySection = Object.fromEntries(reads.map((r) => [sectionOf(r), r.search]));
        expect(Object.keys(bySection).sort()).toEqual(['assigned', 'created', 'dueSoon', 'toReview', 'waitingOn', 'watching']);
        expect(bySection.toReview!.get('reviewerId')).toBe('me');
        expect(bySection.toReview!.get('assigneeId')).toBeNull();
        expect(bySection.toReview!.get('waitingOnId')).toBeNull();
        // The server resolves `me` from the request context; the client never sends its own id for it.
        expect(bySection.waitingOn!.get('waitingOnId')).toBe('me');
        expect(bySection.waitingOn!.get('assigneeId')).toBeNull();
        expect(bySection.waitingOn!.get('createdById')).toBeNull();
        expect(bySection.watching!.get('assigneeId')).toBeNull();
        expect(bySection.watching!.get('createdById')).toBeNull();
        expect(bySection.created!.get('assigneeId')).toBeNull();
        expect(bySection.assigned!.get('due')).toBeNull();
        for (const search of reads.map((r) => r.search)) {
            expect(search.get('stateCategory')).toBe('BACKLOG,UNSTARTED,STARTED');
            expect(search.get('order')).toBe('manual');
            expect(search.get('limit')).toBe(String(MY_WORK_PAGE_SIZE));
        }
        expect(screen.getByText(/Done and cancelled items are hidden/)).toBeInTheDocument();
    });

    it('reads the reviewer filter from the address into every section, "To review" keeping its own', async () => {
        window.history.replaceState(null, '', '/t/acme/my-work?reviewerId=u-bob');
        const { calls } = routes({});
        renderMyWork();
        await waitFor(() => expect(calls.filter((c) => c.path === '/work-items')).toHaveLength(6));
        const reads = calls.filter((c) => c.path === '/work-items');
        expect(reads.filter((c) => c.search.get('reviewerId') === 'u-bob')).toHaveLength(5);
        expect(reads.filter((c) => c.search.get('reviewerId') === 'me')).toHaveLength(1);
    });

    it('shows an empty "To review" in its own words', async () => {
        routes({});
        renderMyWork();
        expect(await within(region('To review')).findByText('No open review step asks you, among the items that match these filters.')).toBeInTheDocument();
    });

    it('shows closed items when the category filter names them', async () => {
        // The filter system reads its state from the address.
        window.history.replaceState(null, '', '/t/acme/my-work?stateCategory=DONE');
        const { calls } = routes({});
        renderMyWork();
        await waitFor(() => expect(calls.filter((c) => c.path === '/work-items')).toHaveLength(6));
        for (const c of calls.filter((x) => x.path === '/work-items')) expect(c.search.get('stateCategory')).toBe('DONE');
        expect(screen.queryByText(/Done and cancelled items are hidden/)).toBeNull();
    });

    it('marks a count "N+" while more pages exist, and "Load more" reads the next page into that section only', async () => {
        const { calls } = routes({ assigned: { items: [shared], hasNextPage: true, nextCursor: 'c1' } });
        renderMyWork();
        const assigned = region('Assigned to me');
        expect(await within(assigned).findByText('1+')).toBeInTheDocument();
        expect(within(region('Created by me')).queryByRole('button', { name: 'Load more in Created by me' })).toBeNull();
        fireEvent.click(within(assigned).getByRole('button', { name: 'Load more in Assigned to me' }));
        expect(await within(assigned).findByRole('link', { name: 'Page two item' })).toBeInTheDocument();
        expect(within(region('Created by me')).queryByRole('link', { name: 'Page two item' })).toBeNull();
        const next = calls.find((c) => c.search.get('cursor') === 'c1');
        expect(next && sectionOf(next)).toBe('assigned');
        await waitFor(() => expect(within(assigned).queryByRole('button', { name: 'Load more in Assigned to me' })).toBeNull());
        expect(within(assigned).getByText('2')).toBeInTheDocument();
    });

    it('says in a section that it is showing recent matches when its content matches were bounded (decision 250)', async () => {
        routes({ assigned: { items: [shared], contentMatchesBounded: true }, created: { items: [shared] } });
        renderMyWork();
        await within(region('Assigned to me')).findByRole('link', { name: 'Shared item' });
        expect(within(region('Assigned to me')).getByRole('note')).toHaveTextContent(/showing the most recent of those matches/);
        await within(region('Created by me')).findByRole('link', { name: 'Shared item' });
        expect(within(region('Created by me')).queryByRole('note')).toBeNull();
    });

    it('opens the detail sheet from a row', async () => {
        routes({ assigned: { items: [shared] } });
        renderMyWork();
        const link = await within(region('Assigned to me')).findByRole('link', { name: 'Shared item' });
        fireEvent.click(link.closest('td')!);
        const body = await screen.findByTestId('work-item-sheet-body');
        expect(within(body).getByRole('heading', { name: 'Shared item' })).toBeInTheDocument();
    });
});
