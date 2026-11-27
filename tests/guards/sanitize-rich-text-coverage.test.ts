/**
 * Guardrail: Epic C.5 / D.2 — rich-text sanitiser coverage (structural).
 *
 * ─── Why this is structural, not a numeric floor ────────────────────
 *
 * The previous incarnation kept a hand-curated list of usecases plus
 * `SANITISER_COVERAGE_FLOOR = 8` — a MINIMUM. That was a weak signal:
 * the floor went green while the real coverage drifted to 15 sanitised
 * usecases, and — worse — a *new* rich-text write path could land with
 * no sanitiser and the floor-of-8 would never notice (the eight known
 * entries were all still present). "At least N" cannot prove
 * completeness.
 *
 * This version derives the rich-text inventory from an authoritative,
 * already-maintained registry: `ENCRYPTED_FIELDS` in
 * `src/lib/security/encrypted-fields.ts`. Epic B REQUIRES every
 * business-content text field to be listed there (it drives
 * encrypt-on-write / decrypt-on-read). So:
 *
 *   - every encrypted business-content model IS a rich-text surface;
 *   - this guardrail asserts every such model is CLASSIFIED — either
 *     `RICH_TEXT_COVERAGE` (a usecase sanitises it),
 *     `NON_RICH_TEXT_MODELS` (the encrypted value is not user-supplied
 *     rich text — e.g. a generated secret), or `KNOWN_UNCOVERED`
 *     (a real, named gap, ratcheting to zero);
 *   - a NEW encrypted model — which a new rich-text field forces into
 *     `ENCRYPTED_FIELDS` — that is in NONE of the three buckets fails
 *     this test. That is the completeness guarantee the floor lacked.
 *
 * Server-side sanitisation must run BEFORE the row is persisted:
 * render-time sanitisation alone leaves the row dangerous to PDF
 * export, audit-pack share links, and SDK consumers reading it
 * verbatim.
 */

import * as fs from 'fs';
import * as path from 'path';

import { codeOf } from '../helpers/source-blocks';

import { ENCRYPTED_FIELDS } from '@/lib/security/encrypted-fields';

const REPO_ROOT = path.resolve(__dirname, '../..');

type Sanitizer = 'sanitizeRichTextHtml' | 'sanitizePlainText' | 'sanitizePolicyContent';

/**
 * Encrypted-content model → the usecase file(s) that route its
 * user-supplied free text through a sanitiser before the repository
 * write, and the sanitiser they are expected to use.
 *
 * Keyed by Prisma model name (matching `ENCRYPTED_FIELDS`). When a new
 * encrypted business-content model lands, add it here (or to one of
 * the two exclusion maps below) — the completeness test fails until
 * every `ENCRYPTED_FIELDS` model is classified.
 */
const RICH_TEXT_COVERAGE: Readonly<
    Record<string, { usecases: readonly string[]; sanitizer: Sanitizer }>
> = {
    // Sub-phase 2.2: the work-item description and the comment body.
    WorkItem: { usecases: ['src/app-layer/usecases/work-item.ts'], sanitizer: 'sanitizePlainText' },
    Comment: { usecases: ['src/app-layer/usecases/work-item-collab.ts'], sanitizer: 'sanitizePlainText' },
    // Sub-phase 2.5c: an item template's description, and a project
    // template's content, sanitised field by field before it is serialised.
    WorkItemTemplate: { usecases: ['src/app-layer/usecases/work-item-template.ts'], sanitizer: 'sanitizePlainText' },
    ProjectTemplate: { usecases: ['src/app-layer/usecases/project-template.ts'], sanitizer: 'sanitizePlainText' },
    // Sub-phase 2.6a: a request's text, its answers and both notes.
    IntakeRequest: { usecases: ['src/app-layer/usecases/intake-request.ts'], sanitizer: 'sanitizePlainText' },
    Goal: { usecases: ['src/app-layer/usecases/goal.ts'], sanitizer: 'sanitizePlainText' },
    Initiative: { usecases: ['src/app-layer/usecases/initiative.ts'], sanitizer: 'sanitizePlainText' },
    // Sub-phase 2.6c: a follow-up email's text (and an emailed request's),
    // sanitised before it is stored by intake-email's writers through
    // intake-request's `cleanText`, the one sanitising call both share. (Until
    // H2f intake-email also called the sanitiser itself, for the sender's name;
    // that is `cleanRequesterName` in src/lib/intake/requester-name.ts now.)
    IntakeFollowUp: { usecases: ['src/app-layer/usecases/intake-request.ts'], sanitizer: 'sanitizePlainText' },
    // Sub-phase 2.8a: a reviewer's response text (decision 157).
    WorkItemReviewer: { usecases: ['src/app-layer/usecases/review.ts'], sanitizer: 'sanitizePlainText' },
    // Sub-phase 3.4b: a time entry's description, written only by its person (decision 267).
    TimeEntry: { usecases: ['src/app-layer/usecases/time-entry.ts'], sanitizer: 'sanitizePlainText' },
    // Sub-phase 3.4c: why a week was returned or reopened (decision 270).
    Timesheet: { usecases: ['src/app-layer/usecases/timesheet.ts'], sanitizer: 'sanitizePlainText' },
};

