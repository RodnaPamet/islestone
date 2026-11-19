/**
 * The organization audit log — SUB-PHASE 1.4 STUB at the final module path.
 *
 * Sub-phase 1.5 adds the hash-chained `OrgAuditLog` table and replaces this
 * file. Until then an entry is one structured `audit.org_entry` log line at
 * `info` (see `@/lib/audit` for the reason). The signature is the real one.
 */
import { randomUUID } from 'node:crypto';

import type { OrgAuditAction } from '@prisma/client';

import { logger } from '@/lib/observability/logger';

export interface AppendOrgAuditInput {
    organizationId: string;
    actorUserId: string | null;
    actorType?: string;
    action: OrgAuditAction;
    targetUserId?: string | null;
    detailsJson?: unknown;
    requestId?: string | null;
    version?: number;
}

export interface AppendOrgAuditResult {
    id: string;
    entryHash: string;
    previousHash: string | null;
}

export async function appendOrgAuditEntry(input: AppendOrgAuditInput, _client?: unknown): Promise<AppendOrgAuditResult> {
    const id = randomUUID();
    logger.info('audit.org_entry', {
        component: 'audit',
        auditId: id,
        organizationId: input.organizationId,
        userId: input.actorUserId ?? undefined,
        actorType: input.actorType ?? 'USER',
        action: input.action,
        targetUserId: input.targetUserId ?? undefined,
        requestId: input.requestId ?? undefined,
        detailsJson: input.detailsJson,
    });
    return { id, entryHash: '', previousHash: null };
}
