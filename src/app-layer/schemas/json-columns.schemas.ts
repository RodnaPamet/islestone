/**
 * Centralized Zod Schemas for JSON Column Validation
 *
 * These schemas enforce type-safe write-time validation for the JSON columns
 * persisted to the database. Sub-phase 1.5 holds the audit log's two; later
 * sub-phases add their own (integration config with 5.x, onboarding with 8.2). They are used at usecase/service boundaries
 * before data reaches Prisma.
 *
 * Design decisions:
 * ─────────────────
 * - Schemas are permissive-by-default with `.passthrough()` to avoid rejecting
 *   existing stored data that may have extra fields. New writes are validated;
 *   existing reads are not retroactively broken.
 * - Each schema is exported both as a Zod type and as a TypeScript type.
 * - Validation helpers (`validateXxx`) return the parsed value or throw
 *   a typed ValidationError (400) with structured Zod details.
 *
 * @module app-layer/schemas/json-columns.schemas
 */
import { z } from 'zod';
import { badRequest } from '@/lib/errors/types';

// ─── Audit Log: detailsJson ──────────────────────────────────────────
// The structured event payload for machine-readable audit entries.
// Every audit event must have a `category` discriminator.

export const AuditDetailsJsonSchema = z.object({
    /** Event category — required discriminator */
    category: z.enum([
        'entity_lifecycle',
        'data_lifecycle',
        'status_change',
        'relationship',
        'access',
        'custom',
    ]),
    /** Entity name for lifecycle events */
    entityName: z.string().optional(),
    /** CRUD operation */
    operation: z.string().optional(),
    /** Changed field names (for updates) */
    changedFields: z.array(z.string()).optional(),
    /** State before the change */
    before: z.record(z.string(), z.unknown()).optional(),
    /** State after the change */
    after: z.record(z.string(), z.unknown()).optional(),
    /** Human-readable summary */
    summary: z.string().optional(),
    /** Status change: from */
    fromStatus: z.string().nullable().optional(),
    /** Status change: to */
    toStatus: z.string().nullable().optional(),
    /** Status change: reason */
    reason: z.string().optional(),
    /** Relationship: source entity type */
    sourceEntity: z.string().optional(),
    /** Relationship: source entity ID */
    sourceId: z.string().optional(),
    /** Relationship: target entity type */
    targetEntity: z.string().optional(),
    /** Relationship: target entity ID */
    targetId: z.string().optional(),
    /** Relationship type/label */
    relation: z.string().optional(),
    /** Custom event discriminator */
    event: z.string().optional(),
    /** Free-form detail string */
    detail: z.string().optional(),
    /** Target user affected by access change */
    targetUserId: z.string().optional(),
}).passthrough();

export type AuditDetailsJson = z.infer<typeof AuditDetailsJsonSchema>;

// ─── Audit Log: metadataJson ─────────────────────────────────────────
// Free-form but must be a plain object (no arrays, no primitives at root).

export const MetadataJsonSchema = z.record(z.string(), z.unknown());

export type MetadataJson = z.infer<typeof MetadataJsonSchema>;

// ─── Validation Helpers ──────────────────────────────────────────────
// These throw typed ValidationError (400) on invalid input.

/**
 * Validate and return audit detailsJson, or throw 400.
 * Accepts undefined/null and returns undefined to support optional fields.
 */
export function validateAuditDetailsJson(input: unknown): AuditDetailsJson | undefined {
    if (input === undefined || input === null) return undefined;
    const result = AuditDetailsJsonSchema.safeParse(input);
    if (!result.success) {
        throw badRequest('Invalid detailsJson structure', result.error.issues);
    }
    return result.data;
}
