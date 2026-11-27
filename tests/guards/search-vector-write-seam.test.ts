/**
 * One seam for search vectors (sub-phase 2.7f; ADR 0008 D1, "Keeping it in
 * sync"; owner decision 124).
 *
 *   1. Only `src/app-layer/repositories/SearchVectorRepository.ts` touches the
 *      `SearchVector` table: no other file under `src/` names it in SQL,
 *      reaches its Prisma delegate or calls `search_item_contents`, the
 *      search function that reads it (owner decision 245; its body is pinned
 *      by `search-definer-functions.test.ts`).
 *   2. Every function under `src/app-layer/` that writes a description or a
 *      comment's body calls the seam in the same function, so in the same
 *      transaction: a call of `WorkItemRepository.create`,
 *      `CommentRepository.create` or `CommentRepository.edit`, or a versioned
 *      update in a function that handles a `description`, must call
 *      `SearchVectorRepository.replaceForSource`; a comment's soft delete must
 *      call `removeForSource`. The writers found are pinned, so a new one is
 *      a reviewed change here.
 *   2b. The seam's bulk path, `insertBulkForSeed` (Hardening H2a, decision
 *      171), has one caller: the scale seeder (`scripts/seed-scale/bulk.ts`).
 *      No application code may write vectors in bulk, and nothing under
 *      `scripts/` writes the table any other way (a script may read it: the
 *      seed's verification counts it).
 *   3. Every full-text call in `src/` and in the migrations after 2.7b names
 *      the one configuration, `islestone_bg_en`, as a literal (a planner
 *      matches an expression index only on a constant, and nothing may fall
 *      back to `simple` or `english`).
 *
 * The population comes from git; the detectors prove themselves against a
 * planted repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

const SEAM = 'src/app-layer/repositories/SearchVectorRepository.ts';

// ─── 1) The table's one module ────────────────────────────────────────

/** Files under src/ (other than the seam) that name the table in SQL or reach its delegate. */
function tableTouchers(root: string): string[] {
    return gitFiles(root)
        .filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel) && rel !== SEAM)
        .filter((rel) => {
            const src = fs.readFileSync(path.join(root, rel), 'utf8');
            return /"SearchVector"/.test(src) || /\.searchVector\b/.test(src) || /\bsearch_item_contents\b/.test(src);
        });
}

/** Files under scripts/ that write the table other than through the seam. */
function scriptWriters(root: string): string[] {
    return gitFiles(root)
        .filter((rel) => rel.startsWith('scripts/') && /\.(ts|mts|mjs|js)$/.test(rel))
        .filter((rel) => {
            const src = fs.readFileSync(path.join(root, rel), 'utf8');
            return /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"SearchVector"/i.test(src) || /\.searchVector\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(src);
        });
}

/** The one caller of the bulk path. */
const BULK_CALLERS = ['scripts/seed-scale/bulk.ts'];

/** Files other than the seam that call `insertBulkForSeed`. */
function bulkCallers(root: string): string[] {
    return gitFiles(root)
        .filter((rel) => /\.(ts|tsx|mts)$/.test(rel) && rel !== SEAM && !rel.startsWith('tests/'))
        .filter((rel) => /\binsertBulkForSeed\s*\(/.test(fs.readFileSync(path.join(root, rel), 'utf8')));
}

// ─── 2) The writers ───────────────────────────────────────────────────

const ITEM_OR_COMMENT_WRITES = ['WorkItemRepository.create', 'CommentRepository.create', 'CommentRepository.edit'];
const COMMENT_DELETE = 'CommentRepository.softDelete';

interface Writer {
    file: string;
    fn: string;
    needs: 'replaceForSource' | 'removeForSource';
    calls: boolean;
}

function calleeText(node: ts.CallExpression, sf: ts.SourceFile): string {
    return node.expression.getText(sf);
}

function enclosingFunctionName(node: ts.Node): { node: ts.Node; name: string } | null {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) return { node: n, name: n.name?.getText() ?? '<anonymous>' };
        if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent) {
            // An inner callback (`runInTenantContext(ctx, async (db) => …)`) belongs to its outer function.
            continue;
        }
    }
    return null;
}

