import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async () => {
    const session = await auth();
    if (!session?.user) {
        return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }

    // The tenant reported is one this SESSION may reach: an ACTIVE membership
    // of a workspace that is not soft-deleted — the rules the membership
    // claims and the DB-backed workspace gates apply. (Sub-phase 8.3 adds
    // the SSO scope and the Entra gate to both.)

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
            id: true,
            email: true,
            name: true,
            tenantMemberships: {
                where: {
                    status: 'ACTIVE',
                    tenant: { deletedAt: null },
                },
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: {
                    role: true,
                    tenant: { select: { id: true, name: true, slug: true } },
                },
            },
        },
    });

    const membership = user?.tenantMemberships[0];

    return jsonResponse({
        user: {
            id: user?.id,
            email: user?.email,
            name: user?.name,
            role: membership?.role ?? 'VIEWER',
        },
        tenant: membership?.tenant ?? null,
    });
});
