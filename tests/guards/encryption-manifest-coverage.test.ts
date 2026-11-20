/**
 * Encryption-manifest coverage ratchet — makes field-level encryption
 * OPT-OUT-WITH-JUSTIFICATION instead of opt-in-by-memory.
 *
 * ## The gap this closes
 *
 * `src/lib/security/encrypted-fields.ts` (`ENCRYPTED_FIELDS`) is a
 * hand-maintained manifest: a column is encrypted at rest ONLY if a
 * human remembered to list it there. Nothing stopped a new sensitive
 * column — `Finding.investigationNotes`, say — from shipping in
 * plaintext simply because the author didn't know the manifest existed.
 * The architecture review flagged this as the last opt-in-safety gap.
 *
 * ## The invariant
 *
 * For every `String` / `String?` column on a **tenant-scoped** model
 * (`TENANT_SCOPED_MODELS`) whose NAME looks sensitive (matches
 * `SENSITIVITY_HEURISTIC` — note / comment / description / summary /
 * content / reason / answer / body / detail / finding / remediation /
 * treatment), that column MUST be one of:
 *
 *   (a) listed in `ENCRYPTED_FIELDS` — encrypted at rest; OR
 *   (b) listed in `NOT_SENSITIVE` below with a one-line written reason
 *       for why it ships plaintext.
 *
 * A brand-new sensitive-shaped column that is neither fails CI. The
 * author must then make a CONSCIOUS choice — encrypt it (add to the
 * manifest) or justify the plaintext (add to `NOT_SENSITIVE`) — rather
 * than silently shipping plaintext.
 *
 * ## Scope + limits (deliberate)
 *
 *   - NAME heuristic, not content analysis: a column called `status`
 *     that happens to hold a paragraph is invisible here, and a column
 *     called `description` that holds an enum is a false positive that
 *     `NOT_SENSITIVE` absorbs. The heuristic is tuned to the free-text
 *     columns this product actually ships; widen it as new shapes
 *     appear.
 *   - `String` scalars only. JSON/`Json` blobs (`payloadJson`,
 *     `contextJson`) are encrypted where needed but are not name-shaped
 *     for this scan; they are covered by the manifest + the write-path
 *     sanitisation guards, not here.
 *   - Tenant-scoped only. Global library tables (Framework, Clause,
 *     templates) carry no per-tenant content and are out of scope, the
 *     same carve-out `ENCRYPTED_FIELDS` documents.
 *
 * ## Ratchet policy
 *
 *   - `NOT_SENSITIVE` only shrinks in spirit: when a listed column is
 *     encrypted (moved into `ENCRYPTED_FIELDS`) or deleted, its
 *     `NOT_SENSITIVE` entry becomes stale and the no-stale test forces
 *     its removal in the same PR.
 *   - Seeded from the current schema so this lands GREEN with zero
 *     behaviour change; it bites only on NEW unclassified columns.
 */
import { parseSchemaModels } from '../helpers/prisma-schema-models';
import { TENANT_SCOPED_MODELS } from '@/lib/db/rls-middleware';
import { ENCRYPTED_FIELDS } from '@/lib/security/encrypted-fields';

// A column name that *looks* like it holds free-text business content.
// Kept in sync (by intent) with the columns this product ships; widen
// as new sensitive shapes appear.
const SENSITIVITY_HEURISTIC =
    /note|comment|description|summary|content|reason|answer|body|detail|finding|remediation|treatment/i;

/**
 * Curated opt-out list: sensitive-SHAPED `String` columns on
 * tenant-scoped models that ship PLAINTEXT, each with a one-line reason.
 * Key is `Model.field`. Adding an entry is a conscious decision that a
 * reviewer can see; the no-stale test deletes it the moment the column
 * is encrypted or removed.
 */
const NOT_SENSITIVE: Readonly<Record<string, string>> = {
    // ── Recipient lists (sub-phase 2.7e) ───────────────────────────────
    'RecipientList.description':
        'Workspace configuration (what a named set of people is for), shown wherever the list is offered, sanitised on write (recipient-list.ts); like a custom role\'s description, not business content.',
    // ── Mentions (sub-phase 2.7d) ──────────────────────────────────────
    'Mention.commentId':
        'A pointer to the comment that mentions the person (a cuid, FK-checked); the comment\'s text is Comment.body, encrypted.',
    // ── The marked answer (sub-phase 2.4b-c) ──────────────────────────
    'WorkItem.answerCommentId':
        'A pointer to one of the item\'s own comments (a cuid, FK-checked); the comment\'s text is Comment.body, encrypted.',
    // ── The notification outbox (sub-phase 1.6) ───────────────────────
    'NotificationOutbox.bodyText':
        'Rendered email body from a template over a work item title and a name; the recipient is the PII column, encrypted by the PII extension. Purged by the retention job (8.3).',
    'NotificationOutbox.bodyHtml':
        'Rendered HTML email body, the same content as bodyText; purged by the retention job (8.3).',
    'Notification.body':
        'Bell text built from a template at emit time (a work item title and an actor name), shown only to its recipient.',
    // ── Append-only audit trail — encrypting breaks hash-chain
    //    integrity; investigation needs plaintext (encrypted-fields.ts). ─
    'AuditLog.details':
        'Append-only hash-chained audit trail — encrypting breaks entryHash integrity (encrypted-fields.ts header).',
    'UserSession.revokedReason':
        'A machine-written code (`user:password-reset`, `policy:concurrent-limit`, …), never free text.',
    'TenantCustomRole.description':
        'Workspace configuration shown wherever the role is listed, sanitised on write (custom-roles.ts); not business content.',
};

