/**
 * The root page (`src/app/page.tsx`) sends a signed-in person to the
 * workspace picker and anybody else to sign-in. It replaced the 1.1
 * placeholder home in sub-phase 1.7.
 */
const redirect = jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
});
jest.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

const getSession = jest.fn();
jest.mock('@/lib/auth/session', () => ({ getSession: () => getSession() }));

import Home from '@/app/page';

describe('root page', () => {
    beforeEach(() => {
        redirect.mockClear();
        getSession.mockReset();
    });

    it('sends a person with no session to /login', async () => {
        getSession.mockResolvedValue(null);
        await expect(Home()).rejects.toThrow('NEXT_REDIRECT /login');
        expect(redirect).toHaveBeenCalledTimes(1);
    });

    it('sends a signed-in person to the workspace picker', async () => {
        getSession.mockResolvedValue({ userId: 'u1', tenantId: 't1', email: 'a@b.c', role: 'MEMBER' });
        await expect(Home()).rejects.toThrow('NEXT_REDIRECT /tenants');
        expect(redirect).not.toHaveBeenCalledWith('/login');
    });
});
