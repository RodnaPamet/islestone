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
 * with the function (never ported). Sub-phase 1.5b made the raw-SQL scan read
 * each `$executeRaw` statement whole (the source's single-line pattern missed
 * a statement split across lines) and flag a statement whose table is
 * interpolated, which no table list can see; the two rotation sweeps are the
 * named exceptions, each with its reason.
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
 * Every `$executeRaw` / `$executeRawUnsafe` statement in `content`, whole: the
 * balanced argument list of a call, or the template of a tagged call. Reading
 * the statement rather than the line is what catches SQL split across lines
 * (`$executeRawUnsafe(\n  \`UPDATE "Tenant" …\`)`), which the source's
 * single-line pattern never saw. A statement built in a variable first and
 * passed by name is not followed; none exists, and a write that wants to hide
 * from this scan can always do so, so the scan is for honest mistakes.
 */
export function rawWriteStatements(content: string): string[] {
    const out: string[] = [];
    const call = /\$executeRaw(?:Unsafe)?\s*([(`])/g;
    let m: RegExpExecArray | null;
    while ((m = call.exec(content)) !== null) {
        const open = m.index + m[0].length - 1;
        if (m[1] === '`') {
            const close = content.indexOf('`', open + 1);
            out.push(content.slice(open, close < 0 ? content.length : close + 1));
            continue;
        }
        let depth = 0;
        let end = content.length;
        for (let i = open; i < content.length; i++) {
            const ch = content[i];
            if (ch === '(') depth++;
            else if (ch === ')' && --depth === 0) {
                end = i + 1;
                break;
            }
        }
        out.push(content.slice(open, end));
    }
    return out;
}

const WRITE_VERB = /\b(?:INSERT|UPDATE|DELETE)\b/i;
/** A write whose target table is interpolated: `UPDATE "${model}"`, `INTO "${t}"`. */
const DYNAMIC_TARGET = /\b(?:UPDATE|INTO|FROM)\s+"?\$\{/i;

/**
 * Raw SQL that INSERTs, UPDATEs or DELETEs one of `tables`, or writes to a
 * table it names only through interpolation, outside the allowed files. A
 * dynamic target can be any table, a tenancy table included, so it is refused
 * unless its file is in `dynamicAllowed` with a reason.
 */
export function unauditedRawSql(
    root: string,
    tables: readonly string[],
    allowed: readonly string[],
    dynamicAllowed: Readonly<Record<string, string>> = {},
): string[] {
    const violations: string[] = [];
    for (const f of sourceFiles(root)) {
        if (allowed.includes(f)) continue;
        const content = codeOf(fs.readFileSync(path.join(root, f), 'utf8'));
        if (!content.includes('$executeRaw')) continue;
        const writes = rawWriteStatements(content).filter((s) => WRITE_VERB.test(s));
        for (const table of tables) {
            if (writes.some((s) => s.includes(`"${table}"`))) {
                violations.push(`${f} → raw SQL targeting "${table}"`);
            }
        }
        if (!(f in dynamicAllowed) && writes.some((s) => DYNAMIC_TARGET.test(s))) {
            violations.push(`${f} → raw SQL writing an interpolated table`);
        }
    }
    return violations;
}

/** The only file allowed to construct a PrismaClient: the app's own. */
const PRISMA_CLIENT_ALLOWED = ['src/lib/prisma.ts'];

/**
 * Files allowed a raw write to a tenancy table, each with its reason.
 * Sub-phase 1.5b's statement-wide scan found the second; the single-line
 * pattern before it could not see a tagged template that starts on the next
 * line.
 */
const RAW_SQL_ALLOWED_REASONS: Readonly<Record<string, string>> = {
    'src/lib/prisma.ts': 'the audit extension writes the audit itself',
    'src/app-layer/context-system.ts':
        "creates the workspace's system user (sys_<tenantId>) once, idempotently: raw so the PII " +
        'extension cannot derive its emailHash, and an act of nobody, so nothing to attribute',
};
const RAW_SQL_ALLOWED = Object.keys(RAW_SQL_ALLOWED_REASONS);

/**
 * Files allowed a raw write to an interpolated table, each with its reason.
 * A rotation sweep rewrites one encrypted column at a time across every
 * manifest model, so its table is a variable by construction. Neither is a
 * change a reader of the trail needs per row: the value is re-encrypted, never
 * changed, and each run writes its own STARTED and COMPLETED audit entries
 * with the counts. Each UPDATE is also conditional on the ciphertext it read,
 * so it cannot overwrite a user's newer value.
 */
const DYNAMIC_RAW_SQL_ALLOWED: Readonly<Record<string, string>> = {
    'src/app-layer/jobs/key-rotation.ts':
        'master-key rotation: re-encrypts v1 ciphertext in place (KEY_ROTATION_STARTED/COMPLETED)',
    'src/app-layer/jobs/tenant-dek-rotation.ts':
        'workspace DEK rotation: re-encrypts v2 ciphertext in place (TENANT_DEK_ROTATION_STARTED/COMPLETED)',
};

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
        expect(unauditedRawSql(REPO_ROOT, DOMAIN_TABLES, RAW_SQL_ALLOWED, DYNAMIC_RAW_SQL_ALLOWED)).toEqual([]);
    });

    it('every interpolated-table exception still names a file that writes one', () => {
        // A stale entry would quietly admit whatever file next takes the path.
        for (const f of Object.keys(DYNAMIC_RAW_SQL_ALLOWED)) {
            const content = codeOf(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'));
            const dynamicWrites = rawWriteStatements(content).filter(
                (s) => WRITE_VERB.test(s) && DYNAMIC_TARGET.test(s),
            );
            expect({ f, dynamicWrites: dynamicWrites.length > 0 }).toEqual({ f, dynamicWrites: true });
        }
    });
});

