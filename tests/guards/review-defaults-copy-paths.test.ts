/**
 * Every create path copies the type's default review steps (sub-phase 2.8c;
 * ADR 0009 §15; owner decision 159): the dialog and the API, template
 * sub-items, project-template starter items, intake accept and repeat copies.
 *
 * Every function under `src/app-layer/usecases/` that writes a new work item
 * (`WorkItemRepository.create`) must call `copyTypeReviewDefaultsInTx` in the
 * same function, so in the create's transaction. The writers found are
 * pinned: today the two in-transaction cores every create path shares, so a
 * new writer is a reviewed change.
 *
 * The population comes from git; the detector proves itself against a
 * planted repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

interface Writer {
    at: string;
    copies: boolean;
}

function enclosing(node: ts.Node): ts.FunctionDeclaration | null {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) if (ts.isFunctionDeclaration(n) && n.name) return n;
    return null;
}

/** Every function that creates a work item, and whether it copies the type's defaults. */
function itemWriters(root: string): Writer[] {
    const out = new Map<string, Writer>();
    for (const rel of gitFiles(root).filter((r) => r.startsWith('src/app-layer/usecases/') && r.endsWith('.ts'))) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && node.expression.getText(sf) === 'WorkItemRepository.create') {
                const fn = enclosing(node);
                const at = `${rel}#${fn?.name?.text ?? '<top level>'}`;
                out.set(at, { at, copies: fn ? /\bcopyTypeReviewDefaultsInTx\(/.test(fn.getText(sf)) : false });
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return [...out.values()].sort((a, b) => (a.at < b.at ? -1 : 1));
}

describe("every create copies the type's default review steps", () => {
    it('finds the item writers (the population is real)', () => {
        expect(itemWriters(REPO_ROOT).map((w) => w.at)).toEqual([
            'src/app-layer/usecases/work-item.ts#createWorkItemInTx',
            'src/app-layer/usecases/work-item.ts#insertTemplateItemInTx',
        ]);
    });

    it('every one copies in the same function', () => {
        expect(itemWriters(REPO_ROOT).filter((w) => !w.copies).map((w) => w.at)).toEqual([]);
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-review-copy-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        fs.mkdirSync(path.join(root, 'src/app-layer/usecases'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'src/app-layer/usecases/creates.ts'),
            [
                'export async function forgetful(db, ctx, data) {',
                '    return WorkItemRepository.create(db, ctx, data);',
                '}',
                'export async function careful(db, ctx, data) {',
                '    const row = await WorkItemRepository.create(db, ctx, data);',
                '    await copyTypeReviewDefaultsInTx(db, ctx, { ...row, key: "K-1" });',
                '}',
            ].join('\n'),
        );
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('flags a create that forgets the defaults', () => {
        expect(itemWriters(root).filter((w) => !w.copies).map((w) => w.at)).toEqual(['src/app-layer/usecases/creates.ts#forgetful']);
        expect(itemWriters(root).find((w) => w.at.endsWith('#careful'))?.copies).toBe(true);
    });
});
