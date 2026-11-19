/**
 * The audit log — SUB-PHASE 1.4 STUB at the final module path.
 *
 * Sub-phase 1.5 ports inflect-compliance's hash-chained `AuditLog`
 * (`appendAuditEntry`, the outbox behind `appendAuditEntryOrQueue`) and
 * replaces this file without touching its importers
 * (docs/porting/maps/1.4.md, "Ordering and risks", step 0).
 *
 * Until then an entry is NOT stored in a table. It is written as one
 * structured `audit.entry` log line at `info`, so an `AUTHZ_DENIED` denial
 * and every other audited event stays observable in the logs, and callers
 * already pass the exact input the real writer takes. The signatures are the
 * real ones, so a test that mocks this module keeps working when 1.5 lands.
 */
import { randomUUID } from 'node:crypto';

import { logger } from '@/lib/observability/logger';

export type ActorType = 'USER' | 'SYSTEM' | 'JOB';

/** The input of inflect-compliance's `appendAuditEntry`, unchanged. */
export interface AppendAuditInput {
    tenantId: string;
    userId: string | null;
    actorType?: string;
    entity: string;
    entityId: string;
    action: string;
    details?: string | null;
    detailsJson?: unknown;
    requestId?: string | null;
    recordIds?: unknown;
    metadataJson?: unknown;
    diffJson?: unknown;
    version?: number;
}

export interface AppendAuditResult {
    id: string;
    entryHash: string;
    previousHash: string | null;
}

export type AuditRecordOutcome =
    | { recorded: 'chain'; auditId: string }
    | { recorded: 'queued'; outboxId: string };

/** Thrown when neither the chain nor the outbox could take the entry (1.5). */
export class AuditNotRecordedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuditNotRecordedError';
    }
}

/**
 * Records one audit entry. 1.4 stub: one `audit.entry` log line. `client` is
 * accepted for signature parity and ignored.
 */
export async function appendAuditEntry(input: AppendAuditInput, _client?: unknown): Promise<AppendAuditResult> {
    const id = randomUUID();
    logger.info('audit.entry', {
        component: 'audit',
        auditId: id,
        tenantId: input.tenantId,
        userId: input.userId ?? undefined,
        actorType: input.actorType ?? 'USER',
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        requestId: input.requestId ?? undefined,
        detailsJson: input.detailsJson,
    });
    return { id, entryHash: '', previousHash: null };
}

/** The no-silent-drop wrapper; in 1.4 it is `appendAuditEntry`. */
export async function appendAuditEntryOrQueue(input: AppendAuditInput, client?: unknown): Promise<AuditRecordOutcome> {
    const result = await appendAuditEntry(input, client);
    return { recorded: 'chain', auditId: result.id };
}