/** `Model.field` → true if the field is in the encryption manifest. */
function isEncrypted(model: string, field: string): boolean {
    const list = (ENCRYPTED_FIELDS as Record<string, readonly string[]>)[model];
    return list !== undefined && list.includes(field);
}

/**
 * Every sensitive-SHAPED `String` column on a tenant-scoped model:
 * `{ key: 'Model.field', model, field }`.
 */
function sensitiveShapedColumns(): { key: string; model: string; field: string }[] {
    const out: { key: string; model: string; field: string }[] = [];
    for (const m of parseSchemaModels()) {
        if (!TENANT_SCOPED_MODELS.has(m.name)) continue;
        for (const f of m.fields) {
            // Non-list String scalars only (`String` / `String?`).
            if (f.type !== 'String' || f.isList) continue;
            if (!SENSITIVITY_HEURISTIC.test(f.name)) continue;
            out.push({ key: `${m.name}.${f.name}`, model: m.name, field: f.name });
        }
    }
    return out;
}

describe('encryption-manifest coverage — no sensitive column ships plaintext by accident', () => {
    const columns = sensitiveShapedColumns();

    it('finds sensitive-shaped columns to police (sanity — the scan is live)', () => {
        // If this drops to 0 the scan or the schema parser silently broke;
        // the whole ratchet would be a no-op. Islestone's schema is young,
        // so the floor is the columns known to exist, not a count; the
        // planted-column self-test below proves the detector itself.
        expect(columns.map((c) => c.key)).toEqual(
            expect.arrayContaining(['AuditLog.details', 'TenantCustomRole.description']),
        );
    });

    it('every sensitive-shaped column is encrypted OR justified in NOT_SENSITIVE', () => {
        const offenders = columns.filter(
            (c) => !isEncrypted(c.model, c.field) && NOT_SENSITIVE[c.key] === undefined,
        );
        if (offenders.length > 0) {
            throw new Error(
                `${offenders.length} tenant-scoped column(s) look sensitive but are neither ` +
                    `encrypted nor justified:\n` +
                    offenders.map((c) => `  ${c.key}`).join('\n') +
                    `\n\nField-level encryption is opt-OUT here. Choose one:\n` +
                    `  • Encrypt it: add "${'<field>'}" to the model's list in ` +
                    `src/lib/security/encrypted-fields.ts (follow the "Adding a new field" ` +
                    `checklist there — repository search + backfill).\n` +
                    `  • Justify plaintext: add '<Model>.<field>': '<one-line reason>' to ` +
                    `NOT_SENSITIVE in this file.\n\n` +
                    `Silently shipping a sensitive column in plaintext is exactly what this ` +
                    `guard exists to prevent.`,
            );
        }
    });

    it('has no NOT_SENSITIVE entries that are already encrypted (contradiction guard)', () => {
        const contradictory = Object.keys(NOT_SENSITIVE).filter((key) => {
            const [model, field] = key.split('.');
            return isEncrypted(model, field);
        });
        expect(contradictory).toEqual([]);
    });

    it('has no stale NOT_SENSITIVE entries (every entry is still a live plaintext sensitive column)', () => {
        const live = new Set(columns.map((c) => c.key));
        const stale = Object.keys(NOT_SENSITIVE)
            .filter((key) => !live.has(key))
            .sort();
        if (stale.length > 0) {
            throw new Error(
                `${stale.length} NOT_SENSITIVE entr(y/ies) are stale — the column was ` +
                    `encrypted, renamed, or deleted:\n` +
                    stale.map((k) => `  ${k}`).join('\n') +
                    `\n\nRemove them from NOT_SENSITIVE in this PR. The list only ` +
                    `moves down — a justified-plaintext exception must be deleted once ` +
                    `it is paid off.`,
            );
        }
    });

    it('every NOT_SENSITIVE reason is a non-trivial written sentence', () => {
        const tooShort = Object.entries(NOT_SENSITIVE)
            .filter(([, reason]) => reason.trim().length < 12)
            .map(([key]) => key);
        expect(tooShort).toEqual([]);
    });
});

// ─── Self-test: prove the heuristic + wiring actually fire ──────────
//
// Without this, a refactor that broke SENSITIVITY_HEURISTIC or the
// schema parse would make the forward test vacuously pass and let a
// plaintext-sensitive column slip through.
describe('encryption-manifest guard — detector self-test', () => {
    it('the heuristic matches the shapes the guard is meant to catch', () => {
        for (const name of [
            'investigationNotes', // the acceptance-criteria example
            'rootCauseSummary',
            'reviewerComment',
            'incidentDetail',
            'remediationPlan',
        ]) {
            expect(SENSITIVITY_HEURISTIC.test(name)).toBe(true);
        }
    });

    it('the heuristic ignores clearly non-content column names', () => {
        for (const name of ['status', 'tenantId', 'createdAt', 'score', 'slug', 'email']) {
            expect(SENSITIVITY_HEURISTIC.test(name)).toBe(false);
        }
    });

    it('a hypothetical new sensitive column with no classification WOULD fail', () => {
        // Simulate adding `Finding.investigationNotes`: sensitive-shaped,
        // not in ENCRYPTED_FIELDS, not in NOT_SENSITIVE. The forward
        // test's exact predicate must flag it.
        const model = 'Finding';
        const field = 'investigationNotes';
        const key = `${model}.${field}`;
        expect(SENSITIVITY_HEURISTIC.test(field)).toBe(true);
        expect(isEncrypted(model, field)).toBe(false);
        expect(NOT_SENSITIVE[key]).toBeUndefined();
        // => (not encrypted) && (not justified) === would-be offender.
        expect(!isEncrypted(model, field) && NOT_SENSITIVE[key] === undefined).toBe(true);
    });
});
