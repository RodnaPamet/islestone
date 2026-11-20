/** @jest-environment jsdom */

/**
 * Every destination the shell links to exists (sub-phase 1.7), so no nav
 * link 404s: Inbox and Views are placeholders saying the feature arrives
 * later, in the catalogue's words (My Work and Projects became real pages in
 * 2.3, covered by tests/rendered/work-item-pages.test.tsx; Settings became
 * real with decision 55, covered by tests/rendered/settings-pages.test.tsx);
 * the workspace root goes to My Work.
 */
import { render, screen } from '@testing-library/react';

import en from '../../messages/en.json';

jest.mock('next/navigation', () => ({
    usePathname: () => '/t/acme/my-work',
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    useParams: () => ({ tenantSlug: 'acme' }),
    redirect: (url: string) => {
        throw new Error(`NEXT_REDIRECT ${url}`);
    },
    notFound: () => {
        throw new Error('NEXT_NOT_FOUND');
    },
}));

// Server-side translations against the real catalogue.
jest.mock('next-intl/server', () => {
    const catalog = jest.requireActual('../../messages/en.json');
    return {
        getTranslations: async (ns: string) => (key: string) =>
            `${ns}.${key}`.split('.').reduce((o: Record<string, unknown>, k) => o?.[k] as Record<string, unknown>, catalog) ??
            key,
    };
});

import InboxPage from '@/app/t/[tenantSlug]/(app)/inbox/page';
import WorkspaceRootPage from '@/app/t/[tenantSlug]/(app)/page';
import ViewsPage from '@/app/t/[tenantSlug]/(app)/views/page';

const params = Promise.resolve({ tenantSlug: 'acme' });

describe('the placeholder destinations', () => {
    it.each([
        ['Inbox', InboxPage, en.placeholders.inbox],
        ['Views', ViewsPage, en.placeholders.views],
    ] as const)('%s renders its title and says the feature arrives later', async (title, Page, body) => {
        render(await Page());
        expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
        expect(screen.getByText(en.placeholders.title)).toBeInTheDocument();
        expect(screen.getByText(body)).toBeInTheDocument();
    });

    it('the workspace root goes to My Work', async () => {
        await expect(WorkspaceRootPage({ params })).rejects.toThrow('NEXT_REDIRECT /t/acme/my-work');
    });
});