/**
 * Encrypted models whose encrypted field is NOT user-supplied rich
 * text — sanitisation does not apply. Each carries a written reason.
 */
const NON_RICH_TEXT_MODELS: Readonly<Record<string, string>> = {
    TenantSecuritySettings:
        'auditStreamSecretEncrypted is the audit stream\'s HMAC secret: never rendered, never markup.',
    CalendarConnection:
        'tokenEncrypted is a calendar provider\'s OAuth token pair (3.3b, decision 238): a secret from the provider, never rendered, never markup.',
    TimeOff:
        'type is a closed code (VACATION, SICK or OTHER; decisions 287 and 303), accepted only through TimeOffTypeSchema and padded by TimeOffRepository: never free text, never markup.',
};

/**
 * Real, named coverage gaps — encrypted business-content models whose
 * write path is not yet proven to sanitise. This is a RATCHET: it must
 * trend to zero. Each entry carries a written reason + a ratchet
 * target. A new entry here is a deliberate, reviewed admission — not a
 * place to silently park new rich-text surfaces.
 */
const KNOWN_UNCOVERED: Readonly<Record<string, string>> = {
    // EMPTY, and the cap below keeps it so: a new encrypted free-text field
    // is sanitised or classified, never parked here.
};

const fileExists = (rel: string) => fs.existsSync(path.join(REPO_ROOT, rel));
// codeOf() masks comments at the READ SEAM (#2246): the import/call assertions
// below are about CODE — a comment naming `sanitizePlainText(` must not stand
// in for the call. String literals are preserved (the import path is one).
const readFile = (rel: string) => codeOf(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));

