/**
 * Multi-item work-item writes lock their rows in id order first (owner
 * decision 173, 2026-11-20; Hardening H2's concurrency part; issue #65;
 * `src/app-layer/repositories/work-item-locks.ts`).
 *
 * The type system carries the rule: a method that can write more than one
 * `WorkItem` row takes a `LockedWorkItemIds`, and only the lock methods mint
 * one. This guard holds what the type system cannot:
 *
 *   1. Every write to `WorkItem` in `src/` (a Prisma `workItem.update`,
 *      `updateMany`, `delete`, `deleteMany` or `upsert`, or SQL naming
 *      `UPDATE "WorkItem"` / `DELETE FROM "WorkItem"`) sits in a function
 *      that either takes a `LockedWorkItemIds` parameter or is a listed
 *      single-row writer (one row by its `id`, with a reason).
 *   2. Nothing in `src/` casts to the brand except `work-item-locks.ts`, and
 *      only `WorkItemRepository.ts` mints one.
 *   3. A single-row writer is never called lexically inside a loop or an
 *      array callback: a loop of single-row writes is a multi-item write that
 *      skipped the lock.
 *   4. Every lock method orders by `"id"` and locks `FOR UPDATE` in one
 *      statement.
 *
 * Out of reach, said so: the key rotations' sweeps rewrite ciphertext with a
 * raw UPDATE on an interpolated table name, one row per statement in id
 * order (already the lock order); a single-row writer reached through a
 * helper called in a loop (the review engine's settle, for example) is the
 * caller's to lock, as `withdrawRowsAndSettle` does.
 *
 * Population from git; the detectors prove themselves against a planted
 * repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

const LOCKS_MODULE = 'src/app-layer/repositories/work-item-locks.ts';
const REPOSITORY = 'src/app-layer/repositories/WorkItemRepository.ts';
const BRAND = 'LockedWorkItemIds';

/** `file#function` → why it writes exactly one row, by its id. */
const SINGLE_ROW_WRITERS: Readonly<Record<string, string>> = {
    [`${REPOSITORY}#updateVersioned`]: 'The versioned write: `where: { id, … }`, one item per call (ADR 0002 §9).',
    [`${REPOSITORY}#bumpVersionOf`]: 'One item\'s version, `where: { id }` (a label attached to or detached from it).',
    [`${REPOSITORY}#setSortKey`]: 'One item\'s sort key, `where: { id }`, under its project\'s sequence lock.',
};

/** Methods that write one row by id; calling one in a loop is a multi-item write (rule 3). */
const SINGLE_ROW_METHODS = ['updateVersioned', 'bumpVersionOf', 'setSortKey'];

const WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
const SQL_WRITE = /\b(UPDATE\s+"WorkItem"|DELETE\s+FROM\s+"WorkItem")(?![A-Za-z])/;

function sources(root: string): string[] {
    return gitFiles(root).filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel));
}

function parse(root: string, rel: string): ts.SourceFile {
    return ts.createSourceFile(rel, fs.readFileSync(path.join(root, rel), 'utf8'), ts.ScriptTarget.Latest, true);
}

type FunctionLike = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function enclosingNamedFunction(node: ts.Node): { name: string; fn: FunctionLike } | null {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return { name: n.name.getText(), fn: n };
        if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)) return { name: n.parent.name.getText(), fn: n };
    }
    return null;
}

function takesBrand(fn: FunctionLike): boolean {
    return fn.parameters.some((p) => p.type !== undefined && p.type.getText().includes(BRAND));
}

/** Rule 1: `file#function` of every WorkItem write outside a branded or listed function. */
function unlockedWriters(root: string): string[] {
    const out = new Set<string>();
    for (const rel of sources(root)) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        if (!/\.workItem\b/.test(text) && !SQL_WRITE.test(text)) continue;
        const sf = parse(root, rel);
        const judge = (node: ts.Node) => {
            const owner = enclosingNamedFunction(node);
            const key = `${rel}#${owner?.name ?? '<top level>'}`;
            if (owner && (takesBrand(owner.fn) || key in SINGLE_ROW_WRITERS)) return;
            out.add(key);
        };
        const visit = (node: ts.Node) => {
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                WRITE_OPS.has(node.expression.name.text) &&
                ts.isPropertyAccessExpression(node.expression.expression) &&
                node.expression.expression.name.text === 'workItem'
            ) {
                judge(node);
            }
            if ((ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isStringLiteral(node)) && SQL_WRITE.test(node.getText(sf))) judge(node);
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return [...out].sort();
}

