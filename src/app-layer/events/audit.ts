/**
 * `logEvent` — the usecase-side audit writer.
 *
 * Copied from inflect-compliance `src/app-layer/events/audit.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. Sub-phase 1.4 lands it before
 * 1.5, so it writes through the `@/lib/audit` stub, and the
 * `validateAuditDetailsJson` check (1.5's json-columns schemas) is not yet
 * applied. 1.5 restores it.
 */
import type { PrismaTx } from '@/lib/db-context';
import { appendAuditEntry } from '@/lib/audit';

import type { RequestContext } from '../types';

export interface AuditEventPayload {
    action: string;
    entityType: string;
    entityId: string;
    details?: string;
    detailsJson?: Record<string, unknown>;
    /** Must be safe and non-secret. */
    metadata?: Record<string, unknown>;
}

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
        detailsJson: payload.detailsJson,
        requestId: ctx.requestId,
        metadataJson: safeMetadata,
    });
}
