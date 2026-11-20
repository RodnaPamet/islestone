/** @jest-environment jsdom */

/**
 * Every destination the shell links to exists (sub-phase 1.7), so no nav
 * link 404s. None is a placeholder any more: My Work and Projects became
 * real pages in 2.3 (tests/rendered/work-item-pages.test.tsx), Settings with
 * decision 55 (tests/rendered/settings-pages.test.tsx), Views with 2.4
 * (tests/rendered/saved-views.test.tsx) and the Inbox with 2.7c
 * (tests/rendered/inbox.test.tsx), which this file checks renders as the
 * Inbox rather than the old placeholder. The workspace root goes to My Work.
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

const params = Promise.resolve({ tenantSlug: 'acme' });

jest.mock('@/components/inbox/InboxView', () => ({
    InboxView: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

describe('the shell destinations', () => {
    it('the Inbox is the Inbox, not a placeholder (2.7c)', async () => {
        render(await InboxPage());
        expect(screen.getByRole('heading', { level: 1, name: en.nav.inbox })).toBeInTheDocument();
        expect(screen.queryByText(en.placeholders.title)).not.toBeInTheDocument();
    });

    it('the workspace root goes to My Work', async () => {
        await expect(WorkspaceRootPage({ params })).rejects.toThrow('NEXT_REDIRECT /t/acme/my-work');
    });
});

