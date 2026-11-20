/**
 * Resolving recipient lists to people at send time (sub-phase 2.7e;
 * docs/porting/maps/2.7.md, part 6, "One resolver, re-checked at send time";
 * owner decisions 79, 139 and 142).
 *
 * `resolveListRecipients` is the one reader every feature that names a list
 * calls: adding a list to an item's watchers (2.7e), a project's intake bell
 * (2.7e), and later reviews (2.8), checklists (4.5), notify actions (5.1),
 * reports (7.4) and minutes (7.6). A list's stored membership is never "may
 * receive": each call re-checks, for every person, that
 *
 *   - the workspace is live (a soft-deleted workspace's memberships survive
 *     it; `tests/guards/cross-tenant-recipient-liveness.test.ts`);
 *   - the list is not archived, and is the workspace's or the named
 *     project's (another project's list names nobody here);
 *   - the person is an ACTIVE member whose permissions hold what the caller
 *     needs (`may`: `intake.view` for intake, `work_items.view` for watchers);
 *   - their role sees the named project (`resolveProjectVisibility`: a GUEST
 *     sees none until 8.4).
 *
 * Each person is counted once across the lists and `alsoUserIds` (intake's
 * member rows, decision 142). The caller then applies the person's own
 * preference (`isInAppTypeEnabled` in the bell writer, `emailDeliveryFor` for
 * an email), as every notification does.
 *
 * Kept in `notifications/`, never `jobs/`: the usecases import it.
 *
 * Written fresh for Islestone.
 */
import type { PrismaTx } from '@/lib/db-context';
import { permissionsForMembership, type PermissionSet } from '@/lib/permissions';
import { RECIPIENT_LIST_MEMBERS_MAX } from '@/lib/recipient-lists/types';

import { resolveProjectVisibility } from '../policies/project-visibility';

export interface ResolveListRecipientsInput {
    /** The lists named. An archived list, or another project's, gives nobody. */
    listIds: readonly string[];
    /**
     * The project the notice is about: every person must see it, and a
     * project list must be its. Absent: only workspace lists count, and no
     * project is checked.
     */
    projectId?: string | null;
    /** People named outside a list (intake's member rows), held to the same checks. */
    alsoUserIds?: readonly string[];
    /** What each person's permissions must hold now. */
    may: (permissions: PermissionSet) => boolean;
}

export interface ResolvedListRecipients {
    /** The people to notify, each once, in the order they were first named. */
    userIds: string[];
    /** Everybody the lists (live and in scope) and `alsoUserIds` named, each once, before the checks. */
    named: string[];
}

const NOBODY: ResolvedListRecipients = { userIds: [], named: [] };

export async function resolveListRecipients(db: PrismaTx, tenantId: string, input: ResolveListRecipientsInput): Promise<ResolvedListRecipients> {
    // A removed workspace mails nobody: its memberships outlive its soft delete.
    const live = await db.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } });
    if (!live) return NOBODY;

    const projectId = input.projectId ?? null;
    const listIds = [...new Set(input.listIds)];
    const members =
        listIds.length === 0
            ? []
            : await db.recipientListMember.findMany({
                  where: {
                      tenantId,
                      listId: { in: listIds },
                      list: { archivedAt: null, OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] },
                  },
                  orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
                  take: listIds.length * RECIPIENT_LIST_MEMBERS_MAX,
                  select: { userId: true },
              });
    const named = [...new Set([...(input.alsoUserIds ?? []), ...members.map((m) => m.userId)])];
    if (named.length === 0) return NOBODY;

    const memberships = await db.tenantMembership.findMany({
        where: { tenantId, userId: { in: named }, status: 'ACTIVE' },
        take: named.length,
        // The person behind each membership: this file resolves members to
        // people, so the liveness census counts it.
        select: { userId: true, role: true, customRole: { select: { grantsJson: true, baseRole: true } }, user: { select: { id: true } } },
    });
    const allowed = new Set<string>();
    for (const m of memberships) {
        if (!input.may(permissionsForMembership(m))) continue;
        if (projectId) {
            const v = resolveProjectVisibility({ role: m.customRole?.baseRole ?? m.role, membershipRole: m.role });
            if (v.kind !== 'ALL' && !v.projectIds.includes(projectId)) continue;
        }
        allowed.add(m.user.id);
    }
    return { userIds: named.filter((id) => allowed.has(id)), named };
}
