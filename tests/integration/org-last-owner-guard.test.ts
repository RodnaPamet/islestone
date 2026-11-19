/**
 * Integration tests for the `org_membership_last_owner_guard` DB trigger: the
 * organization twin of last-owner-guard.test.ts.
 *
 * The last ORG_OWNER of an organization cannot be deleted or demoted
 * (`LAST_ORG_OWNER_GUARD`, SQLSTATE P0001), whatever the writer; one of two
 * owners can go; and deleting the ORGANIZATION cascades past the guard (the
 * function's `NOT EXISTS "Organization"` exemption). org-owner-race.test.ts
 * covers the lock.
 *
 * Extracted from inflect-compliance's `org-owner-writers.test.ts`
 * (`describe('the last-owner trigger')`); its backfill, role-change and
 * tenant-management describes are not ported (the backfill is not replayed;
 * the usecases arrive in 1.4 and 8.3).
 */
import { randomUUID } from 'node:crypto';

import type { OrgRole, PrismaClient } from '@prisma/client';

import { prismaTestClient, resetDatabase } from '../helpers/db';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUITE = randomUUID().slice(0, 8);

describeFn('the org last-owner trigger', () => {
    let prisma: PrismaClient;

    async function user(label: string): Promise<string> {
        const u = await prisma.user.create({ data: { email: `${label}-${SUITE}@example.com`, name: label } });
        return u.id;
    }
    async function org(label: string): Promise<string> {
        const o = await prisma.organization.create({ data: { name: label, slug: `${label}-${SUITE}` } });
        return o.id;
    }
    const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n));
    async function member(organizationId: string, userId: string, role: OrgRole, minute = 0) {
        await prisma.orgMembership.create({ data: { organizationId, userId, role, createdAt: at(minute) } });
    }
    const roleIn = async (organizationId: string, userId: string) =>
        (
            await prisma.orgMembership.findUnique({
                where: { organizationId_userId: { organizationId, userId } },
                select: { role: true },
            })
        )?.role ?? null;

    let o = '';
    let first = '';
    let second = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        o = await org('trg');
        first = await user('trg-first');
        second = await user('trg-second');
        await member(o, first, 'ORG_OWNER');
    });

    // TRUNCATE fires no row-level triggers, so the reset is not refused.
    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('refuses deleting or demoting the last owner, whatever the writer', async () => {
        await expect(
            prisma.orgMembership.delete({ where: { organizationId_userId: { organizationId: o, userId: first } } }),
        ).rejects.toThrow(/LAST_ORG_OWNER_GUARD/);
        await expect(
            prisma.orgMembership.update({
                where: { organizationId_userId: { organizationId: o, userId: first } },
                data: { role: 'ORG_ADMIN' },
            }),
        ).rejects.toThrow(/LAST_ORG_OWNER_GUARD/);
        expect(await roleIn(o, first)).toBe('ORG_OWNER');
    });

    it('lets one of two owners go', async () => {
        await member(o, second, 'ORG_OWNER');
        await prisma.orgMembership.update({
            where: { organizationId_userId: { organizationId: o, userId: first } },
            data: { role: 'ORG_ADMIN' },
        });
        expect(await roleIn(o, first)).toBe('ORG_ADMIN');
    });

    it('lets the organization itself be deleted, its owner with it', async () => {
        const doomed = await org('trg-doomed');
        const sole = await user('trg-sole');
        await member(doomed, sole, 'ORG_OWNER');
        await prisma.organization.delete({ where: { id: doomed } });
        expect(await prisma.orgMembership.count({ where: { organizationId: doomed } })).toBe(0);
    });
});
