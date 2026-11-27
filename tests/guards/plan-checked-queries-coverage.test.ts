/**
 * Every repository read of a guarded table is plan-checked or says why not
 * (Hardening H2a; docs/porting/maps/H2.md part 1.2; docs/performance.md).
 *
 * The `perf` project checks the plan of every query in PLAN_CHECKED_QUERIES
 * on the seeded database; this guard, which needs no database, holds the
 * registry to the code: every static method of a class under
 * `src/app-layer/repositories/` that READS `WorkItem`, `Comment`,
 * `SearchVector`, (3.4b) `TimeEntry` or (3.6a) `WorkItemTransition` (a
 * Prisma read on `workItem`, `comment`, `searchVector`, `timeEntry` or
 * `workItemTransition`,
 * raw SQL naming one of the three tables, or a call of a search function
 * that reads one) is named by a query's `methods`
 * or carries a reason in PLAN_CHECK_EXEMPT, and neither list names a method
 * that does not exist or no longer reads one. A new list query cannot avoid
 * the check.
 *
 * The population comes from git; the detector proves itself against a planted
 * repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';

import { PLAN_CHECK_EXEMPT, PLAN_CHECKED_QUERIES } from '../perf/plan-checked-queries';
import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { SEARCH_DEFINER_FUNCTIONS } from '../helpers/search-definer';

const PRISMA_READ = /\.(workItem|comment|searchVector|timeEntry|workItemTransition)\s*\.\s*(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy)\s*\(/;
const RAW_READ = /\$queryRaw/;
const GUARDED_TABLE = /"(WorkItem|Comment|SearchVector|TimeEntry|WorkItemTransition)"/;
/**
 * A search function that reads a guarded table (owner decision 245): a call
 * names no table, but the function's body reads them
 * (`tests/helpers/search-definer.ts`).
 */
const GUARDED_SEARCH_FUNCTION = new RegExp(
    `\\b(${SEARCH_DEFINER_FUNCTIONS.filter((f) => Object.values(f.tables).some((t) => t !== 'Project'))
        .map((f) => f.name)
        .join('|')})\\s*\\(`,
);

/** `Class.method` of every repository method that reads a guarded table. */
function readers(root: string): string[] {
    const out = new Set<string>();
    for (const rel of gitFiles(root).filter((r) => r.startsWith('src/app-layer/repositories/') && r.endsWith('.ts'))) {
        const sf = ts.createSourceFile(rel, fs.readFileSync(path.join(root, rel), 'utf8'), ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
            if (ts.isClassDeclaration(node) && node.name) {
                for (const member of node.members) {
                    if (!ts.isMethodDeclaration(member) || !member.body) continue;
                    const body = member.body.getText(sf);
                    if (PRISMA_READ.test(body) || (RAW_READ.test(body) && (GUARDED_TABLE.test(body) || GUARDED_SEARCH_FUNCTION.test(body)))) out.add(`${node.name.text}.${member.name.getText(sf)}`);
                }
                return;
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return [...out].sort();
}

const listed = new Set(PLAN_CHECKED_QUERIES.flatMap((q) => q.methods));
const exempt = new Set(Object.keys(PLAN_CHECK_EXEMPT));

describe('PLAN_CHECKED_QUERIES covers every repository read of WorkItem, Comment and SearchVector', () => {
    const found = readers(REPO_ROOT);

    it('finds the readers (the population is real)', () => {
        expect(found.length).toBeGreaterThan(50);
        expect(found).toEqual(expect.arrayContaining(['WorkItemRepository.list', 'CommentRepository.list', 'SearchVectorRepository.matchItems']));
    });

    it('every reader is plan-checked or exempt with a reason', () => {
        expect(found.filter((m) => !listed.has(m) && !exempt.has(m))).toEqual([]);
    });

    it('no entry names a method that does not read a guarded table (no stale entries)', () => {
        expect([...listed, ...exempt].filter((m) => !found.includes(m)).sort()).toEqual([]);
    });

    it('no method is both checked and exempt, and every reason says something', () => {
        expect([...exempt].filter((m) => listed.has(m))).toEqual([]);
        expect(Object.entries(PLAN_CHECK_EXEMPT).filter(([, reason]) => reason.trim().length < 20)).toEqual([]);
    });

    it('query names are unique, and every query names its indexes and a buffer budget', () => {
        const names = PLAN_CHECKED_QUERIES.map((q) => q.name);
        expect(new Set(names).size).toBe(names.length);
        expect(PLAN_CHECKED_QUERIES.filter((q) => !(q.maxBuffers > 0))).toEqual([]);
        // And one for the nightly 100k run (H2b).
        expect(PLAN_CHECKED_QUERIES.filter((q) => !(Number.isInteger(q.maxBuffers100k) && q.maxBuffers100k > 0)).map((q) => q.name)).toEqual([]);
        // An empty index list says why, and only then.
        expect(PLAN_CHECKED_QUERIES.filter((q) => (q.indexes.length === 0) !== (q.noIndexBecause !== undefined && q.noIndexBecause.length >= 20)).map((q) => q.name)).toEqual([]);
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-plan-registry-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant(
            'src/app-layer/repositories/Planted.ts',
            [
                'export class PlantedRepository {',
                '    static async list(db) { return db.workItem.findMany({ take: 1 }); }',
                '    static async raw(db) { return db.$queryRaw`SELECT 1 FROM "Comment"`; }',
                '    static async write(db) { return db.workItem.create({ data: {} }); }',
                '    static async other(db) { return db.label.findMany({ take: 1 }); }',
                '    static async rawOther(db) { return db.$queryRaw`SELECT 1 FROM "Label"`; }',
                '    static async viaFunction(db) { return db.$queryRaw`SELECT t."id" FROM search_item_contents(${q}) t`; }',
                '    static async projectsOnly(db) { return db.$queryRaw`SELECT t."id" FROM search_project_names(${q}) t`; }',
                '}',
            ].join('\n'),
        );
        plant('src/app-layer/usecases/not-a-repository.ts', 'export class X { static async y(db) { return db.workItem.findMany(); } }\n');
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds Prisma reads, raw reads of a guarded table and calls of a search function reading one, in repositories only', () => {
        expect(readers(root)).toEqual(['PlantedRepository.list', 'PlantedRepository.raw', 'PlantedRepository.viaFunction']);
    });
});
