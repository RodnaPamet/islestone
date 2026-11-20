/**
 * The membership reads work-item usecases need: is a person an ACTIVE member
 * (an assignee, a watcher), and who are they (the assignment mail). Moved out
 * of inflect-compliance's `usecases/task.ts` (`assertActiveMembers` line 155,
 * `resolveTaskAssignmentEmailParties` lines 1250–1275, at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e) into a repository, so usecases
 * call no Prisma delegate directly.
 */
import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

export class MembershipRepository {
    /** The user ids among `userIds` that hold an ACTIVE membership in the workspace. */
    static async listActiveUserIds(db: PrismaTx, ctx: RequestContext, userIds: readonly string[]): Promise<Set<string>> {
        if (userIds.length === 0) return new Set();
        const rows = await db.tenantMembership.findMany({
            where: { tenantId: ctx.tenantId, userId: { in: [...userIds] }, status: 'ACTIVE' },
            take: userIds.length,
            select: { userId: true },
        });
        return new Set(rows.map((r) => r.userId));
    }

    /**
     * The given users' ACTIVE memberships with their role and custom role, so
     * a caller can predict what each may do (`permissionsForMembership`):
     * the intake bells re-check `intake.view` before they ring (2.6a).
     */
    static async activeMembershipsWithRoles(db: PrismaTx, ctx: RequestContext, userIds: readonly string[]) {
        if (userIds.length === 0) return [];
        return db.tenantMembership.findMany({
            where: { tenantId: ctx.tenantId, userId: { in: [...userIds] }, status: 'ACTIVE' },
            take: userIds.length,
            select: { userId: true, role: true, customRole: { select: { grantsJson: true, baseRole: true } } },
        });
    }

    /** Name and address of the given users (decrypted by the PII extension). */
    static async contactsOf(db: PrismaTx, userIds: readonly string[]) {
        if (userIds.length === 0) return [];
        return db.user.findMany({
            where: { id: { in: [...userIds] } },
            take: userIds.length,
            select: { id: true, name: true, email: true },
        });
    }
}
