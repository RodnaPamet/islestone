/**
 * Audit Structured Events — Regression Guards
 *
 * Ensures that:
 * 1. All logEvent call sites include `detailsJson` (no bare free-form events)
 * 2. Audit inserts only go through the audit-writer (no raw INSERT)
 * 3. The verify-audit-chain script exists and is executable
 * 4. Common detailsJson payloads validate against the Zod schema
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * The populations come from `gitFiles()`, and both scans are proved against
 * a planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AuditDetailsSchema } from '../../src/lib/audit/event-schema';
import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

// #2246 Class A — `codeOf` masks comments at the READ SEAM, so this guard can
// no longer be satisfied by a COMMENT naming the thing its assertion is about.
// EVERY read here is wrapped because every path this file reads is a
// TypeScript-alike — re-derived per file, not assumed from the directory — so
// there is no second language needing its own reader. String literals are KEPT.
import { codeOf } from '../helpers/source-blocks';

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');
const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'scripts');

/** Git-listed `.ts` files under `prefix` in `root`, root-relative. */
function filesUnder(root: string, prefix: string): string[] {
    return gitFiles(root).filter((f) => f.startsWith(prefix) && f.endsWith('.ts'));
}

/** `logEvent` call sites in the usecases that carry no `detailsJson`. */
export function logEventsWithoutDetails(root: string): string[] {
    const violations: string[] = [];
    for (const rel of filesUnder(root, 'src/app-layer/usecases/')) {
        const lines = codeOf(fs.readFileSync(path.join(root, rel), 'utf-8')).split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            // Only actual call sites: "await logEvent(" or "logEvent(db".
            const isCallSite = /await\s+logEvent\s*\(/.test(line) || /logEvent\s*\(\s*(?:db|tdb)/.test(line);
            if (!isCallSite || line.includes('detailsJson')) continue;
            // `detailsJson` may sit in the multi-line call body.
            const context = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
            const closingIdx = context.indexOf('});');
            const callSnippet = closingIdx >= 0 ? context.substring(0, closingIdx + 3) : context;
            if (!callSnippet.includes('detailsJson')) violations.push(`${rel}:${i + 1} — logEvent without detailsJson`);
        }
    }
    return violations;
}

/** Files under `src/` that INSERT into AuditLog other than the writer. */
export function rawAuditInserts(root: string): string[] {
    return filesUnder(root, 'src/')
        .filter((rel) => rel !== 'src/lib/audit/audit-writer.ts')
        .filter((rel) => /INSERT\s+INTO\s+["']?AuditLog["']?/i.test(codeOf(fs.readFileSync(path.join(root, rel), 'utf-8'))))
        .map((rel) => `${rel}: contains raw INSERT INTO AuditLog`);
}

describe('Audit Structured Events — Regression Guards', () => {

    // ── Guard 1: All logEvent calls should have detailsJson ──

    test('the usecase population is read from git and is not empty', () => {
        expect(filesUnder(REPO_ROOT, 'src/app-layer/usecases/')).toContain('src/app-layer/usecases/custom-roles.ts');
    });

    test('all logEvent calls in usecases include detailsJson', () => {
        expect(logEventsWithoutDetails(REPO_ROOT)).toEqual([]);
    });

    // ── Guard 2: No raw INSERT into AuditLog outside audit-writer ──

    test('no raw SQL INSERT into AuditLog outside audit-writer.ts', () => {
        expect(rawAuditInserts(REPO_ROOT)).toEqual([]);
    });

    test('both scans report what they must, against a planted repository', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-audit-structured-'));
        try {
            execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
            const plant: Record<string, string> = {
                'src/app-layer/usecases/bare.ts': "await logEvent(db, ctx, {\n    action: 'X',\n    entityType: 'Y',\n    entityId: 'z',\n});\n",
                'src/app-layer/usecases/deep/structured.ts':
                    "await logEvent(db, ctx, {\n    action: 'X',\n    detailsJson: { category: 'custom' },\n});\n",
                'src/lib/rogue.ts': 'await tx.$executeRawUnsafe(`INSERT INTO "AuditLog" (id) VALUES ($1)`, id);\n',
                'src/lib/audit/audit-writer.ts': 'await tx.$executeRawUnsafe(`INSERT INTO "AuditLog" (id) VALUES ($1)`, id);\n',
            };
            for (const [rel, body] of Object.entries(plant)) {
                fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
                fs.writeFileSync(path.join(root, rel), body);
            }
            expect(logEventsWithoutDetails(root)).toEqual(['src/app-layer/usecases/bare.ts:1 — logEvent without detailsJson']);
            expect(rawAuditInserts(root)).toEqual(['src/lib/rogue.ts: contains raw INSERT INTO AuditLog']);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    // ── Guard 3: verify-audit-chain script exists ──

    test('verify-audit-chain.ts script exists', () => {
        const scriptPath = path.join(SCRIPTS_DIR, 'verify-audit-chain.ts');
        expect(fs.existsSync(scriptPath)).toBe(true);

        const content = codeOf(fs.readFileSync(scriptPath, 'utf-8'));
        expect(content).toContain('verifyTenantChain');
        expect(content).toContain('verifyAllTenants');
        expect(content).toContain('--tenant');
        expect(content).toContain('--json');
    });

    // ── Guard 4: verify.ts reusable module exists ──

    test('verify.ts reusable module exists with correct exports', () => {
        const verifyPath = path.resolve(SRC_DIR, 'lib', 'audit', 'verify.ts');
        expect(fs.existsSync(verifyPath)).toBe(true);

        const content = codeOf(fs.readFileSync(verifyPath, 'utf-8'));
        expect(content).toContain('export async function verifyTenantChain');
        expect(content).toContain('export async function verifyAllTenants');
        expect(content).toContain('BreakType');
        expect(content).toContain('VerificationReport');
    });

    // ── Guard 5: Core event payloads validate against Zod schema ──

    describe('detailsJson schema validation', () => {
        test('entity_lifecycle payload validates', () => {
            const payload = {
                category: 'entity_lifecycle',
                entityName: 'TenantCustomRole',
                operation: 'created',
                after: { name: 'Reviewer' },
                summary: 'Created custom role',
            };
            const result = AuditDetailsSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });

        test('status_change payload validates', () => {
            const payload = {
                category: 'status_change',
                entityName: 'TenantInvite',
                fromStatus: 'DRAFT',
                toStatus: 'IN_REVIEW',
                reason: 'Approval requested',
            };
            const result = AuditDetailsSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });

        test('access payload validates', () => {
            const payload = {
                category: 'access',
                operation: 'login',
                detail: 'MFA challenge passed',
            };
            const result = AuditDetailsSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });

        test('data_lifecycle payload validates', () => {
            const payload = {
                category: 'data_lifecycle',
                operation: 'purged',
                model: 'Tenant',
                reason: 'Retention expired',
            };
            const result = AuditDetailsSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });

        test('custom payload validates', () => {
            const payload = {
                category: 'custom',
                event: 'due_planning_executed',
                checked: 10,
                created: 3,
            };
            const result = AuditDetailsSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });

        test('invalid category is rejected', () => {
            const payload = {
                category: 'unknown_category',
                entityName: 'Something',
            };
            const result = AuditDetailsSchema.safeParse(payload);
            expect(result.success).toBe(false);
        });

        test('missing required fields rejected', () => {
            const payload = {
                category: 'entity_lifecycle',
                // missing entityName and operation
            };
            const result = AuditDetailsSchema.safeParse(payload);
            expect(result.success).toBe(false);
        });
    });
});
