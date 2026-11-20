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
import fs from 'node:fs';
import path from 'node:path';

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
    // ── Search vectors (sub-phase 2.7f) ────────────────────────────────
    'SearchVector.commentId':
        'A pointer to the comment whose vector the row is (a cuid, FK-checked); the vector itself is the classified plaintext derivative SearchVector.lexemes.',
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
    // Sub-phase 2.8a: review codes, each CHECKed to a closed set in the migration.
    'WorkItemReviewRound.endReason':
        'A machine-written code (COMPLETED, RETURNED, ITEM_CLOSED, ITEM_DELETED, WITHDRAWN_BY_PERSON), CHECKed; never free text.',
    'WorkItemReviewStep.skipReason':
        'A machine-written code (PERSON_SKIPPED, NO_REVIEWERS_LEFT), CHECKed; never free text.',
    'WorkItemReviewer.withdrawnReason':
        'A machine-written code (MEMBER_REMOVED, STEP_ENDED, REMOVED_BY_PERSON, BECAME_ASSIGNEE, NOT_ELIGIBLE), CHECKed; never free text.',
    'TenantCustomRole.description':
        'Workspace configuration shown wherever the role is listed, sanitised on write (custom-roles.ts); not business content.',
};

/**
 * Deliberate PLAINTEXT DERIVATIVES of encrypted fields (sub-phase 2.7f, ADR
 * 0008 D1, owner decision 124): columns that hold, readably, what an encrypted
 * field says (a search vector is the text's stemmed words with positions).
 * Kept apart from `NOT_SENSITIVE`, whose columns hold nothing sensitive: these
 * hold something sensitive ON PURPOSE, by an owner decision the entry cites.
 *
 * Every non-`String` native column this scan cannot otherwise read (an
 * `Unsupported("tsvector")`, ADR 0008: "every `Unsupported("tsvector")` column
 * must be listed") on a tenant-scoped model must be here, naming its ADR and
 * its encrypted sources; a new one fails CI until somebody decides it.
 */
const PLAINTEXT_DERIVATIVES: Readonly<Record<string, { adr: string; decision: string; sources: readonly string[] }>> = {
    'SearchVector.lexemes': {
        adr: 'docs/adr/0008-search-over-encrypted-fields.md',
        decision: 'Owner decision 124 (ADR 0008 D1, option C): the stemmed words of descriptions and comments, with positions, are readable in the database, its dumps and its backups, so they can be searched.',
        sources: ['WorkItem.description', 'Comment.body'],
    },
};

/** The native types a plaintext derivative may be declared as. */
const DERIVATIVE_NATIVE_TYPES = /^(tsvector)$/i;

/** Every `Unsupported("tsvector")`-shaped column on a tenant-scoped model. */
function derivativeShapedColumns(): { key: string; nativeType: string }[] {
    const out: { key: string; nativeType: string }[] = [];
    for (const m of parseSchemaModels()) {
        if (!TENANT_SCOPED_MODELS.has(m.name)) continue;
        for (const f of m.fields) {
            if (f.type === 'Unsupported' && f.unsupportedType && DERIVATIVE_NATIVE_TYPES.test(f.unsupportedType)) {
                out.push({ key: `${m.name}.${f.name}`, nativeType: f.unsupportedType });
            }
        }
    }
    return out;
}

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

describe('encryption-manifest coverage — plaintext derivatives of encrypted fields (ADR 0008)', () => {
    const columns = derivativeShapedColumns();

    it('finds the search vector (sanity — the Unsupported scan is live)', () => {
        expect(columns.map((c) => c.key)).toContain('SearchVector.lexemes');
    });

    it('every tsvector column is a classified plaintext derivative', () => {
        const unclassified = columns.filter((c) => PLAINTEXT_DERIVATIVES[c.key] === undefined).map((c) => c.key);
        if (unclassified.length > 0) {
            throw new Error(
                `${unclassified.length} column(s) hold a derivative of text but are not classified:\n` +
                    unclassified.map((k) => `  ${k}`).join('\n') +
                    '\n\nA searchable derivative of an encrypted field is readable in the database and its backups. ' +
                    'It needs an amendment to ADR 0008 and an owner decision, then an entry in PLAINTEXT_DERIVATIVES.',
            );
        }
    });

    it('has no stale PLAINTEXT_DERIVATIVES entries', () => {
        const live = new Set(columns.map((c) => c.key));
        expect(Object.keys(PLAINTEXT_DERIVATIVES).filter((k) => !live.has(k))).toEqual([]);
    });

    it('every entry cites an existing ADR that names the column, and its sources are encrypted fields', () => {
        for (const [key, entry] of Object.entries(PLAINTEXT_DERIVATIVES)) {
            const adr = fs.readFileSync(path.join(__dirname, '../..', entry.adr), 'utf8');
            expect({ key, adrNamesModel: adr.includes(key.split('.')[0]) }).toEqual({ key, adrNamesModel: true });
            expect(entry.decision.trim().length).toBeGreaterThan(20);
            expect(entry.sources.length).toBeGreaterThan(0);
            for (const source of entry.sources) {
                const [model, field] = source.split('.');
                expect({ key, source, encrypted: isEncrypted(model, field) }).toEqual({ key, source, encrypted: true });
            }
        }
    });

    it('a derivative is never also excused as NOT_SENSITIVE', () => {
        expect(Object.keys(PLAINTEXT_DERIVATIVES).filter((k) => NOT_SENSITIVE[k] !== undefined)).toEqual([]);
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

    it('a hypothetical new tsvector column with no classification WOULD fail', () => {
        // The predicate the forward test applies to `Unsupported("tsvector")`.
        const key = 'Comment.bodyVector';
        expect(DERIVATIVE_NATIVE_TYPES.test('tsvector')).toBe(true);
        expect(PLAINTEXT_DERIVATIVES[key]).toBeUndefined();
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
