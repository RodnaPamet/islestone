/**
 * Blocked senders (sub-phase 2.6c; ADR 0006 "Blocked sender"; owner
 * decisions 92 and 123): addresses a project, or the whole workspace, takes
 * no intake from. Their emails are dropped by the fetch job and their
 * public-form requests answered as if stored, with nothing stored.
 *
 * A block is kept ONLY as the address's lookup hash (`hashForLookup`): the
 * address is never stored, so Settings shows where and when an address was
 * blocked and finds one by the address a manager types. Managed under
 * `intake.manage` (decision 92), also when it comes with a spam decline.
 * Audit entries name the row and its scope, never the address or its hash.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { IntakeEmailRepository } from '../repositories/IntakeEmailRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { assertCanManageIntake } from '../policies/intake.policies';
import { visibleProjects } from '../policies/project-visibility';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import type { PrismaTx } from '@/lib/db-context';
import { notFound } from '@/lib/errors/types';
import type { IntakeBlockedSenderView } from '@/lib/intake/types';
import { hashForLookup } from '@/lib/security/encryption';

type BlockedRow = { id: string; projectId: string | null; createdByUserId: string; createdAt: Date };

function view(r: BlockedRow): IntakeBlockedSenderView {
    return { id: r.id, projectId: r.projectId, createdByUserId: r.createdByUserId, createdAt: r.createdAt.toISOString() };
}

/** The workspace's blocks and those of every visible project; one address's when `email` is given. */
export async function listBlockedSenders(ctx: RequestContext, filter: { email?: string } = {}): Promise<IntakeBlockedSenderView[]> {
    assertCanManageIntake(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const projects = await ProjectRepository.list(db, ctx, v);
        const rows = await IntakeEmailRepository.listBlocked(
            db,
            ctx,
            projects.map((p) => p.id),
            filter.email ? hashForLookup(filter.email) : undefined,
        );
        return rows.map(view);
    });
}

/**
 * Block an address hash in the caller's transaction: on a project, or across
 * the workspace when `projectId` is null. Idempotent; audited only when a row
 * is written. The caller has asserted `intake.manage` and the project's
 * visibility.
 */
export async function blockSenderInTx(
    db: PrismaTx,
    ctx: RequestContext,
    target: { projectId: string | null; emailHash: string; via: 'SETTINGS' | 'SPAM_DECLINE' },
): Promise<{ row: IntakeBlockedSenderView; created: boolean }> {
    const { row, created } = await IntakeEmailRepository.block(db, ctx, { projectId: target.projectId, emailHash: target.emailHash, createdByUserId: ctx.userId });
    if (created) {
        await logEvent(db, ctx, {
            action: 'INTAKE_SENDER_BLOCKED',
            entityType: 'IntakeBlockedSender',
            entityId: row.id,
            details: target.projectId ? 'Blocked a sender on a project' : 'Blocked a sender across the workspace',
            detailsJson: { category: 'entity_lifecycle', entityName: 'IntakeBlockedSender', operation: 'created', summary: 'INTAKE_SENDER_BLOCKED' },
            metadata: { projectId: target.projectId, scope: target.projectId ? 'PROJECT' : 'WORKSPACE', via: target.via },
        });
    }
    return { row: view(row), created };
}

export interface BlockSenderInput {
    email: string;
    /** The project; null blocks the address across the workspace. */
    projectId: string | null;
}

export async function blockSender(ctx: RequestContext, input: BlockSenderInput): Promise<{ row: IntakeBlockedSenderView; created: boolean }> {
    assertCanManageIntake(ctx);
    return runInTenantContext(ctx, async (db) => {
        if (input.projectId) {
            const v = await visibleProjects(ctx, db);
            const p = await ProjectRepository.getVisible(db, ctx, v, input.projectId);
            if (!p) throw notFound('Project not found');
        }
        return blockSenderInTx(db, ctx, { projectId: input.projectId, emailHash: hashForLookup(input.email), via: 'SETTINGS' });
    });
}

/** Unblock: the row goes, so the address's next email or form request is taken again. */
export async function unblockSender(ctx: RequestContext, id: string): Promise<void> {
    assertCanManageIntake(ctx);
    await runInTenantContext(ctx, async (db) => {
        const row = await IntakeEmailRepository.getBlocked(db, ctx, id);
        if (!row) throw notFound('Blocked sender not found');
        if (row.projectId) {
            const v = await visibleProjects(ctx, db);
            if (!(await ProjectRepository.getVisible(db, ctx, v, row.projectId))) throw notFound('Blocked sender not found');
        }
        await IntakeEmailRepository.unblock(db, ctx, row.id);
        await logEvent(db, ctx, {
            action: 'INTAKE_SENDER_UNBLOCKED',
            entityType: 'IntakeBlockedSender',
            entityId: row.id,
            details: row.projectId ? 'Unblocked a sender on a project' : 'Unblocked a sender across the workspace',
            detailsJson: { category: 'entity_lifecycle', entityName: 'IntakeBlockedSender', operation: 'deleted', summary: 'INTAKE_SENDER_UNBLOCKED' },
            metadata: { projectId: row.projectId, scope: row.projectId ? 'PROJECT' : 'WORKSPACE' },
        });
    });
}
