/**
 * `logEvent` — the usecase-side audit writer.
 *
 * Copied from inflect-compliance `src/app-layer/events/audit.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import type { PrismaTx } from '@/lib/db-context';
import { appendAuditEntry, appendAuditEntryWithin } from '@/lib/audit';
import type { AuditAppendClient } from '@/lib/audit';

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

/** Options for {@link logEvent}. */
export interface LogEventOptions {
    /**
     * Append INSIDE the transaction `db` belongs to (`appendAuditEntryWithin`),
     * so the entry commits or rolls back with the work it records. Off by
     * default: the entry is then appended in a transaction of its own and
     * streamed to the workspace's SIEM after it commits. An in-transaction
     * append is not streamed (the writer cannot know whether the caller's
     * transaction commits), and holds the workspace's chain lock until that
     * transaction ends. Sub-phase 1.5b's first caller is
     * `ensureTenantSystemUser`, whose `SYSTEM_USER_CREATED` entry must not
     * commit without the row it describes, nor the row without it.
     */
    withinTransaction?: boolean;
}

/**
 * Centralized audit event writer.
 * Routes through appendAuditEntry() for hash-chained, per-tenant audit logging.
 *
 * By default the `db` parameter is accepted for API compatibility and the
 * insert uses the global prisma client via appendAuditEntry(), in a
 * transaction of its own, to ensure advisory lock isolation. With
 * `{ withinTransaction: true }` it appends inside `db`'s transaction instead
 * (see {@link LogEventOptions}).
 */
export async function logEvent(
    db: PrismaTx,
    ctx: RequestContext,
    payload: AuditEventPayload,
    options: LogEventOptions = {},
): Promise<void> {
    // Sanitize metadata to avoid accidental secret leak
    const safeMetadata = payload.metadata ? JSON.parse(JSON.stringify(payload.metadata)) : undefined;

    // Build combined details for backward compat
    const standardContext = { requestId: ctx.requestId, ...safeMetadata };
    let combinedDetails = payload.details ? payload.details + '\n\n' : '';
    combinedDetails += `Context: ${JSON.stringify(standardContext)}`;

    const entry = {
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
    };

    if (options.withinTransaction) {
        await appendAuditEntryWithin(db as unknown as AuditAppendClient, entry);
        return;
    }
    await appendAuditEntry(entry);
}
