/**
 * A migration must not mix a BARE `ALTER TYPE ... ADD VALUE` with other DDL.
 *
 * ## The incident this comes from (inflect-compliance #2746, outage #2745)
 *
 * A migration that added enum values and altered tables started and never
 * finished. The container runs `prisma migrate deploy` on every start; Prisma
 * refuses to proceed past a failed migration (P3009), the container exits,
 * Docker restarts it. Production was down about 25 hours.
 *
 * ## Why BARE, and why `IF NOT EXISTS` is the fix
 *
 * Postgres commits an enum addition in a way that does not roll back with the
 * surrounding transaction, and Prisma wraps a migration in one. When a later
 * statement fails, the enum values are already permanent while the rest is not.
 * What makes it unrecoverable is the RE-RUN: `migrate resolve --rolled-back`
 * re-runs the migration from the top, and a bare `ADD VALUE` against an enum
 * that already contains the value fails, putting the app straight back into
 * the loop. `ADD VALUE IF NOT EXISTS` is idempotent, so the re-run survives.
 *
 * So the rule is not "never add an enum value alongside DDL". It is: if you
 * do, make the addition re-runnable. Splitting it into its own migration is
 * the other valid answer, because then a partial failure lands on a BOUNDARY
 * where `--applied` and `--rolled-back` mean what they say.
 *
 * ## Why the detector does not anchor on `^ALTER TYPE`
 *
 * An addition wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object …`
 * would be missed by an anchored match, so the scan is over the whole file,
 * comments stripped.
 *
 * Islestone starts with no grandfathered migration, and the list must stay
 * empty. Population from git.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, REPO_ROOT } from '../helpers/git-files';
import { migrationFiles } from '../helpers/rls-policies';

/** FROZEN AND EMPTY. Adding a name here is how the next outage gets written. */
const GRANDFATHERED: ReadonlySet<string> = new Set<string>();

/** `--` comments stripped, so prose describing DDL is never read as DDL. */
function ddlOf(sql: string): string {
    return sql.replace(/--[^\n]*/g, '');
}

/** Every enum addition in the file; `idempotent` is the `IF NOT EXISTS` form. */
function enumAdditions(ddl: string): { idempotent: boolean }[] {
    const re = /ALTER\s+TYPE\s+"?\w+"?\s+ADD\s+VALUE(\s+IF\s+NOT\s+EXISTS)?/gi;
    const out: { idempotent: boolean }[] = [];
    for (const m of ddl.matchAll(re)) out.push({ idempotent: Boolean(m[1]) });
    return out;
}

/** Does the file carry DDL other than the enum additions themselves? */
function hasOtherDdl(ddl: string): boolean {
    const rest = ddl.replace(/ALTER\s+TYPE\s+"?\w+"?\s+ADD\s+VALUE[^;]*;/gi, '');
    return /\b(CREATE|ALTER\s+TABLE|DROP|INSERT|UPDATE)\b/i.test(rest);
}

function isOffender(sql: string): boolean {
    const ddl = ddlOf(sql);
    return enumAdditions(ddl).some((a) => !a.idempotent) && hasOtherDdl(ddl);
}

function offenders(root: string): string[] {
    return migrationFiles(root)
        .filter((rel) => isOffender(fs.readFileSync(path.join(root, rel), 'utf-8')))
        .map((rel) => rel.split('/')[2]!);
}

describe('migrations — a bare enum addition is never mixed with other DDL', () => {
    it('reads the migration population from git', () => {
        expect(migrationFiles(REPO_ROOT).length).toBeGreaterThan(0);
    });

    it('no migration carries the shape', () => {
        expect(offenders(REPO_ROOT).filter((n) => !GRANDFATHERED.has(n))).toEqual([]);
    });

    it('the grandfathered list is empty', () => {
        expect([...GRANDFATHERED]).toEqual([]);
    });

    describe('detector proof — on synthetic SQL, so a clean run means something', () => {
        it('flags a BARE addition beside other DDL', () => {
            expect(isOffender(`ALTER TYPE "K" ADD VALUE 'X';\nALTER TABLE "T" ADD COLUMN "c" TEXT;`)).toBe(true);
        });

        it('does NOT flag the IF NOT EXISTS form — that is the fix', () => {
            expect(isOffender(`ALTER TYPE "K" ADD VALUE IF NOT EXISTS 'X';\nALTER TABLE "T" ADD COLUMN "c" TEXT;`)).toBe(
                false,
            );
        });

        it('does NOT flag an enum-only migration — the other valid answer', () => {
            expect(isOffender(`ALTER TYPE "K" ADD VALUE 'A';\nALTER TYPE "K" ADD VALUE 'B';`)).toBe(false);
        });

        it('SEES an addition wrapped in a DO block, which an anchored match misses', () => {
            const ddl = ddlOf(`DO $$ BEGIN\n  ALTER TYPE "K" ADD VALUE 'X';\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;`);
            expect(enumAdditions(ddl).length).toBe(1);
        });

        it('is not satisfied by a COMMENT that merely describes the shape', () => {
            const ddl = ddlOf(`-- ALTER TYPE "K" ADD VALUE 'X';\nALTER TABLE "T" ADD COLUMN "c" TEXT;`);
            expect(enumAdditions(ddl).length).toBe(0);
        });
    });

    describe('against a planted repository', () => {
        let root: string;

        beforeAll(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-enum-isolation-'));
            execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
            const plant = (rel: string, content: string) => {
                fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
                fs.writeFileSync(path.join(root, rel), content);
            };
            plant('prisma/migrations/1_mixed/migration.sql', `ALTER TYPE "Role" ADD VALUE 'X';\nCREATE TABLE "T" ("id" TEXT);`);
            plant('prisma/migrations/2_alone/migration.sql', `ALTER TYPE "Role" ADD VALUE 'Y';`);
            plant('prisma/migrations/3_safe/migration.sql', `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'Z';\nCREATE TABLE "U" ("id" TEXT);`);
        });

        afterAll(() => {
            fs.rmSync(root, { recursive: true, force: true });
        });

        it('names the mixed migration, and only it', () => {
            expect(offenders(root)).toEqual(['1_mixed']);
        });
    });
});
