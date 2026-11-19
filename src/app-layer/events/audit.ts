/**
 * `logEvent` — the usecase-side audit writer.
 *
 * Copied from inflect-compliance `src/app-layer/events/audit.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import type { PrismaTx } from '@/lib/db-context';
import { appendAuditEntry } from '@/lib/audit';

import { validateAuditDetailsJson } from '../schemas/json-columns.schemas';
import type { RequestContext } from '../types';

export interface AuditEventPayload {
    action: string;
    entityType: string;
    entityId: string;
    details?: string;
    /** Structured event payload — source of truth for machine-readable audit */
    detailsJson?: Record<string, unknown>;
    /** Must be safe and non-secret. */
    metadata?: Record<string, unknown>;
}

/**
 * Centralized audit event writer.
 * Routes through appendAuditEntry() for hash-chained, per-tenant audit logging.
 *
 * NOTE: The `db` parameter is accepted for API compatibility but the actual
 * insert uses the global prisma client via appendAuditEntry() to ensure
 * advisory lock isolation. This is safe because audit inserts are idempotent
 * side-effects that don't depend on the caller's transaction state.
 */
export async function logEvent(_db: PrismaTx, ctx: RequestContext, payload: AuditEventPayload): Promise<void> {
    // Sanitize metadata to avoid accidental secret leak
    const safeMetadata = payload.metadata ? JSON.parse(JSON.stringify(payload.metadata)) : undefined;

    // Build combined details for backward compat
    const standardContext = { requestId: ctx.requestId, ...safeMetadata };
    let combinedDetails = payload.details ? payload.details + '\n\n' : '';
    combinedDetails += `Context: ${JSON.stringify(standardContext)}`;

    await appendAuditEntry({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.actorType,
        entity: payload.entityType,
        entityId: payload.entityId,
        action: payload.action,
        details: combinedDetails,
        detailsJson: validateAuditDetailsJson(payload.detailsJson),
        requestId: ctx.requestId,
        metadataJson: safeMetadata,
    });
}
