/**
 * A workspace with an OWNER, for integration tests.
 *
 * inflect-compliance's integration suites set up a tenant with
 * `createTenantWithOwner` from `src/app-layer/usecases/tenant-lifecycle.ts`,
 * the platform-admin bootstrap. Islestone has no platform-admin surface yet,
 * so that usecase is not ported (docs/porting/maps/1.4.md); the suites copied
 * in sub-phase 1.4 call this fixture instead. It keeps the usecase's name,
 * input and result shape so their call sites stay unchanged, and does what
 * the usecase's transaction did that Islestone has tables for: find or create
 * the owner's User by email, then create the Tenant and the ACTIVE OWNER
 * membership in one transaction. No DEK (sub-phase 1.5), no onboarding row
 * and no audit entries.
 *
 * Written fresh from the shape of the parent usecase; no code copied.
 */
import { lookupEmail } from '@/lib/auth/email-lookup';

import { prismaTestClient } from './db';

export interface CreateTenantWithOwnerInput {
    name: string;
    slug: string;
    ownerEmail: string;
    /** Kept for call-site compatibility; nothing is audited here. */
    requestId: string;
}

export interface CreateTenantWithOwnerResult {
    tenant: { id: string; slug: string; name: string };
    ownerUserId: string;
}

export async function createTenantWithOwner(input: CreateTenantWithOwnerInput): Promise<CreateTenantWithOwnerResult> {
    const prisma = prismaTestClient();
    const email = lookupEmail(input.ownerEmail);
    const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email },
        select: { id: true },
    });
    const tenant = await prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({
            data: { name: input.name, slug: input.slug },
            select: { id: true, slug: true, name: true },
        });
        await tx.tenantMembership.create({
            data: { tenantId: created.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
        });
        return created;
    });
    return { tenant, ownerUserId: user.id };
}
