/**
 * The H2 permission matrix's edge half (`docs/porting/maps/H2.md`, part 3,
 * "The edge half"; owner decision 175). Every `/admin` row of the
 * hand-written table (`tests/integration/permission-matrix/table.ts`) is run
 * through the real `middleware()` once per matrix role, with the session
 * token that role's membership mints:
 *
 *   - the edge admits the OWNER and ADMIN memberships to an admin API path
 *     and refuses every other with its own 403 ("Admin access required"):
 *     the custom roles sit on MEMBER and VIEWER memberships, and a custom
 *     role never enters the edge's check (CLAUDE.md, "Auth and permissions");
 *   - wherever the edge refuses a role, the table's handler cell for that
 *     role refuses too: two gates, both asserted (the handler's half is the
 *     integration suite, `admin-security.test.ts`).
 *
 * No database: the edge reads the JWT claim only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the middleware's second argument is Next's event, unused here. */
import { NextRequest } from 'next/server';

jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));

import middleware from '@/middleware';
import { getToken } from 'next-auth/jwt';

import { ALL_ROWS, MATRIX_ROLES, outcomeOf, type MatrixRole } from '../integration/permission-matrix/table';

const mockGetToken = getToken as jest.Mock;

/** The membership role each matrix role's session carries (hand-written: the custom roles sit on MEMBER and VIEWER). */
const MEMBERSHIP: Record<MatrixRole, string> = {
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    MEMBER: 'MEMBER',
    VIEWER: 'VIEWER',
    GUEST: 'GUEST',
    MEMBER_NO_EDIT: 'MEMBER',
    VIEWER_PLUS_COMMENT: 'VIEWER',
};
/** Who the edge admits to `/api/t/<slug>/admin/**`: the OWNER and ADMIN memberships (hand-written). */
const EDGE_ADMITS: ReadonlySet<MatrixRole> = new Set(['OWNER', 'ADMIN']);

function token(role: MatrixRole) {
    return {
        sub: 'user-1',
        userId: 'user-1',
        role: MEMBERSHIP[role],
        mfaPending: false,
        tenantId: 'tenant-alpha',
        tenantSlug: 'alpha',
        memberships: [{ slug: 'alpha', role: MEMBERSHIP[role], tenantId: 'tenant-alpha' }],
        membershipsTruncated: false,
        orgMemberships: [],
    };
}

const adminRows = ALL_ROWS.filter((r) => r.route.startsWith('admin/'));
const cases = adminRows.flatMap((row) => MATRIX_ROLES.map((role) => [`${row.method} ${row.route} | ${row.subject} | ${role}`, row, role] as const));

beforeEach(() => jest.clearAllMocks());

describe('the edge admin gate, per matrix role, on every /admin row of the table', () => {
    it('covers the admin rows', () => {
        expect(adminRows.length).toBeGreaterThan(15);
    });

    it.each(cases)('%s', async (_n, row, role) => {
        mockGetToken.mockResolvedValue(token(role));
        const path = `/api/t/alpha/${row.route.replace(/\/?route\.ts$/, '').replace(/\[(\w+)\]/g, 'x-$1')}`;
        const res = await middleware(new NextRequest(`http://localhost:3000${path}`, { method: row.method, headers: { 'sec-fetch-site': 'same-origin' } }), {} as any);
        if (EDGE_ADMITS.has(role)) {
            expect({ role, status: res.status }).toEqual({ role, status: 200 });
        } else {
            expect({ role, status: res.status }).toEqual({ role, status: 403 });
            await expect(res.json()).resolves.toEqual({ error: 'Admin access required' });
            // Both gates refuse: the handler's cell for a role the edge refuses is never a success.
            expect({ role, handler: outcomeOf(row.expect[role]) }).toEqual({ role, handler: expect.not.stringMatching(/^(ok|empty)$/) });
        }
    });
});
