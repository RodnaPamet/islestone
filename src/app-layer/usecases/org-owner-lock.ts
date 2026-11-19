/**
 * The per-organization lock every change to an organization's owners queues
 * on (inflect-compliance #5373).
 *
 * Two owners demoting or removing each other at once used to each count the
 * other as still an owner under READ COMMITTED, write different rows, and both
 * commit — leaving the organization with no owner. Both layers of the
 * last-owner guard take this lock before they count: the
 * `org_membership_last_owner_guard` trigger (`check_not_last_org_owner`, in
 * migration 20261119120000_tenancy_core) and, from sub-phase 1.4, the org
 * member usecases that run their own count.
 *
 * Take it FIRST in the transaction, before reading the membership or counting
 * owners and before writing any row: a read that runs after it returns sees the
 * committed result of whichever change held it before, and taking it before any
 * row lock keeps the lock order the same as the trigger's (advisory lock, then
 * row), so the two never deadlock. The trigger's re-entry in the same
 * transaction is free — advisory locks stack. `org-owner:` is distinct from the
 * org audit chain's `org:` key.
 */
import type { Prisma } from '@prisma/client';

export function orgOwnerLockKey(organizationId: string): string {
    return `org-owner:${organizationId}`;
}

export async function lockOrgOwners(
    db: Pick<Prisma.TransactionClient, '$executeRawUnsafe'>,
    organizationId: string,
): Promise<void> {
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, orgOwnerLockKey(organizationId));
}
