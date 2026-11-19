import { forbidden } from '@/lib/errors/types';

import type { RequestContext } from '../types';

/**
 * Asserts the user has READ permission in their current context.
 */
export function assertCanRead(ctx: RequestContext) {
    if (!ctx.permissions.canRead) {
        throw forbidden('You do not have permission to view records in this context.');
    }
}

/**
 * Asserts the user has WRITE permission in their current context.
 */
export function assertCanWrite(ctx: RequestContext) {
    if (!ctx.permissions.canWrite) {
        throw forbidden('You do not have permission to modify records in this context.');
    }
}

/**
 * Asserts the user has ADMIN permission in their current context.
 */
export function assertCanAdmin(ctx: RequestContext) {
    if (!ctx.permissions.canAdmin) {
        throw forbidden('You do not have permission to perform administrative actions in this context.');
    }
}

/**
 * Asserts the user may EXPORT workspace data (OWNER and ADMIN).
 *
 * Replaces inflect-compliance's `assertCanAudit`: sub-phase 1.3 removed the
 * audit tier from `RequestContext.permissions` and kept `canExport`.
 */
export function assertCanExport(ctx: RequestContext) {
    if (!ctx.permissions.canExport) {
        throw forbidden('You do not have permission to export data in this context.');
    }
}