/** The listed single-row writers that still write (a stale entry fails). */
function listedWritersPresent(root: string): string[] {
    const present = new Set<string>();
    for (const key of Object.keys(SINGLE_ROW_WRITERS)) {
        const [rel, name] = key.split('#') as [string, string];
        if (!fs.existsSync(path.join(root, rel))) continue;
        const sf = parse(root, rel);
        const visit = (node: ts.Node) => {
            if (ts.isMethodDeclaration(node) && node.name.getText(sf) === name && /\.workItem\.updateMany\(/.test(node.getText(sf))) present.add(key);
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return [...present].sort();
}

/** Rule 2: casts to the brand outside the locks module, and mints outside the repository. */
function brandLeaks(root: string): string[] {
    const out: string[] = [];
    for (const rel of sources(root)) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        if (!text.includes(BRAND) && !text.includes('mintLockedWorkItemIds')) continue;
        const sf = parse(root, rel);
        const visit = (node: ts.Node) => {
            if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && node.type.getText(sf).includes(BRAND) && rel !== LOCKS_MODULE) {
                out.push(`${rel}: cast to ${BRAND}`);
            }
            if (ts.isIdentifier(node) && node.text === 'mintLockedWorkItemIds' && rel !== LOCKS_MODULE && rel !== REPOSITORY) {
                out.push(`${rel}: mintLockedWorkItemIds`);
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return [...new Set(out)].sort();
}

const ARRAY_CALLBACKS = new Set(['map', 'forEach', 'flatMap', 'reduce', 'filter', 'some', 'every']);

function insideLoop(node: ts.Node): boolean {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n)) return true;
        if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isCallExpression(n.parent)) {
            const callee = n.parent.expression;
            if (ts.isPropertyAccessExpression(callee) && ARRAY_CALLBACKS.has(callee.name.text)) return true;
        }
        if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) return false;
    }
    return false;
}

/** Rule 3: `file#function` of every single-row writer called in a loop. */
function singleRowWritesInLoops(root: string): string[] {
    const out = new Set<string>();
    const pattern = new RegExp(`\\.(${SINGLE_ROW_METHODS.join('|')})$`);
    for (const rel of sources(root)) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        if (!SINGLE_ROW_METHODS.some((m) => text.includes(m))) continue;
        const sf = parse(root, rel);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && pattern.test(node.expression.getText(sf)) && insideLoop(node)) {
                out.add(`${rel}#${enclosingNamedFunction(node)?.name ?? '<top level>'}`);
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return [...out].sort();
}

