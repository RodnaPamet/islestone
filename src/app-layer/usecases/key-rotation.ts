/**
 * Key rotation: start a master-key (KEK) rotation or a per-workspace DEK
 * rotation for the caller's workspace, and read the progress of either job.
 *
 * Sub-phase 1.5b. The routes under `/api/t/:slug/admin/key-rotation` and
 * `/api/t/:slug/admin/tenant-dek-rotation` call these. In inflect-compliance
 * (`src/app/api/t/[tenantSlug]/admin/key-rotation/route.ts` and
 * `admin/_lib/rotate-dek-handlers.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e) the routes enqueued, audited and
 * looked the job up themselves; the logic moved here because Islestone's route
 * handlers parse, call a usecase and respond (CLAUDE.md, "Layer rules").
 *
 * The two rotations (both OWNER-only):
 *
 *   - **Master key.** The operator stages a new `DATA_ENCRYPTION_KEY` with the
 *     old one as `DATA_ENCRYPTION_KEY_PREVIOUS`; this enqueues `key-rotation`
 *     for one workspace, which re-wraps its DEK and re-encrypts its `v1:`
 *     ciphertexts under the new key. OWNER-only, `admin.tenant_lifecycle`
 *     (owner decision, 2026-11-19; inflect-compliance admitted ADMIN).
 *   - **Workspace DEK.** `rotateTenantDek` swaps in a fresh DEK, keeping the
 *     old one in `Tenant.previousEncryptedDek`, and enqueues
 *     `tenant-dek-rotation` to re-encrypt every `v2:` ciphertext. OWNER-only,
 *     `admin.tenant_lifecycle`. While a sweep is in flight a second rotation is
 *     refused with a 409.
 *
 * Each start writes an audit entry naming the job, so who touched the keys and
 * when outlives the job's retention in Redis. The jobs write their own
 * STARTED and COMPLETED entries when they run.
 */
import { runInTenantContext } from '@/lib/db-context';
import { conflict, notFound } from '@/lib/errors/types';
import { rotateTenantDek } from '@/lib/security/tenant-key-manager';

import { logEvent } from '../events/audit';
import { enqueue } from '../jobs/queue';
import { findTenantJob } from '../jobs/tenant-job-lookup';
import type { JobName } from '../jobs/types';
import { assertCanRotateMasterKey, assertCanRotateTenantDek } from '../policies/admin.policies';
import type { RotationJobStatusQueryInput } from '../schemas/key-rotation.schemas';
import type { RequestContext } from '../types';

/** What a start returns: the job's handle for the status route. */
export interface RotationStarted {
    status: 'queued';
    jobId: string;
    tenantId: string;
    initiatedByUserId: string;
}

/** What a status read returns. Counts and phases only: never key material. */
export interface RotationJobStatus {
    jobId: string;
    state: string;
    progress: unknown;
    result: unknown;
    failedReason: string | null;
}

/**
 * The messages `rotateTenantDek` throws when a rotation is already in flight:
 * `previousEncryptedDek` set when it read the row, or set by a concurrent
 * caller between its read and its swap. `tenant-key-manager.ts` is a verbatim
 * copy of inflect-compliance's and throws plain `Error`s, so they are told
 * apart by message here; `tests/unit/tenant-dek-rotation-admin-api.test.ts` pins both
 * against the real function.
 */
const ROTATION_IN_FLIGHT = /already mid-rotation|concurrent rotation detected/;

/**
 * Start a master-key rotation for this workspace. Enqueues `key-rotation` and
 * audits `KEY_ROTATION_INITIATED`.
 */
