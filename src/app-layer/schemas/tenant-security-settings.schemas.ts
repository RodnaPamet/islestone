import { z } from 'zod';

/**
 * Tenant security-settings patch.
 *
 * Rewritten from inflect-compliance
 * `src/app-layer/schemas/tenant-security-settings.schemas.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e with the same prune as the
 * usecase: sub-phase 1.5 adds the audit-stream fields, 5.2 the API-key
 * rotation age.
 *
 * PATCH-SHAPED BY CONSTRUCTION. Every key is `.optional()`, and the nullable
 * ones accept an explicit `null` to CLEAR. `undefined` (key absent) means
 * "leave alone", `null` means "unset". The usecase writes only keys that are
 * present, which is what keeps this writer from clobbering
 * `updateTenantMfaPolicy`, the other writer on the same row.
 *
 * `.strict()` so a typo in a field name is a 400 rather than a silently
 * ignored setting — a settings form that appears to save but does not is worse
 * than one that errors.
 *
 * `mfaPolicy` and `sessionMaxAgeMinutes` are deliberately ABSENT: they are
 * owned by `UpdateMfaPolicyInput` on the MFA policy route. Accepting them here
 * too would give one field two owners.
 */
export const UpdateTenantSecuritySettingsInput = z
    .object({
        /** Null = unlimited (the legacy behaviour the column documents). */
        maxConcurrentSessions: z.number().int().min(1).max(100).nullable().optional(),

        /** When true, an MFA verification failure denies rather than degrades. */
        mfaFailClosed: z.boolean().optional(),
    })
    .strict();

export type UpdateTenantSecuritySettingsInput = z.infer<typeof UpdateTenantSecuritySettingsInput>;
