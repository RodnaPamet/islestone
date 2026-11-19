/**
 * `resolveInitiatorContext` — the context a job builds for the member who
 * started it — resolves a membership exactly as a REQUEST does.
 *
 * For the same membership row it gives the role, coarse flags and granular set
 * `resolveTenantContext` gives:
 *
 *   - for a CUSTOM role, including a soft-deleted one the membership is still
 *     linked to, which a request applies;
 *   - for every BUILT-IN role, coarse flags included.
 *
 * Copied from inflect-compliance `tests/unit/initiator-context.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e and rewritten over Islestone's five
 * roles and `grantsJson`. Not ported: the block comparing the context with the
 * evidence-job and workflow-run projections inflect built before #4362 (no
 * Islestone job ever built them) and the `buildDelegatedJobContext` block (not
 * ported; the tenant system user replaces it). The request side runs through
 * `runWithoutRls`, mocked to hand the same mock client to both resolvers.
 */
const prismaMock = {
    tenant: { findUnique: jest.fn() },
    tenantMembership: { findUnique: jest.fn(), findFirst: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    get default() {
        return prismaMock;
    },
    get prisma() {
        return prismaMock;
    },
}));
jest.mock('@/lib/db/rls-middleware', () => ({
    runWithoutRls: (_opts: unknown, fn: (db: unknown) => unknown) => fn(prismaMock),
}));

import type { Role } from '@prisma/client';
import { resolveInitiatorContext } from '@/app-layer/context-system';
import { resolveTenantContext, computePermissions } from '@/lib/tenant-context';
import { getPermissionsForRole } from '@/lib/permissions';

const BUILT_IN: Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];

const MEMBER = getPermissionsForRole('MEMBER');
const VIEWER = getPermissionsForRole('VIEWER');

/** A full membership row, as the database holds it. */
function row(role: Role, customRole: Record<string, unknown> | null) {
    return {
        id: 'm-1',
        tenantId: 'tenant-A',
        userId: 'user-1',
        role,
        status: 'ACTIVE',
        customRoleId: customRole ? 'cr-1' : null,
        customRole,
    };
}

function customRole(baseRole: Role, grantsJson: unknown, isActive = true) {
    return { id: 'cr-1', tenantId: 'tenant-A', name: 'Custom', baseRole, grantsJson, isActive };
}

/** What a request from this membership resolves to. */
async function requestAuthority(membership: ReturnType<typeof row>) {
    prismaMock.tenant.findUnique.mockResolvedValue({ id: 'tenant-A', slug: 'acme', deletedAt: null });
    prismaMock.tenantMembership.findUnique.mockResolvedValue(membership);
    const t = await resolveTenantContext({ tenantId: 'tenant-A' }, 'user-1');
    return { role: t.role, permissions: t.permissions, appPermissions: t.appPermissions };
}

/** What the job's context resolves to, for the same row. */
async function jobAuthority(membership: ReturnType<typeof row>) {
    prismaMock.tenantMembership.findFirst.mockResolvedValue(membership);
    const ctx = await resolveInitiatorContext({ tenantId: 'tenant-A', userId: 'user-1', requestId: 'req-1' });
    if (!ctx) throw new Error('expected a context');
    return { role: ctx.role, permissions: ctx.permissions, appPermissions: ctx.appPermissions };
}

beforeEach(() => jest.clearAllMocks());

describe('a custom role resolves as a request resolves it', () => {
    const cases: Array<[string, ReturnType<typeof row>]> = [
        [
            'MEMBER base withholding work_items.create',
            row('MEMBER', customRole('MEMBER', { work_items: { ...MEMBER.work_items, create: false } })),
        ],
        [
            'MEMBER base withholding projects.edit',
            row('MEMBER', customRole('MEMBER', { projects: { ...MEMBER.projects, edit: false } })),
        ],
        [
            'VIEWER base granting work_items.comment',
            row('VIEWER', customRole('VIEWER', { work_items: { ...VIEWER.work_items, comment: true } })),
        ],
        ['an ADMIN membership carrying a VIEWER-based role', row('ADMIN', customRole('VIEWER', {}))],
        [
            'a malformed grantsJson, which falls back to the base role',
            row('MEMBER', customRole('VIEWER', 'not-an-object')),
        ],
    ];

    it.each(cases)('%s', async (_label, membership) => {
        const job = await jobAuthority(membership);
        expect(job).toEqual(await requestAuthority(membership));
        // Not the built-in role's set: the custom role is what is read.
        expect(job.appPermissions).not.toEqual(getPermissionsForRole(membership.role));
    });

    it('a soft-deleted custom role still linked to the membership: applied, as a request applies it', async () => {
        // A request reads the link and never `isActive`; the job reads exactly the same.
        const membership = row(
            'MEMBER',
            customRole('MEMBER', { work_items: { ...MEMBER.work_items, create: false } }, false),
        );
        const job = await jobAuthority(membership);
        expect(job).toEqual(await requestAuthority(membership));
        expect(job.appPermissions.work_items.create).toBe(false);
    });
});

describe('a built-in role resolves as a request resolves it, coarse flags included', () => {
    it.each(BUILT_IN)('%s', async (role) => {
        const membership = row(role, null);
        const job = await jobAuthority(membership);
        expect(job).toEqual(await requestAuthority(membership));
        expect(job).toEqual({
            role,
            permissions: computePermissions(role),
            appPermissions: getPermissionsForRole(role),
        });
    });
});

describe('the refusal and the request id', () => {
    it('returns null — a refusal — for a member with no ACTIVE membership in a live tenant', async () => {
        prismaMock.tenantMembership.findFirst.mockResolvedValue(null);
        await expect(
            resolveInitiatorContext({ tenantId: 'tenant-A', userId: 'user-1', requestId: 'req-1' }),
        ).resolves.toBeNull();
        expect(prismaMock.tenantMembership.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { userId: 'user-1', tenantId: 'tenant-A', status: 'ACTIVE', tenant: { deletedAt: null } },
            }),
        );
    });

    it('carries the caller’s request id, user and tenant', async () => {
        prismaMock.tenantMembership.findFirst.mockResolvedValue(row('MEMBER', null));
        const ctx = await resolveInitiatorContext({ tenantId: 'tenant-A', userId: 'user-1', requestId: 'req-9' });
        expect(ctx).toMatchObject({ requestId: 'req-9', userId: 'user-1', tenantId: 'tenant-A' });
    });
});
