/**
 * Integration coverage for the server-side org context resolver
 * (`src/lib/server/org-context.server.ts`).
 *
 * Exercises every branch of `getOrgServerContext`:
 *   - empty/whitespace slug → NotFoundError (no DB hit),
 *   - unknown org slug → NotFoundError (`org_not_found` log reason),
 *   - existing org but no membership → NotFoundError (`not_a_member`),
 *   - ORG_ADMIN member → admin OrgPermissionSet,
 *   - ORG_READER member → view-only OrgPermissionSet.
 *
 * The anti-enumeration policy means all failure surfaces throw the same
 * generic message — we assert on that invariant too.
 *
 * Hits a real DB (project convention).
 */
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { OrgRole } from '@prisma/client';

import { getOrgServerContext } from '@/lib/server/org-context.server';

import { prismaTestClient, resetDatabase } from '../helpers/db';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUITE_TAG = `org-ctx-${randomUUID().slice(0, 8)}`;
const ORG_SLUG = SUITE_TAG;

describeFn('getOrgServerContext — org context resolution (integration)', () => {
    let prisma: PrismaClient;
    let orgId: string;
    let adminUserId: string;
    let readerUserId: string;
    let strangerUserId: string;

    async function makeUser(label: string): Promise<string> {
        const u = await prisma.user.create({ data: { email: `${SUITE_TAG}-${label}@example.test` } });
        return u.id;
    }

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);

        const org = await prisma.organization.create({
            data: { name: `org ${SUITE_TAG}`, slug: ORG_SLUG },
        });
        orgId = org.id;

        adminUserId = await makeUser('admin');
        readerUserId = await makeUser('reader');
        strangerUserId = await makeUser('stranger');

        await prisma.orgMembership.create({
            data: { organizationId: orgId, userId: adminUserId, role: OrgRole.ORG_ADMIN },
        });
        await prisma.orgMembership.create({
            data: { organizationId: orgId, userId: readerUserId, role: OrgRole.ORG_READER },
        });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const GENERIC = /not found or access not permitted/i;

    it('rejects an empty / whitespace slug before any DB lookup', async () => {
        await expect(getOrgServerContext({ orgSlug: '', userId: adminUserId })).rejects.toThrow(GENERIC);
        await expect(getOrgServerContext({ orgSlug: '   ', userId: adminUserId })).rejects.toThrow(GENERIC);
    });

    it('rejects an unknown org slug with the generic message (org_not_found)', async () => {
        await expect(getOrgServerContext({ orgSlug: `no-such-${SUITE_TAG}`, userId: adminUserId })).rejects.toThrow(
            GENERIC,
        );
    });

    it('rejects a non-member of an existing org with the same generic message (not_a_member)', async () => {
        await expect(getOrgServerContext({ orgSlug: ORG_SLUG, userId: strangerUserId })).rejects.toThrow(GENERIC);
    });

    it('returns full context + ORG_ADMIN permissions for an admin member', async () => {
        const ctx = await getOrgServerContext({ orgSlug: ORG_SLUG, userId: adminUserId });
        expect(ctx.organization).toEqual({ id: orgId, slug: ORG_SLUG, name: `org ${SUITE_TAG}` });
        expect(ctx.role).toBe('ORG_ADMIN');
        expect(ctx.permissions).toEqual({
            canViewWorkspaces: true,
            // Workspace and owner management are the owner's.
            canManageTenants: false,
            canManageMembers: true,
            canManageOwners: false,
        });
    });

    it('returns view-only ORG_READER permissions for a reader member', async () => {
        const ctx = await getOrgServerContext({ orgSlug: ORG_SLUG, userId: readerUserId });
        expect(ctx.role).toBe('ORG_READER');
        expect(ctx.permissions).toEqual({
            canViewWorkspaces: true,
            canManageTenants: false,
            canManageMembers: false,
            canManageOwners: false,
        });
    });

    it('tolerates surrounding whitespace in a valid slug (trim branch)', async () => {
        const ctx = await getOrgServerContext({ orgSlug: `  ${ORG_SLUG}  `, userId: adminUserId });
        expect(ctx.organization.slug).toBe(ORG_SLUG);
        expect(ctx.role).toBe('ORG_ADMIN');
    });
});
