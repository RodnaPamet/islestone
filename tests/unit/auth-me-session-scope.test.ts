/**
 * GET /api/auth/me reports a tenant the SESSION may reach (#5303).
 *
 * It used to report the account's oldest ACTIVE membership whatever the
 * session was: a session opened by tenant B's single sign-on was shown tenant
 * A, as was one the Entra group gate had refused A, and a soft-deleted tenant
 * was still reported. The membership read now carries the filters the
 * membership claims and the DB-backed workspace gates apply.
 *
 * Copied from inflect-compliance (5528464fc54a8681956f3b9ce23ca9c075f0420e);
 * its SSO-scope and Entra-gate cases return with 8.3.
 */
const authMock = jest.fn();
const findUnique = jest.fn();

jest.mock('@/auth', () => ({ auth: () => authMock() }));
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: { user: { findUnique: (a: unknown) => findUnique(a) } },
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/auth/me/route';

type MembershipWhere = {
    status?: string;
    tenant?: { deletedAt?: null };
    tenantId?: string;
    NOT?: { tenantId?: { in?: string[] } };
};

function membershipWhere(): MembershipWhere {
    expect(findUnique).toHaveBeenCalledTimes(1);
    const args = findUnique.mock.calls[0][0] as {
        select: { tenantMemberships: { where: MembershipWhere } };
    };
    return args.select.tenantMemberships.where;
}

function call() {
    return (GET as unknown as (req: NextRequest, args: unknown) => Promise<Response>)(
        new NextRequest('http://localhost/api/auth/me'),
        { params: Promise.resolve({}) },
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@example.com',
        name: 'A',
        tenantMemberships: [{ role: 'MEMBER', tenant: { id: 't-b', name: 'B', slug: 'b' } }],
    });
});

describe('GET /api/auth/me — the tenant is one this session may reach', () => {
    it('never reports a soft-deleted tenant', async () => {
        authMock.mockResolvedValue({ user: { id: 'u1' } });
        const res = await call();
        expect(res.status).toBe(200);
        const where = membershipWhere();
        expect(where.status).toBe('ACTIVE');
        expect(where.tenant).toEqual({ deletedAt: null });
    });

    it('an ordinary session is not narrowed to one tenant', async () => {
        authMock.mockResolvedValue({ user: { id: 'u1' } });
        await call();
        const where = membershipWhere();
        expect(where.tenantId).toBeUndefined();
        expect(where.NOT).toBeUndefined();
    });

    it('no reachable membership reports no tenant', async () => {
        authMock.mockResolvedValue({ user: { id: 'u1' } });
        findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.com', name: 'A', tenantMemberships: [] });
        const body = await (await call()).json();
        expect(body.tenant).toBeNull();
    });
});
