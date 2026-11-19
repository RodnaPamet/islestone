/**
 * GAP-21 — Structural ratchet for the schema/DB split on `User.emailHash`.
 *
 * The Prisma schema declares `User.emailHash` NULLABLE (`String?`). This is
 * a deliberate, narrow lie at the TS level so callers do not have to thread
 * `emailHash: hashForLookup(email)` through every `prisma.user.create({...})`
 * site: the PII extension fills it from `email` on every write.
 *
 * The TRUTH is enforced at the database: the 1.5 migration sets the column
 * NOT NULL, so a write that bypasses the extension (raw SQL, a client
 * without it) is refused. `prisma/fresh-db-schema-drift.expected.sql`
 * carries the one `DROP NOT NULL` line this split leaves.
 *
 * This guard keeps the two halves. It fails if:
 *
 *   1. The schema drops the `?` (declares the field required), which makes
 *      every create site name the hash.
 *   2. No migration sets the column NOT NULL, or a later one drops it, which
 *      lets a row land without a hash and break sign-in lookups.
 *   3. Production code queries `User` by a plaintext `email` literal.
 *
 * Copied from inflect-compliance `tests/guardrails/pii-hash-not-null.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, for Islestone's one managed
 * model (`AuditorAccount` is compliance; sub-phase 8.3 adds
 * `UserIdentityLink.emailAtLinkTimeHash`). The `email` column keeps its name
 * (ADR 0006 forbids `@map`), so it is the encrypted column. Populations come
 * from `gitFiles()`, and each check is proved against a planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf, sqlCodeOf } from '../helpers/source-blocks';

/** Hash fields the schema declares nullable on purpose. */
const HASH_FIELDS_EXPECTED_NULLABLE = [{ file: 'prisma/schema/tenancy.prisma', model: 'User', field: 'emailHash' }];

/** Columns a migration must set NOT NULL and no later migration may relax. */
const NOT_NULL_DB_COLUMNS = [{ table: 'User', column: 'emailHash' }];

/** The encrypted column, NOT NULL since the table was created (1.3). */
const CREATED_NOT_NULL = [{ table: 'User', column: 'email' }];

/** The migrations under `root`, oldest first, as root-relative paths. */
function migrationFiles(root: string): string[] {
    return gitFiles(root)
        .filter((f) => /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(f))
        .sort();
}

const readSql = (root: string, rel: string) => sqlCodeOf(fs.readFileSync(path.join(root, rel), 'utf8'));

/** The first migration that sets `table.column` NOT NULL, or null. */
export function migrationSettingNotNull(root: string, table: string, column: string): string | null {
    const re = new RegExp(`ALTER TABLE\\s+"${table}"\\s+ALTER COLUMN\\s+"${column}"\\s+SET NOT NULL`, 'i');
    return migrationFiles(root).find((f) => re.test(readSql(root, f))) ?? null;
}

/** Migrations after `after` that drop NOT NULL on `table.column`. */
export function migrationsDroppingNotNull(root: string, table: string, column: string, after: string): string[] {
    const re = new RegExp(`ALTER TABLE\\s+"${table}"\\s+ALTER COLUMN\\s+"${column}"\\s+DROP NOT NULL`, 'i');
    return migrationFiles(root).filter((f) => f > after && re.test(readSql(root, f)));
}