export async function startKeyRotation(ctx: RequestContext): Promise<RotationStarted> {
    assertCanRotateMasterKey(ctx);

    const job = await enqueue('key-rotation', {
        tenantId: ctx.tenantId,
        initiatedByUserId: ctx.userId,
        requestId: ctx.requestId,
    });
    const jobId = job.id ?? '';

    // The attribution row an auditor reads when reviewing who touched the
    // keys and when, even after the job has left BullMQ's retention.
    await runInTenantContext(ctx, (db) =>
        logEvent(db, ctx, {
            action: 'KEY_ROTATION_INITIATED',
            entityType: 'TenantKey',
            entityId: ctx.tenantId,
            details: `Master-key rotation initiated by owner ${ctx.userId}`,
            detailsJson: {
                category: 'custom',
                event: 'key_rotation_initiated',
                jobId,
                job: 'key-rotation',
            },
            metadata: { jobId },
        }),
    );

    return { status: 'queued', jobId, tenantId: ctx.tenantId, initiatedByUserId: ctx.userId };
}

/**
 * Rotate this workspace's DEK. The swap happens now (`rotateTenantDek`); the
 * re-encryption sweep runs in the worker. Audits `TENANT_DEK_ROTATED`.
 *
 * @throws ConflictError (409) while an earlier rotation's sweep is in flight.
 */
export async function startTenantDekRotation(ctx: RequestContext): Promise<RotationStarted> {
    assertCanRotateTenantDek(ctx);

    let started: { tenantId: string; jobId: string };
    try {
        started = await rotateTenantDek({
            tenantId: ctx.tenantId,
            initiatedByUserId: ctx.userId,
            requestId: ctx.requestId,
        });
    } catch (err) {
        if (err instanceof Error && ROTATION_IN_FLIGHT.test(err.message)) {
            throw conflict(
                'A data-key rotation is already in flight for this workspace. ' +
                    'Wait for its re-encryption sweep to finish before starting another.',
            );
        }
        throw err;
    }

    // The security-relevant moment is the swap, distinct from the sweep's
    // own STARTED and COMPLETED entries.
    await runInTenantContext(ctx, (db) =>
        logEvent(db, ctx, {
            action: 'TENANT_DEK_ROTATED',
            entityType: 'TenantKey',
            entityId: started.tenantId,
            details: `Workspace data key rotated by owner ${ctx.userId}`,
            detailsJson: {
                category: 'custom',
                event: 'tenant_dek_rotated',
                jobId: started.jobId,
                job: 'tenant-dek-rotation',
            },
            metadata: { jobId: started.jobId, sweepJob: 'tenant-dek-rotation' },
        }),
    );

    return {
        status: 'queued',
        jobId: started.jobId,
        tenantId: started.tenantId,
        initiatedByUserId: ctx.userId,
    };
}

/**
 * Read one of this workspace's own jobs of `name`. Every job type shares one
 * queue, so an id belonging to another workspace, to another kind of job or
 * to a platform-wide job is answered 404, the same as an id that does not
 * exist (`findTenantJob`).
 */
async function readRotationJob(
    ctx: RequestContext,
    name: Extract<JobName, 'key-rotation' | 'tenant-dek-rotation'>,
    input: RotationJobStatusQueryInput,
): Promise<RotationJobStatus> {
    const job = await findTenantJob(input.jobId, ctx.tenantId, name);
    if (!job) throw notFound(`No job with id ${input.jobId}`);
    return {
        jobId: input.jobId,
        state: await job.getState(),
        progress: job.progress,
        result: job.returnvalue ?? null,
        failedReason: job.failedReason ?? null,
    };
}

/** Progress of this workspace's `key-rotation` job. */
export async function getKeyRotationStatus(
    ctx: RequestContext,
    input: RotationJobStatusQueryInput,
): Promise<RotationJobStatus> {
    assertCanRotateMasterKey(ctx);
    return readRotationJob(ctx, 'key-rotation', input);
}

/** Progress of this workspace's `tenant-dek-rotation` sweep. */
export async function getTenantDekRotationStatus(
    ctx: RequestContext,
    input: RotationJobStatusQueryInput,
): Promise<RotationJobStatus> {
    assertCanRotateTenantDek(ctx);
    return readRotationJob(ctx, 'tenant-dek-rotation', input);
}