/** Every writer function under src/app-layer/ and whether it calls the seam it needs. */
function writers(root: string): Writer[] {
    const out = new Map<string, Writer>();
    for (const rel of gitFiles(root).filter((r) => r.startsWith('src/app-layer/') && r.endsWith('.ts') && !r.startsWith('src/app-layer/repositories/'))) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node)) {
                const callee = calleeText(node, sf);
                let needs: Writer['needs'] | null = null;
                if (ITEM_OR_COMMENT_WRITES.includes(callee)) needs = 'replaceForSource';
                else if (callee === COMMENT_DELETE) needs = 'removeForSource';
                // A work item's versioned write (a goal's or an initiative's, 3.2a, and a
                // time entry's, 3.4b, are not search sources: ADR 0008 indexes none of their descriptions).
                else if (/(^|\.)updateVersioned$/.test(callee) && !/^(GoalRepository|InitiativeRepository|TimeEntryRepository)\./.test(callee)) {
                    const fn = enclosingFunctionName(node);
                    if (fn && /\bdescription\b/.test(fn.node.getText(sf))) needs = 'replaceForSource';
                }
                if (needs) {
                    const fn = enclosingFunctionName(node);
                    if (fn) {
                        const body = fn.node.getText(sf);
                        const key = `${rel}#${fn.name}#${needs}`;
                        out.set(key, { file: rel, fn: fn.name, needs, calls: body.includes(`SearchVectorRepository.${needs}(`) });
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return [...out.values()].sort((a, b) => (`${a.file}#${a.fn}` < `${b.file}#${b.fn}` ? -1 : 1));
}

// ─── 3) The configuration, spelled ────────────────────────────────────

const TS_FUNCTIONS = /\b(to_tsvector|plainto_tsquery|websearch_to_tsquery|phraseto_tsquery|to_tsquery)\s*\(\s*([^,)]*)/g;
/** 2.7b's migration made the `simple` indexes 2.7f replaces; it is history. */
const FIRST_MIGRATION_ON_THE_CONFIGURATION = '20261207120000_search_configuration';
/** The configuration check casts the constant on purpose (it asks whether the configuration exists). */
const PARAMETER_ALLOWED = new Set(['src/lib/search/configuration-check.ts']);

function configurationOffenders(root: string): string[] {
    const out: string[] = [];
    for (const rel of gitFiles(root)) {
        const migration = /^prisma\/migrations\/([^/]+)\/migration\.sql$/.exec(rel);
        const isSource = rel.startsWith('src/') && /\.tsx?$/.test(rel);
        if (!isSource && !(migration && migration[1]! >= FIRST_MIGRATION_ON_THE_CONFIGURATION)) continue;
        const raw = fs.readFileSync(path.join(root, rel), 'utf8');
        // Comments may name another configuration (history, a warning); code may not.
        const text = isSource ? codeOf(raw) : raw.replace(/--.*$/gm, '');
        for (const m of text.matchAll(TS_FUNCTIONS)) {
            const arg = m[2]!.trim();
            if (arg === `'islestone_bg_en'` || arg === `'public.islestone_bg_en'`) continue;
            if (PARAMETER_ALLOWED.has(rel) && arg.includes('SEARCH_CONFIGURATION')) continue;
            // `to_tsvector($1)` names no configuration and would use the server default.
            out.push(`${rel}: ${m[1]}(${arg}`);
        }
    }
    return out;
}

describe('search vectors — one seam', () => {
    it('only SearchVectorRepository touches the SearchVector table', () => {
        expect(tableTouchers(REPO_ROOT)).toEqual([]);
    });

    it('nothing under scripts/ writes the table except through the seam', () => {
        expect(scriptWriters(REPO_ROOT)).toEqual([]);
    });

    it("the seam's bulk path has exactly one caller, the scale seeder", () => {
        expect(bulkCallers(REPO_ROOT)).toEqual(BULK_CALLERS);
    });

    it('finds the writers of descriptions and comments (the population is real)', () => {
        expect(writers(REPO_ROOT).map((w) => `${w.file}#${w.fn}`)).toEqual([
            'src/app-layer/usecases/work-item-collab.ts#addComment',
            'src/app-layer/usecases/work-item-collab.ts#deleteComment',
            'src/app-layer/usecases/work-item-collab.ts#editComment',
            'src/app-layer/usecases/work-item.ts#createWorkItemInTx',
            'src/app-layer/usecases/work-item.ts#insertTemplateItemInTx',
            'src/app-layer/usecases/work-item.ts#updateWorkItem',
        ]);
    });

    it('every writer calls the seam in the same function, so in the same transaction', () => {
        expect(writers(REPO_ROOT).filter((w) => !w.calls).map((w) => `${w.file}#${w.fn} must call SearchVectorRepository.${w.needs}`)).toEqual([]);
    });

    it('every full-text call names islestone_bg_en, as a literal', () => {
        expect(configurationOffenders(REPO_ROOT)).toEqual([]);
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-search-seam-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant(
            'src/app-layer/usecases/forgetful.ts',
            [
                'export async function addNote(db, ctx, id, body) {',
                '    return runInTenantContext(ctx, async (db) => CommentRepository.create(db, ctx, id, body));',
                '}',
                'export async function rewrite(db, ctx, id, description) {',
                '    await WorkItemRepository.updateVersioned(db, ctx, v, id, 1, { description });',
                '}',
                'export async function careful(db, ctx, id, body) {',
                '    await CommentRepository.edit(db, ctx, id, body);',
                '    await SearchVectorRepository.replaceForSource(db, ctx, { workItemId: id, commentId: id }, body);',
                '}',
            ].join('\n'),
        );
        plant('src/app-layer/usecases/sneaky.ts', 'export const q = Prisma.sql`DELETE FROM "SearchVector"`;\n');
        plant('src/app-layer/repositories/OtherRepository.ts', 'export const q = Prisma.sql`SELECT * FROM search_item_contents(${x})`;\n');
        plant('scripts/seed-other.ts', 'await db.$executeRawUnsafe(`INSERT INTO "SearchVector" ("id") VALUES (1)`);\n');
        plant('scripts/verify-other.ts', 'await db.$queryRawUnsafe(`SELECT count(*) FROM "SearchVector"`);\n');
        plant('src/app-layer/usecases/bulky.ts', 'await SearchVectorRepository.insertBulkForSeed(db, ctx, rows);\n');
        plant('src/lib/fallback.ts', "// to_tsvector('english', x) in a comment is history\nexport const q = `to_tsvector('simple', title)`;\n");
        plant('prisma/migrations/20261208000000_later/migration.sql', "CREATE INDEX x ON y USING gin (to_tsvector('english', z));\n");
        plant('prisma/migrations/20261203120000_search_titles/migration.sql', "CREATE INDEX x ON y USING gin (to_tsvector('simple', z));\n");
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('flags a writer that skips the seam and passes one that calls it', () => {
        const found = writers(root);
        expect(found.filter((w) => !w.calls).map((w) => w.fn).sort()).toEqual(['addNote', 'rewrite']);
        expect(found.find((w) => w.fn === 'careful')?.calls).toBe(true);
    });

    it('flags SQL against the table, or a call of its search function, outside the seam', () => {
        expect(tableTouchers(root)).toEqual(['src/app-layer/repositories/OtherRepository.ts', 'src/app-layer/usecases/sneaky.ts']);
    });

    it('flags a script that writes the table, not one that reads it', () => {
        expect(scriptWriters(root)).toEqual(['scripts/seed-other.ts']);
    });

    it('flags a caller of the bulk path outside the seeder', () => {
        expect(bulkCallers(root)).toEqual(['src/app-layer/usecases/bulky.ts']);
    });

    it('flags another configuration in source and in a later migration, not in 2.7b\'s', () => {
        expect(configurationOffenders(root).sort()).toEqual([
            "prisma/migrations/20261208000000_later/migration.sql: to_tsvector('english'",
            "src/lib/fallback.ts: to_tsvector('simple'",
        ]);
    });
});