/** Production lines that query a PII-managed model by a plaintext email literal. */
export function plaintextEmailQueries(root: string): string[] {
    const FORBIDDEN = /where:\s*\{\s*[^}]*\bemail:\s*['"]/;
    const offenders: string[] = [];
    for (const rel of gitFiles(root).filter((f) => f.startsWith('src/') && /\.tsx?$/.test(f))) {
        const text = codeOf(fs.readFileSync(path.join(root, rel), 'utf8'));
        if (!text.includes('email')) continue;
        if (!/\bprisma\.user\b|\.user\./.test(text)) continue;
        text.split('\n').forEach((line, i) => {
            if (FORBIDDEN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    return offenders;
}

describe('GAP-21 — schema/DB nullability ratchet', () => {
    test('the Prisma schema declares the hash field nullable (TS ergonomics)', () => {
        for (const { file, model, field } of HASH_FIELDS_EXPECTED_NULLABLE) {
            // codeOf() at the READ SEAM: a `///` doc-comment naming the
            // field must not read as the field declaration.
            const text = codeOf(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
            const modelMatch = text.match(new RegExp(`^model ${model}\\s*\\{([\\s\\S]*?)^\\}`, 'm'));
            expect(modelMatch).not.toBeNull();
            expect(new RegExp(`^\\s*${field}\\s+String\\?`, 'm').test(modelMatch![1] ?? '')).toBe(true);
        }
    });

    test('a migration sets each hash column NOT NULL, and no later one drops it', () => {
        for (const { table, column } of NOT_NULL_DB_COLUMNS) {
            const setter = migrationSettingNotNull(REPO_ROOT, table, column);
            expect({ table, column, setter }).toEqual({
                table,
                column,
                setter: 'prisma/migrations/20261119140000_security_perimeter/migration.sql',
            });
            expect(migrationsDroppingNotNull(REPO_ROOT, table, column, setter!)).toEqual([]);
        }
    });

    test('the encrypted column is NOT NULL from its CREATE TABLE', () => {
        const all = migrationFiles(REPO_ROOT).map((f) => readSql(REPO_ROOT, f)).join('\n');
        for (const { table, column } of CREATED_NOT_NULL) {
            const create = all.match(new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`));
            expect(create?.[1]).toMatch(new RegExp(`"${column}" TEXT NOT NULL`));
            expect(all).not.toMatch(new RegExp(`ALTER TABLE\\s+"${table}"\\s+ALTER COLUMN\\s+"${column}"\\s+DROP NOT NULL`, 'i'));
        }
    });
});

describe('GAP-21 — runtime callers must not query a plaintext email on User', () => {
    test('no production code path queries User by a plaintext email literal', () => {
        // The extension would rewrite such a query to the hash, but a call
        // site that names the plaintext says its author does not know the
        // column holds ciphertext. Use `where: { emailHash: hashForLookup(x) }`.
        expect(plaintextEmailQueries(REPO_ROOT)).toEqual([]);
    });
});

describe('the checks, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-pii-hash-not-null-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            'prisma/migrations/20260101000000_one/migration.sql':
                '-- ALTER TABLE "User" ALTER COLUMN "emailHash" SET NOT NULL; (a comment)\nSELECT 1;\n',
            'prisma/migrations/20260102000000_two/migration.sql': 'ALTER TABLE "User" ALTER COLUMN "emailHash" SET NOT NULL;\n',
            'prisma/migrations/20260103000000_three/migration.sql': 'ALTER TABLE "User" ALTER COLUMN "emailHash" DROP NOT NULL;\n',
            'src/lib/lookup.ts': "await prisma.user.findFirst({ where: { email: 'a@b.com' } });\n",
            'src/lib/fine.ts': "await prisma.user.findFirst({ where: { emailHash: hashForLookup(x) } });\n",
        };
        for (const [rel, body] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), body);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    test('finds the migration that sets NOT NULL, ignoring a commented one', () => {
        expect(migrationSettingNotNull(root, 'User', 'emailHash')).toBe(
            'prisma/migrations/20260102000000_two/migration.sql',
        );
    });

    test('reports a later migration that drops it', () => {
        expect(
            migrationsDroppingNotNull(root, 'User', 'emailHash', 'prisma/migrations/20260102000000_two/migration.sql'),
        ).toEqual(['prisma/migrations/20260103000000_three/migration.sql']);
    });

    test('reports a plaintext email query and not a hashed one', () => {
        expect(plaintextEmailQueries(root)).toEqual([
            "src/lib/lookup.ts:1: await prisma.user.findFirst({ where: { email: 'a@b.com' } });",
        ]);
    });
});
