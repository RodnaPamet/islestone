/** @jest-environment jsdom */

/**
 * Owner decision 204: until roadmap 8.4 a GUEST holds no key. `/t/<slug>`
 * lands on My Work, so a guest gets one empty state there saying it has no
 * access yet: not a crash, not a 404 on the first page it sees, and nothing
 * of the workspace read (the view configuration, which carries the teams,
 * types, labels and cycles, is never asked for). Every workspace-wide role
 * still gets My Work's sections. The Views page, whose list is read in the
 * browser, asks `views.view` on the server and is a 404 for a guest. Queries
 * by role and text; jest-axe.
 */
import { render, screen } from '@testing-library/react';
import type { Role } from '@prisma/client';
import { axe } from 'jest-axe';
import type { ReactElement } from 'react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/my-work',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
    notFound: () => {
        throw new Error('NEXT_NOT_FOUND');
    },
}));

jest.mock('next-intl/server', () => {
    const catalog = jest.requireActual('../../messages/en.json');
    return {
        getTranslations: async (ns: string) => (key: string) =>
            `${ns}.${key}`.split('.').reduce((o: Record<string, unknown>, k) => o?.[k] as Record<string, unknown>, catalog) ?? key,
    };
});

const mockTenantCtx = jest.fn();
jest.mock('@/app-layer/context', () => ({ getTenantCtx: (...args: unknown[]) => mockTenantCtx(...args) }));
const mockViewConfig = jest.fn();
jest.mock('@/app-layer/usecases/work-item-views', () => ({ getWorkItemViewConfig: (...args: unknown[]) => mockViewConfig(...args) }));
// My Work's own view is not under test here; a stand-in marks that the page chose it.
jest.mock('@/components/work-items/MyWorkView', () => ({ MyWorkView: () => <p>My Work sections</p> }));
jest.mock('@/components/views/ViewsList', () => ({ ViewsList: () => <p>Saved views list</p> }));

import MyWorkPage from '@/app/t/[tenantSlug]/(app)/my-work/page';
import ViewsPage from '@/app/t/[tenantSlug]/(app)/views/page';
import en from '../../messages/en.json';

import { makeRequestContext } from '../helpers/make-context';
import { CONFIG } from '../helpers/work-items-harness';

const params = Promise.resolve({ tenantSlug: 'acme' });

beforeEach(() => {
    mockTenantCtx.mockReset();
    mockViewConfig.mockReset();
    mockViewConfig.mockResolvedValue(CONFIG);
});

describe('My Work for a GUEST before 8.4 (decision 204)', () => {
    it('says the guest has no access yet, and reads nothing of the workspace', async () => {
        mockTenantCtx.mockResolvedValue(makeRequestContext('GUEST'));
        const { container } = render((await MyWorkPage({ params })) as ReactElement);
        expect(screen.getByText(en.noAccess.title)).toBeInTheDocument();
        expect(screen.getByText(en.noAccess.body)).toBeInTheDocument();
        expect(screen.queryByText('My Work sections')).toBeNull();
        expect(mockViewConfig).not.toHaveBeenCalled();
        expect(await axe(container)).toHaveNoViolations();
    });

    it.each(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as Role[])('a %s gets My Work itself', async (role) => {
        mockTenantCtx.mockResolvedValue(makeRequestContext(role));
        render((await MyWorkPage({ params })) as ReactElement);
        expect(screen.getByText('My Work sections')).toBeInTheDocument();
        expect(screen.queryByText(en.noAccess.title)).toBeNull();
        expect(mockViewConfig).toHaveBeenCalledTimes(1);
    });

    it('a workspace the person is not in is still the 404', async () => {
        const { forbidden } = jest.requireActual('@/lib/errors/types');
        mockTenantCtx.mockRejectedValue(forbidden('Not a member of this tenant'));
        await expect(MyWorkPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    });
});

describe('the Views page asks views.view on the server (decision 204)', () => {
    it('a GUEST gets the 404, not a list that fails to load', async () => {
        mockTenantCtx.mockResolvedValue(makeRequestContext('GUEST'));
        await expect(ViewsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it.each(['OWNER', 'MEMBER', 'VIEWER'] as Role[])('a %s gets the list', async (role) => {
        mockTenantCtx.mockResolvedValue(makeRequestContext(role));
        render((await ViewsPage({ params })) as ReactElement);
        expect(screen.getByText('Saved views list')).toBeInTheDocument();
    });
});