describe('rich-text sanitiser coverage — structural completeness', () => {
    it('every encrypted-content model is classified (the completeness guarantee)', () => {
        // A new rich-text field forces its model into ENCRYPTED_FIELDS
        // (Epic B requirement). If that model is in none of the three
        // buckets, it is an unclassified rich-text surface — fail.
        const classified = new Set([
            ...Object.keys(RICH_TEXT_COVERAGE),
            ...Object.keys(NON_RICH_TEXT_MODELS),
            ...Object.keys(KNOWN_UNCOVERED),
        ]);
        const unclassified = Object.keys(ENCRYPTED_FIELDS).filter(
            (m) => !classified.has(m),
        );
        if (unclassified.length > 0) {
            throw new Error(
                [
                    `Encrypted business-content model(s) not classified for`,
                    `rich-text sanitiser coverage:`,
                    ...unclassified.map((m) => `  - ${m}`),
                    ``,
                    `Each ENCRYPTED_FIELDS model is a rich-text surface. Add`,
                    `it to RICH_TEXT_COVERAGE (with the sanitising usecase),`,
                    `NON_RICH_TEXT_MODELS (if the value is not user rich`,
                    `text), or KNOWN_UNCOVERED (a real gap, with a reason).`,
                ].join('\n'),
            );
        }
    });

    it('detects an unclassified new encrypted model (regression proof)', () => {
        // Simulate a new rich-text field landing on a new model — Epic B
        // forces it into ENCRYPTED_FIELDS. With no classification entry
        // it must be flagged: this is the bypass the old numeric floor
        // could not catch.
        const classified = new Set([
            ...Object.keys(RICH_TEXT_COVERAGE),
            ...Object.keys(NON_RICH_TEXT_MODELS),
            ...Object.keys(KNOWN_UNCOVERED),
        ]);
        const withNewModel = { ...ENCRYPTED_FIELDS, NewlyAddedRichTextModel: ['body'] };
        const unclassified = Object.keys(withNewModel).filter(
            (m) => !classified.has(m),
        );
        expect(unclassified).toEqual(['NewlyAddedRichTextModel']);
    });

    it('no classification entry references a model absent from ENCRYPTED_FIELDS (no stale)', () => {
        const stale = [
            ...Object.keys(RICH_TEXT_COVERAGE),
            ...Object.keys(NON_RICH_TEXT_MODELS),
            ...Object.keys(KNOWN_UNCOVERED),
        ].filter((m) => !(m in ENCRYPTED_FIELDS));
        expect(stale).toEqual([]);
    });

    it('NON_RICH_TEXT_MODELS + KNOWN_UNCOVERED each carry a written reason', () => {
        for (const reason of [
            ...Object.values(NON_RICH_TEXT_MODELS),
            ...Object.values(KNOWN_UNCOVERED),
        ]) {
            expect(reason.trim().length).toBeGreaterThan(20);
        }
    });

    it('KNOWN_UNCOVERED is a ratchet — it is now at zero', () => {
        // Reached zero. Re-admitting an entry here means raising this cap in
        // the same diff, which is the conversation the ratchet exists to force.
        expect(Object.keys(KNOWN_UNCOVERED).length).toBeLessThanOrEqual(0);
    });

    const coverageEntries = Object.entries(RICH_TEXT_COVERAGE).flatMap(
        ([model, { usecases, sanitizer }]) =>
            usecases.map((u) => [model, u, sanitizer] as const),
    );

    it('has a population to check, or says why it has none', () => {
        // The population is the two bodies sub-phase 2.2 encrypts and the
        // two template columns of 2.5c and the intake request of 2.6a; another
        // encrypted free-text model must be classified before it lands.
        expect(coverageEntries.map(([model]) => model).sort()).toEqual(['Comment', 'Goal', 'Initiative', 'IntakeFollowUp', 'IntakeRequest', 'ProjectTemplate', 'TimeEntry', 'Timesheet', 'WorkItem', 'WorkItemReviewer', 'WorkItemTemplate']);
        expect(Object.keys(NON_RICH_TEXT_MODELS)).toEqual(['TenantSecuritySettings', 'CalendarConnection', 'TimeOff']);
    });

    it.each(coverageEntries.length > 0 ? coverageEntries : [['(none)', '(none)', 'sanitizePlainText'] as const])(
        '%s — %s imports AND calls %s',
        (model, relPath, sanitizer) => {
            if (model === '(none)') return;
            if (!fileExists(relPath)) {
                throw new Error(
                    `RICH_TEXT_COVERAGE[${model}] references a missing file: ` +
                        `${relPath}. If the usecase moved, update the path.`,
                );
            }
            const src = readFile(relPath);
            const importRe = new RegExp(
                String.raw`import\s+\{[^}]*\b${sanitizer}\b[^}]*\}\s+from\s+['"]@/lib/security/sanitize['"]`,
            );
            if (!importRe.test(src)) {
                throw new Error(
                    `${relPath} (rich-text writer for ${model}) does not ` +
                        `import { ${sanitizer} } from '@/lib/security/sanitize'. ` +
                        `Server-side sanitisation must run before the repository ` +
                        `write.`,
                );
            }
            const withoutImport = src.replace(src.match(importRe)?.[0] ?? '', '');
            if (!new RegExp(String.raw`\b${sanitizer}\s*\(`).test(withoutImport)) {
                throw new Error(
                    `${relPath} imports ${sanitizer} but never calls it — ` +
                        `a dangling import is a silent bypass for ${model}.`,
                );
            }
        },
    );
});
