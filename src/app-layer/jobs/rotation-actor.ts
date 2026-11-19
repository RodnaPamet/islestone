/**
 * Who a key-rotation job acts as when it RUNS (owner decision, 2026-11-19).
 *
 * Both rotations (`key-rotation`, `tenant-dek-rotation`) are started by a
 * person, through an OWNER-only route, and then wait in the queue. When the job
 * runs, that person is resolved again:
 *
 *   - still an ACTIVE member holding `admin.tenant_lifecycle` (the key both
 *     routes are gated on) → the job acts AS THEM: their real role and
 *     permissions (`resolveInitiatorContext`), and the audit entries name them
 *     (`authority: 'INITIATOR'`);
 *   - anything else — removed, deactivated, demoted below the key, or the
 *     workspace soft-deleted → the rotation STILL RUNS, as the workspace's
 *     system user (`buildTenantSystemJobContext`, `authority: 'SYSTEM'`). The
 *     audit entries and the job result record who asked (`requestedByUserId`)
 *     and why they were not acted for (`refusal`), and never name that person
 *     as the actor.
 *
 * THIS IS THE OWNER-DECIDED EXCEPTION to the job-identity rule (CLAUDE.md, "Job
 * identity": a `null` from `resolveInitiatorContext` is a refusal, never a
 * fallback to a system context). The reason is the work itself: a rotation
 * does one fixed thing to the workspace's own keys, reads no permission and
 * acts on nobody else's data, and a rotation that stopped because the owner
 * who asked for it has since left would leave the workspace's keys half-moved
 * — a previous master key that cannot be retired, or a compromised DEK still
 * in `previousEncryptedDek`. So it finishes, and the trail says on whose
 * request and under which authority. No other job may take this path.
 *
 * Written for Islestone (sub-phase 1.5b). inflect-compliance's rotations wrote
 * their entries as the initiator with `actorType: 'SYSTEM'` and never
 * re-resolved them.
 *
 * @module app-layer/jobs/rotation-actor
 */
import type { MembershipStatus } from '@prisma/client';

import { logger } from '@/lib/observability/logger';

import {
    buildTenantSystemJobContext,
    resolveInitiatorContext,
    resolveMemberContextWithReason,
} from '../context-system';
import type { RequestContext } from '../types';

/** The permission key both rotation routes are gated on, re-asked at run time. */
export const ROTATION_PERMISSION_KEY = 'admin.tenant_lifecycle' as const;

/** Why the job did not act as the person who asked. */
export type RotationRefusal =
    /** No membership row: removed from the workspace. */
    | { reason: 'NOT_A_MEMBER' }
    /** A membership that is not ACTIVE (deactivated, invited, removed). */
    | { reason: 'NOT_ACTIVE'; status: MembershipStatus }
    /** An ACTIVE member of a soft-deleted workspace. */
    | { reason: 'TENANT_DELETED' }
    /** An ACTIVE member who no longer holds the route's key (demoted). */
    | { reason: 'LACKS_PERMISSION'; permission: typeof ROTATION_PERMISSION_KEY };

export type RotationActor =
    | {
          authority: 'INITIATOR';
          ctx: RequestContext;
          requestedByUserId: string;
          refusal: null;
      }
    | {
          authority: 'SYSTEM';
          ctx: RequestContext;
          requestedByUserId: string;
          refusal: RotationRefusal;
      };

/**
 * The fields an audit entry and a job result carry about the actor. The same
 * object in both places, so the two cannot disagree.
 */
export interface RotationActorRecord {
    authority: RotationActor['authority'];
    requestedByUserId: string;
    actorUserId: string;
    refusal: RotationRefusal | null;
}

export function rotationActorRecord(actor: RotationActor): RotationActorRecord {
    return {
        authority: actor.authority,
        requestedByUserId: actor.requestedByUserId,
        actorUserId: actor.ctx.userId,
        refusal: actor.refusal,
    };
}

async function refusalFor(input: {
    tenantId: string;
    userId: string;
    job: string;
    resolved: RequestContext | null;
}): Promise<RotationRefusal> {
    // Resolved, so ACTIVE in a live workspace: the key is what is missing.
    if (input.resolved) return { reason: 'LACKS_PERMISSION', permission: ROTATION_PERMISSION_KEY };
    const member = await resolveMemberContextWithReason({
        tenantId: input.tenantId,
        userId: input.userId,
        job: input.job,
    });
    if (!member.ok) {
        return member.reason === 'NOT_ACTIVE'
            ? { reason: 'NOT_ACTIVE', status: member.status }
            : { reason: 'NOT_A_MEMBER' };
    }
    // ACTIVE, yet `resolveInitiatorContext` refused: the workspace is
    // soft-deleted (the one other term it asks).
    return { reason: 'TENANT_DELETED' };
}

/**
 * Resolve the actor for one run of a rotation job. Never throws for a refusal
 * and never returns "do not run": the rotation always runs.
 */
export async function resolveRotationActor(input: {
    tenantId: string;
    requestedByUserId: string;
    /** The job name, for the system context's request id. */
    job: 'key-rotation' | 'tenant-dek-rotation';
    requestId?: string;
}): Promise<RotationActor> {
    const requestId = input.requestId ?? `${input.job}-${input.tenantId}`;
    const resolved = await resolveInitiatorContext({
        tenantId: input.tenantId,
        userId: input.requestedByUserId,
        requestId,
    });
    if (resolved && resolved.appPermissions.admin?.tenant_lifecycle) {
        return {
            authority: 'INITIATOR',
            ctx: { ...resolved, actorType: 'USER' },
            requestedByUserId: input.requestedByUserId,
            refusal: null,
        };
    }

    const refusal = await refusalFor({
        tenantId: input.tenantId,
        userId: input.requestedByUserId,
        job: input.job,
        resolved,
    });
    const ctx = await buildTenantSystemJobContext({
        tenantId: input.tenantId,
        job: input.job,
        requestId,
    });
    logger.warn('rotation.initiator_not_acted_for', {
        component: input.job,
        tenantId: input.tenantId,
        requestedByUserId: input.requestedByUserId,
        reason: refusal.reason,
    });
    return { authority: 'SYSTEM', ctx, requestedByUserId: input.requestedByUserId, refusal };
}