/** Rule 4: the repository's lock methods (named `lock…`, returning the brand) and whether each orders by id `FOR UPDATE`. */
function lockMethods(root: string): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    if (!fs.existsSync(path.join(root, REPOSITORY))) return out;
    const sf = parse(root, REPOSITORY);
    const visit = (node: ts.Node) => {
        if (ts.isMethodDeclaration(node) && /^lock/.test(node.name.getText(sf)) && node.type?.getText(sf).includes(BRAND)) {
            const body = node.body?.getText(sf) ?? '';
            const statements = body.match(/\$queryRaw/g)?.length ?? 0;
            out[node.name.getText(sf)] = statements === 1 && /ORDER BY (\w+\.)?"id"\s/.test(body) && /FOR UPDATE/.test(body);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

/** Every repository method that takes the brand (the denominator). */
function brandedRepositoryMethods(root: string): string[] {
    const out: string[] = [];
    for (const rel of sources(root).filter((r) => r.startsWith('src/app-layer/repositories/'))) {
        const sf = parse(root, rel);
        const visit = (node: ts.Node) => {
            if (ts.isMethodDeclaration(node) && takesBrand(node)) out.push(`${rel}#${node.name.getText(sf)}`);
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return out.sort();
}

describe('multi-item work-item writes lock in id order (decision 173)', () => {
    it('every WorkItem write is branded or a listed single-row writer', () => {
        expect(unlockedWriters(REPO_ROOT)).toEqual([]);
    });

    it('every listed single-row writer still writes (no stale entry)', () => {
        expect(listedWritersPresent(REPO_ROOT)).toEqual(Object.keys(SINGLE_ROW_WRITERS).sort());
    });

    it('nobody forges the brand', () => {
        expect(brandLeaks(REPO_ROOT)).toEqual([]);
    });

    it('no single-row writer is called in a loop', () => {
        expect(singleRowWritesInLoops(REPO_ROOT)).toEqual([]);
    });

    it('every lock method orders by id FOR UPDATE in one statement', () => {
        const locks = lockMethods(REPO_ROOT);
        expect(Object.keys(locks).sort()).toEqual(['lockForWrite', 'lockInState', 'lockItemsNamingGoals', 'lockItemsOfPerson', 'lockPurgeBatch']);
        expect(Object.values(locks).every(Boolean)).toBe(true);
    });

    it('reads a population: the multi-row writers take the brand', () => {
        expect(brandedRepositoryMethods(REPO_ROOT)).toEqual(
            expect.arrayContaining([
                `${REPOSITORY}#bulkUpdate`,
                `${REPOSITORY}#bumpVersion`,
                `${REPOSITORY}#softDelete`,
                `${REPOSITORY}#restoreDeletion`,
                `${REPOSITORY}#unassignAll`,
                `${REPOSITORY}#clearWaitingOnAll`,
                `${REPOSITORY}#moveCycle`,
                `${REPOSITORY}#clearCycleIncludingDeleted`,
                `${REPOSITORY}#clearMilestoneIncludingDeleted`,
                `${REPOSITORY}#moveRow`,
                `${REPOSITORY}#hardDelete`,
                `${REPOSITORY}#rewriteSortKey`,
                'src/app-layer/repositories/TeamRepository.ts#moveItemsToState',
            ]),
        );
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-multi-row-lock-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant(
            REPOSITORY,
            [
                "import { mintLockedWorkItemIds, type LockedWorkItemIds } from './work-item-locks';",
                'export class WorkItemRepository {',
                '    static async lockForWrite(db, ctx, ids: string[]): Promise<LockedWorkItemIds> {',
                '        const rows = await db.$queryRaw`SELECT "id" FROM "WorkItem" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE`;',
                '        return mintLockedWorkItemIds(rows.map((r) => r.id));',
                '    }',
                '    static async lockSloppily(db, ctx, ids: string[]): Promise<LockedWorkItemIds> {',
                '        const rows = await db.$queryRaw`SELECT "id" FROM "WorkItem" WHERE "id" = ANY(${ids}) FOR UPDATE`;',
                '        return mintLockedWorkItemIds(rows.map((r) => r.id));',
                '    }',
                '    static async bulkUpdate(db, ctx, ids: LockedWorkItemIds, patch) {',
                '        return db.workItem.updateMany({ where: { id: { in: ids } }, data: patch });',
                '    }',
                '    static async updateVersioned(db, ctx, v, id, version, patch) {',
                '        return db.workItem.updateMany({ where: { id, version }, data: patch });',
                '    }',
                '    static async clearEverything(db, ctx, userId) {',
                '        return db.workItem.updateMany({ where: { assigneeId: userId }, data: { assigneeId: null } });',
                '    }',
                '}',
            ].join('\n'),
        );
        plant(
            'src/app-layer/usecases/sneaky.ts',
            [
                "import type { LockedWorkItemIds } from '../repositories/work-item-locks';",
                'export async function forge(db, ctx, ids: string[]) {',
                '    await WorkItemRepository.bulkUpdate(db, ctx, ids as unknown as LockedWorkItemIds, {});',
                '}',
                'export async function loop(db, ctx, v, items) {',
                '    for (const i of items) await WorkItemRepository.updateVersioned(db, ctx, v, i.id, undefined, {});',
                '    await Promise.all(items.map((i) => WorkItemRepository.setSortKey(db, ctx, v, i.id, "a")));',
                '}',
                'export async function rawWrite(db) {',
                '    await db.$executeRaw`UPDATE "WorkItem" SET "title" = \'x\'`;',
                '}',
            ].join('\n'),
        );
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('flags a multi-row write without the brand, in a repository and in raw SQL', () => {
        expect(unlockedWriters(root)).toEqual([`${REPOSITORY}#clearEverything`, 'src/app-layer/usecases/sneaky.ts#rawWrite']);
    });

    it('flags a forged brand', () => {
        expect(brandLeaks(root)).toEqual(['src/app-layer/usecases/sneaky.ts: cast to LockedWorkItemIds']);
    });

    it('flags single-row writers in a loop and in an array callback', () => {
        expect(singleRowWritesInLoops(root)).toEqual(['src/app-layer/usecases/sneaky.ts#loop']);
    });

    it('flags a lock method that does not order by id', () => {
        expect(lockMethods(root)).toEqual({ lockForWrite: true, lockSloppily: false });
    });
});
