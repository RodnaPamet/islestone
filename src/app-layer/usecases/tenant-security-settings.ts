import { badRequest, forbidden } from '@/lib/errors/types';
import { runInTenantContext } from '@/lib/db-context';

import { logEvent } from '../events/audit';
import type { RequestContext } from '../types';

/**
 * Tenant security settings — the WRITE path.
 *
 * Rewritten from inflect-compliance
 * `src/app-layer/usecases/tenant-security-settings.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e down to the two fields sub-phase
 * 1.4 owns (docs/porting/maps/1.4.md, section E): the concurrent-session cap
 * and the MFA fail-closed switch. Sub-phase 1.5 adds the audit-stream URL and
 * secret, 5.2 the API-key rotation age; the AI, agent, legacy-access and
 * workpaper fields of the parent are not ported.
 *
 *   maxConcurrentSessions ← src/lib/security/session-tracker.ts
 *   mfaFailClosed         ← src/auth.ts (fail-closed MFA enforcement)
 *
 * `mfaPolicy` and `sessionMaxAgeMinutes` are deliberately NOT writable here —
 * they already have an owner in `updateTenantMfaPolicy`, and two writers for
 * one field is how settings pages start clobbering each other.
 *
 * ── Patch semantics are load-bearing ────────────────────────────────
 *
 * Only keys PRESENT in the patch are written; `null` explicitly clears. This
 * is not ergonomics, it is correctness: `updateTenantMfaPolicy` upserts the
 * SAME ROW and its update block writes `sessionMaxAgeMinutes: input.… ?? null`
 * unconditionally. A second writer that sent a full row would silently reset
 * whatever the other one owns. Sending only what changed keeps the two
 * writers non-interfering.
 */

/** Reads are admin-only — the row carries session policy. */
function assertCanManageSecuritySettings(ctx: RequestContext) {
    if (!ctx.appPermissions.admin.manage) {
        throw forbidden('Only ADMIN or OWNER can manage tenant security settings');
    }
}

export interface TenantSecurityConfig {
    maxConcurrentSessions: number | null;
    mfaFailClosed: boolean;
}

export interface TenantSecurityConfigPatch {
    maxConcurrentSessions?: number | null;
    mfaFailClosed?: boolean;
}

const MAX_CONCURRENT_SESSIONS_CEILING = 100;

export async function getTenantSecurityConfig(ctx: RequestContext): Promise<TenantSecurityConfig> {
    assertCanManageSecuritySettings(ctx);

    return runInTenantContext(ctx, async (db) => {
        const row = await db.tenantSecuritySettings.findUnique({
            where: { tenantId: ctx.tenantId },
            select: { maxConcurrentSessions: true, mfaFailClosed: true },
        });
        return {
            maxConcurrentSessions: row?.maxConcurrentSessions ?? null,
            mfaFailClosed: row?.mfaFailClosed ?? false,
        };
    });
}

export async function updateTenantSecurityConfig(
    ctx: RequestContext,
    patch: TenantSecurityConfigPatch,
): Promise<TenantSecurityConfig> {
    assertCanManageSecuritySettings(ctx);

    const data: Record<string, unknown> = {};
    const changed: string[] = [];

    if (patch.maxConcurrentSessions !== undefined) {
        const v = patch.maxConcurrentSessions;
        if (v !== null) {
            // The lower bound of 1 is load-bearing, not decoration. The reader
            // in `session-tracker.ts` gates on `maxConcurrent > 0`, so a stored
            // 0 or -1 falls into the SAME branch as null and reads as
            // UNLIMITED. An admin typing 0 to mean "block additional sessions"
            // would get the exact opposite of what they asked for, silently.
            // Rejecting it here is the only place that can say so.
            if (!Number.isInteger(v) || v < 1 || v > MAX_CONCURRENT_SESSIONS_CEILING) {
                throw badRequest(
                    `maxConcurrentSessions must be an integer between 1 and ${MAX_CONCURRENT_SESSIONS_CEILING}, or null for unlimited. ` +
                        '0 is not accepted: the session tracker reads any value below 1 as unlimited.',
                );
            }
        }
        data.maxConcurrentSessions = v;
        changed.push('maxConcurrentSessions');
    }

    if (patch.mfaFailClosed !== undefined) {
        data.mfaFailClosed = patch.mfaFailClosed;
        changed.push('mfaFailClosed');
    }

    if (changed.length === 0) {
        throw badRequest('No settings supplied');
    }

    return runInTenantContext(ctx, async (db) => {
        await db.tenantSecuritySettings.upsert({
            where: { tenantId: ctx.tenantId },
            // The create branch carries ONLY the supplied fields. Everything
            // else falls to its schema default — notably `mfaPolicy`, which
            // this usecase must never author.
            create: { tenantId: ctx.tenantId, ...data },
            update: data,
        });

        await logEvent(db, ctx, {
            action: 'SECURITY_SETTINGS_UPDATED',
            entityType: 'TenantSecuritySettings',
            entityId: ctx.tenantId,
            details: `Updated tenant security settings: ${changed.join(', ')}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'TenantSecuritySettings',
                operation: 'updated',
                // FIELD NAMES ONLY: the audit trail records THAT they changed.
                changedFields: changed,
            },
        });

        const row = await db.tenantSecuritySettings.findUnique({
            where: { tenantId: ctx.tenantId },
            select: { maxConcurrentSessions: true, mfaFailClosed: true },
        });
        return {
            maxConcurrentSessions: row?.maxConcurrentSessions ?? null,
            mfaFailClosed: row?.mfaFailClosed ?? false,
        };
    });
}
