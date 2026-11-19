/**
 * Unit tests for the coarse RBAC helpers in `src/lib/auth/session.ts`.
 *
 * Copied from inflect-compliance `tests/unit/rbac.test.ts`
 * (5528464fc54a8681956f3b9ce23ca9c075f0420e) and rewritten for Islestone's
 * roles (ADR 0006: OWNER > ADMIN > MEMBER > VIEWER > GUEST). The parent's
 * `jsonwebtoken` mock is gone with the dependency, and `canAudit` with the
 * audit tier (sub-phase 1.3).
 */
jest.mock('@/auth', () => ({ auth: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: { user: { findUnique: jest.fn() }, tenantMembership: { findUnique: jest.fn() } },
}));

import type { Role } from '@prisma/client';

import type { JwtPayload } from '@/lib/auth/session';
import { canAdmin, canEdit, canExport, canRead, canWrite, hasMinRole, requireRole } from '@/lib/auth/session';
import { computePermissions } from '@/lib/tenant-context';

const LADDER: Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];

describe('hasMinRole', () => {
    it('ranks the five roles by seniority, each at least every role below it', () => {
        LADDER.forEach((role, i) => {
            LADDER.forEach((min, j) => {
                expect(hasMinRole(role, min)).toBe(i <= j);
            });
        });
    });
});

describe('the coarse helpers', () => {
    it.each([
        // role,    read,  write, admin, export
        ['OWNER', true, true, true, true],
        ['ADMIN', true, true, true, true],
        ['MEMBER', true, true, false, false],
        ['VIEWER', true, false, false, false],
        ['GUEST', true, false, false, false],
    ] as const)('%s: read %s, write %s, admin %s, export %s', (role, read, write, admin, exp) => {
        expect(canRead(role)).toBe(read);
        expect(canWrite(role)).toBe(write);
        expect(canAdmin(role)).toBe(admin);
        expect(canExport(role)).toBe(exp);
        expect(canEdit(role)).toBe(write);
    });

    it('agree with the coarse tier the request context carries (computePermissions)', () => {
        for (const role of LADDER) {
            expect(computePermissions(role)).toEqual({
                canRead: canRead(role),
                canWrite: canWrite(role),
                canAdmin: canAdmin(role),
                canExport: canExport(role),
            });
        }
    });
});

describe('requireRole', () => {
    const makeSession = (role: Role): JwtPayload => ({ userId: 'u1', tenantId: 't1', email: 'test@test.com', role });

    it('does not throw when the role is sufficient', () => {
        expect(() => requireRole(makeSession('ADMIN'), 'ADMIN')).not.toThrow();
        expect(() => requireRole(makeSession('ADMIN'), 'MEMBER')).not.toThrow();
        expect(() => requireRole(makeSession('MEMBER'), 'VIEWER')).not.toThrow();
        expect(() => requireRole(makeSession('VIEWER'), 'GUEST')).not.toThrow();
    });

    it('throws forbidden when the role is insufficient', () => {
        expect(() => requireRole(makeSession('VIEWER'), 'MEMBER')).toThrow();
        expect(() => requireRole(makeSession('GUEST'), 'VIEWER')).toThrow();
        expect(() => requireRole(makeSession('MEMBER'), 'ADMIN')).toThrow();
    });
});
