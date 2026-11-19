/**
 * The per-tenant SYSTEM user's marker — the part sub-phase 1.4 needs.
 *
 * Copied from inflect-compliance `src/lib/tenant-system-user.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: `isTenantSystemUserId` only, which
 * is its real body. Sub-phase 1.6 brings the system user itself (the row a
 * background job writes a NOT NULL `User` foreign key as), the rest of this
 * file, and the migration CHECKs that refuse the `sys_` prefix in every table
 * that would let a user sign in. Until then `src/auth.ts` refuses a sign-in
 * for such an id as the second line it is meant to be.
 *
 * No imports, so `src/auth.ts` and the edge can use it.
 */

const SYSTEM_USER_ID_PREFIX = 'sys_';

/** Whether a user id is a tenant's system user. */
export function isTenantSystemUserId(userId: string | null | undefined): boolean {
    return typeof userId === 'string' && userId.startsWith(SYSTEM_USER_ID_PREFIX);
}
