/**
 * Static analysis guardrails for audit middleware completeness.
 *
 * These tests scan the codebase to verify:
 * 1. The Prisma client module composes the audit extension
 * 2. No code creates a PrismaClient outside `src/lib/prisma.ts`
 * 3. No code writes to the tenancy tables through raw SQL, around the audit
 *
 * Copied from inflect-compliance `tests/unit/audit-trail-guardrails.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e. The populations come from
 * `gitFiles()` (not a directory walk with a skip list), each scan is proved
 * against a planted repository, and the deprecated `logAudit` check is gone
 * with the function (never ported).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

// #2246 Class A — `codeOf` masks comments at the READ SEAM, so this guard can
// no longer be satisfied by a COMMENT naming the thing its assertion is about.
// EVERY read here is wrapped because every path this file reads is a
// TypeScript-alike — re-derived per file, not assumed from the directory — so
// there is no second language needing its own reader. String literals are KEPT.
import { codeOf } from '../helpers/source-blocks';

const SRC_DIR = path.resolve(__dirname, '../../src');

function readFile(relPath: string): string {
    return codeOf(fs.readFileSync(path.resolve(SRC_DIR, relPath), 'utf8'));
}

/** Every git-listed `.ts`/`.tsx` file under `src/` in `root`, root-relative. */
function sourceFiles(root: string): string[] {
    return gitFiles(root).filter((f) => f.startsWith('src/') && /\.tsx?$/.test(f));
}

/** Files that construct a PrismaClient, other than the allowed ones. */
export function prismaClientConstructions(root: string, allowed: readonly string[]): string[] {
    return sourceFiles(root)
        .filter((f) => !allowed.includes(f))
        .filter((f) => codeOf(fs.readFileSync(path.join(root, f), 'utf8')).includes('new PrismaClient('));
}

/**
 * Raw SQL that INSERTs, UPDATEs or DELETEs one of `tables`, outside the
 * allowed files. The pattern is single-line: a statement split across lines
 * after `$executeRaw` is not seen (the 1.5b rotation sweeps must be checked
 * by hand when they land).
 */
export function unauditedRawSql(root: string, tables: readonly string[], allowed: readonly string[]): string[] {
    const violations: string[] = [];
    for (const f of sourceFiles(root)) {
        if (allowed.includes(f)) continue;
        const content = codeOf(fs.readFileSync(path.join(root, f), 'utf8'));
        if (!content.includes('$executeRaw')) continue;
        for (const table of tables) {
            const pattern = new RegExp(`\\$executeRaw.*(?:INSERT|UPDATE|DELETE).*"${table}"`, 'i');
            if (pattern.test(content)) violations.push(`${f} → raw SQL targeting "${table}"`);
        }
    }
    return violations;
}

/** The only file allowed to construct a PrismaClient: the app's own. */
const PRISMA_CLIENT_ALLOWED = ['src/lib/prisma.ts'];

/** The audit writers use raw SQL for their own INSERTs, which are the audit. */
const RAW_SQL_ALLOWED = ['src/lib/prisma.ts'];

/** Islestone's tenancy tables; sub-phase 2.1 adds the work-item tables. */
const DOMAIN_TABLES = [
    'Tenant',
    'User',
    'TenantMembership',
    'OrgMembership',
    'Organization',
    'TenantSecuritySettings',
];

describe('Audit Guardrails — Middleware Registration', () => {
    const prismaModule = readFile('lib/prisma.ts');

    it('prisma.ts wires the audit extension via $extends', () => {
        // Prisma 7 — `$use` was removed; the audit middleware is now
        // a `client.$extends({ query: { $allModels: ... } })`
        // extension. Pin the new wiring so a future PR can't strip
        // it silently.
        expect(prismaModule).toContain('$extends(');
    });

    it('prisma.ts builds the audit extension from buildAuditExtension', () => {
        // Was `registerAuditMiddleware` in Prisma 5; renamed to
        // `buildAuditExtension` (factory returning the extension
        // descriptor) in the Prisma 7 migration.
        expect(prismaModule).toContain('buildAuditExtension');
    });

    it('prisma.ts excludes AuditLog model to prevent recursion', () => {
        expect(prismaModule).toContain("'AuditLog'");
    });

    it('prisma.ts has Edge Runtime guard', () => {
        expect(prismaModule).toContain('EdgeRuntime');
    });

    it('prisma.ts imports getAuditContext for context capture', () => {
        expect(prismaModule).toContain('getAuditContext');
    });

    it('prisma.ts imports redaction utilities', () => {
        expect(prismaModule).toContain('redactSensitiveFields');
    });

    it('prisma.ts captures all 7 write actions', () => {
        const requiredActions = ['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'];
        for (const action of requiredActions) {
            expect(prismaModule).toContain(`'${action}'`);
        }
    });
});

describe('Audit Guardrails — No Raw PrismaClient Without Middleware', () => {
    it('reads its population from git, and it holds src/lib/prisma.ts', () => {
        expect(sourceFiles(REPO_ROOT)).toContain('src/lib/prisma.ts');
    });

    it('no source file creates new PrismaClient() outside lib/prisma.ts', () => {
        expect(prismaClientConstructions(REPO_ROOT, PRISMA_CLIENT_ALLOWED)).toEqual([]);
    });
});

describe('Audit Guardrails — No Unaudited Raw SQL to Domain Tables', () => {
    it('no source file uses $executeRaw to write a tenancy table around the audit', () => {
        expect(unauditedRawSql(REPO_ROOT, DOMAIN_TABLES, RAW_SQL_ALLOWED)).toEqual([]);
    });
});

describe('Audit Guardrails — the scans, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-audit-guardrails-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            '.gitignore': 'src/ignored/\n',
            'src/lib/prisma.ts': 'export const p = new PrismaClient({});\n',
            'src/lib/deep/rogue-client.ts': 'export const c = new PrismaClient({ adapter });\n',
            'src/lib/commented.ts': '// new PrismaClient( in a comment is not a construction\nexport {};\n',
            'src/app-layer/usecases/raw.ts': 'await db.$executeRawUnsafe(`UPDATE "TenantMembership" SET role = $1`, r);\n',
            'src/app-layer/usecases/raw-other.ts': 'await db.$executeRawUnsafe(`UPDATE "AuditOutbox" SET status = $1`, s);\n',
            'src/ignored/rogue.ts': 'export const c = new PrismaClient({});\n',
        };
        for (const [rel, body] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), body);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('reports a PrismaClient built anywhere but the allowed file, at any depth', () => {
        expect(prismaClientConstructions(root, PRISMA_CLIENT_ALLOWED)).toEqual(['src/lib/deep/rogue-client.ts']);
    });

    it('reports raw SQL against a tenancy table, and not against a table outside the list', () => {
        expect(unauditedRawSql(root, DOMAIN_TABLES, RAW_SQL_ALLOWED)).toEqual([
            'src/app-layer/usecases/raw.ts → raw SQL targeting "TenantMembership"',
        ]);
    });
});