/**
 * The `$` of a planted `${…}`, kept out of this file's own text: the
 * audit-immutability guard refuses a file that holds a raw write to an
 * interpolated table beside the string 'AuditLog', and this file names both.
 */
const INTERP = '$';

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
            'src/app-layer/usecases/raw-multiline.ts':
                'await db.$executeRawUnsafe(\n    `UPDATE "TenantSecuritySettings"\n     SET "mfaPolicy" = $1`,\n    p,\n);\n',
            'src/app-layer/jobs/sweep.ts':
                `await db.$executeRawUnsafe(\n    \`UPDATE "${INTERP}{model}" SET "${INTERP}{field}" = $1 WHERE id = $2\`,\n    v,\n    id,\n);\n`,
            'src/app-layer/jobs/allowed-sweep.ts':
                `await db.$executeRawUnsafe(\`UPDATE "${INTERP}{model}" SET "${INTERP}{field}" = $1\`, v);\n`,
            'src/lib/locks.ts': 'await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;\n',
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

    it('reports raw SQL against a tenancy table, on one line or several, and not against a table outside the list', () => {
        expect(
            unauditedRawSql(root, DOMAIN_TABLES, RAW_SQL_ALLOWED, {
                'src/app-layer/jobs/allowed-sweep.ts': 'planted exception',
            }).sort(),
        ).toEqual([
            'src/app-layer/jobs/sweep.ts → raw SQL writing an interpolated table',
            'src/app-layer/usecases/raw-multiline.ts → raw SQL targeting "TenantSecuritySettings"',
            'src/app-layer/usecases/raw.ts → raw SQL targeting "TenantMembership"',
        ]);
    });

    it('reads a tagged template and a call whose SQL holds parentheses, whole', () => {
        expect(rawWriteStatements('x.$executeRaw`SELECT 1`; y.$executeRawUnsafe(`SELECT COUNT(*) FROM "T"`, a);')).toEqual([
            '`SELECT 1`',
            '(`SELECT COUNT(*) FROM "T"`, a)',
        ]);
    });
});
