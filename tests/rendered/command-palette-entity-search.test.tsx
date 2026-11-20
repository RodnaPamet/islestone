/**
 * The command palette's entity search, switched on by sub-phase 2.7b
 * (`ENTITY_SEARCH_AVAILABLE`): one call to `GET /api/t/<slug>/search?q=`,
 * whose pre-ranked `SearchHit[]` rows render grouped by type.
 *
 * Copied from inflect-compliance
 * `tests/rendered/command-palette-entity-search.test.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1) and edited: the hits
 * are Islestone's two types (work items, projects), the framework case is
 * gone, and a failed search and the switch itself are asserted. `global.fetch`
 * is stubbed to return canned `SearchResponse` payloads.
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';

import type { SearchHit, SearchResponse } from '@/lib/search/types';

const navigationMock = {
    pathname: '/t/acme/my-work',
    push: jest.fn(),
};
jest.mock('next/navigation', () => ({
    usePathname: () => navigationMock.pathname,
    useRouter: () => ({
        push: (href: string) => navigationMock.push(href),
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    }),
}));

jest.mock('next-auth/react', () => ({
    signOut: jest.fn(),
    signIn: jest.fn(),
}));

import { KeyboardShortcutProvider } from '@/lib/hooks/use-keyboard-shortcut';
import { CommandPalette, CommandPaletteProvider, useCommandPalette } from '@/components/command-palette';
import { ENTITY_SEARCH_AVAILABLE } from '@/components/command-palette/use-entity-search';

const calls: string[] = [];

function searchResponse(hits: SearchHit[], query: string): SearchResponse {
    return {
        hits,
        meta: {
            query,
            perTypeCounts: {
                workItem: hits.filter((h) => h.type === 'workItem').length,
                project: hits.filter((h) => h.type === 'project').length,
            },
            truncated: false,
            perTypeLimit: 5,
        },
    };
}

const SAMPLE_HITS: SearchHit[] = [
    {
        type: 'workItem',
        id: 'wi-1',
        title: 'Fix the login redirect',
        subtitle: 'ISL-12',
        badge: null,
        href: '/t/acme/work-items/ISL-12',
        score: 61,
        iconKey: 'work-item',
        category: 'Work items',
        matchedIn: 'title',
        snippet: null,
    },
    {
        type: 'project',
        id: 'pr-1',
        title: 'Login revamp',
        subtitle: 'LOG',
        badge: null,
        href: '/t/acme/projects/LOG',
        score: 60,
        iconKey: 'project',
        category: 'Projects',
        matchedIn: 'title',
        snippet: null,
    },
];

function installFetchStub(hits: SearchHit[] = SAMPLE_HITS, ok = true) {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (url: string) => {
        calls.push(url);
        const match = url.match(/[?&]q=([^&]+)/);
        const query = match ? decodeURIComponent(match[1]!) : '';
        return { ok, json: async () => searchResponse(hits, query) };
    });
}

async function typeIntoPalette(value: string) {
    const input = document.querySelector('[data-testid="command-palette-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value } });
    // useEntitySearch debounces 180 ms.
    await act(async () => {
        await new Promise((r) => setTimeout(r, 220));
    });
}

function OpenOnMount() {
    const { open } = useCommandPalette();
    React.useEffect(() => {
        open();
    }, [open]);
    return null;
}

function Shell() {
    return (
        <KeyboardShortcutProvider>
            <CommandPaletteProvider>
                <OpenOnMount />
                <CommandPalette />
            </CommandPaletteProvider>
        </KeyboardShortcutProvider>
    );
}

beforeEach(() => {
    calls.length = 0;
    navigationMock.pathname = '/t/acme/my-work';
    navigationMock.push.mockReset();
    installFetchStub();
});

afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
});

describe('CommandPalette — entity search (2.7b)', () => {
    it('is switched on', () => {
        expect(ENTITY_SEARCH_AVAILABLE).toBe(true);
    });

    it('issues exactly one /search request for the workspace in the URL', async () => {
        render(<Shell />);
        await typeIntoPalette('login');
        expect(calls).toEqual(['/api/t/acme/search?q=login']);
    });

    it('does not search below the minimum length', async () => {
        render(<Shell />);
        await typeIntoPalette('l');
        expect(calls).toHaveLength(0);
    });

    it('issues no request outside a workspace route and says why', async () => {
        navigationMock.pathname = '/login';
        render(<Shell />);
        await typeIntoPalette('login');
        expect(calls).toHaveLength(0);
        expect(document.querySelector('[cmdk-empty]')?.textContent).toBe('Search is available after sign-in.');
    });

    it('renders work items and projects under their headings, with the key beside the title', async () => {
        render(<Shell />);
        await typeIntoPalette('login');
        const item = await waitFor(() => {
            const row = document.querySelector('[data-testid="command-palette-result-workItem"]');
            expect(row).not.toBeNull();
            return row!;
        });
        expect(item.textContent).toContain('Fix the login redirect');
        expect(item.textContent).toContain('ISL-12');
        const project = document.querySelector('[data-testid="command-palette-result-project"]')!;
        expect(project.textContent).toContain('Login revamp');
        expect(project.textContent).toContain('LOG');
        const headings = Array.from(document.querySelectorAll('[cmdk-group-heading]')).map((h) => h.textContent);
        expect(headings).toEqual(expect.arrayContaining(['Work items', 'Projects']));
    });

    it('navigates to the hit and closes the palette on select', async () => {
        const { getByTestId, queryByTestId } = render(<Shell />);
        await typeIntoPalette('login');
        const row = await waitFor(() => getByTestId('command-palette-result-workItem'));
        expect(row.getAttribute('data-href')).toBe('/t/acme/work-items/ISL-12');
        fireEvent.click(row);
        expect(navigationMock.push).toHaveBeenCalledWith('/t/acme/work-items/ISL-12');
        await waitFor(() => expect(queryByTestId('command-palette-input')).toBeNull());
    });

    it('says the search failed rather than "no results" when the route does not answer', async () => {
        installFetchStub([], false);
        render(<Shell />);
        await typeIntoPalette('login');
        await waitFor(() => expect(document.querySelector('[cmdk-empty]')?.textContent).toBe('Search failed. Try again in a moment.'));
    });

    it('says where a description or comment hit matched, with its snippet as text (2.7f)', async () => {
        installFetchStub([
            { ...SAMPLE_HITS[0]!, matchedIn: 'title' },
            {
                ...SAMPLE_HITS[0]!,
                id: 'wi-2',
                title: 'Invoices',
                subtitle: 'ISL-13',
                href: '/t/acme/work-items/ISL-13',
                score: 0.6,
                matchedIn: 'comment',
                snippet: '…the <b>login</b> fails after the redirect…',
            },
            { ...SAMPLE_HITS[0]!, id: 'wi-3', title: 'Billing', subtitle: 'ISL-14', href: '/t/acme/work-items/ISL-14', score: 0.55, matchedIn: 'description', snippet: null },
        ]);
        render(<Shell />);
        await typeIntoPalette('login');
        const rows = await waitFor(() => {
            const found = document.querySelectorAll('[data-testid="command-palette-result-workItem"]');
            expect(found).toHaveLength(3);
            return Array.from(found);
        });
        expect(rows[0]!.querySelector('[data-testid="command-palette-result-match"]')).toBeNull();
        expect(rows[1]!.querySelector('[data-testid="command-palette-result-match"]')!.textContent).toBe(
            'In a comment: …the <b>login</b> fails after the redirect…',
        );
        // Rendered as text, never as markup.
        expect(rows[1]!.querySelector('b')).toBeNull();
        expect(rows[2]!.querySelector('[data-testid="command-palette-result-match"]')!.textContent).toBe('In the description');
    });

    it('debounces repeated keystrokes into one request', async () => {
        render(<Shell />);
        const input = document.querySelector('[data-testid="command-palette-input"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'lo' } });
        fireEvent.change(input, { target: { value: 'log' } });
        fireEvent.change(input, { target: { value: 'logi' } });
        await act(async () => {
            await new Promise((r) => setTimeout(r, 250));
        });
        expect(calls).toEqual(['/api/t/acme/search?q=logi']);
    });
});
