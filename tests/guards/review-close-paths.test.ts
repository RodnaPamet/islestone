/**
 * Every state path into a closed category, and every delete, ends an open
 * review round (sub-phase 2.8a; ADR 0009 §14; owner decision 149).
 *
 * A function under `src/app-layer/usecases/` that applies
 * `stateTransitionEffects` to an existing item must also call
 * `endOpenRoundsOnClose` (or, for a state's delete, which moves every item of
 * the state, `endOpenRoundsInState`) in the same function, so in the same
 * transaction; and the subtree soft delete must call it too. The create paths
 * apply the effects to a new item, which has no round, and are named here.
 * The paths found are pinned, so a new one is a reviewed change.
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

/** Paths that apply the effects to an item being created: no round can be open. */
const CREATE_PATHS = new Set(['src/app-layer/usecases/work-item.ts#createWorkItemInTx', 'src/app-layer/usecases/work-item.ts#insertTemplateItemInTx']);

interface Path {
    at: string;
    ends: boolean;
}

function enclosing(node: ts.Node): ts.FunctionDeclaration | null {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) if (ts.isFunctionDeclaration(n) && n.name) return n;
    return null;
}

/** Every function that applies `stateTransitionEffects` or soft-deletes items, and whether it ends open rounds. */
function closePaths(root: string): Path[] {
    const out = new Map<string, Path>();
    for (const rel of gitFiles(root).filter((r) => r.startsWith('src/app-layer/usecases/') && r.endsWith('.ts'))) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node)) {
                const callee = node.expression.getText(sf);
                if (/\bstateTransitionEffects$/.test(callee) || callee === 'WorkItemRepository.softDelete') {
                    const fn = enclosing(node);
                    if (fn) {
                        const at = `${rel}#${fn.name!.text}`;
                        const body = fn.getText(sf);
                        out.set(at, { at, ends: /\bendOpenRounds(OnClose|InState)\(/.test(body) });
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return [...out.values()].filter((p) => !CREATE_PATHS.has(p.at)).sort((a, b) => (a.at < b.at ? -1 : 1));
}

describe('review rounds end on every close', () => {
    it('finds the state paths and the delete (the population is real)', () => {
        expect(closePaths(REPO_ROOT).map((p) => p.at)).toEqual([
            'src/app-layer/usecases/work-item-answer.ts#markWorkItemAnswer',
            'src/app-layer/usecases/work-item-moves.ts#moveWorkItemOnBoard',
            'src/app-layer/usecases/work-item-relations.ts#markDuplicateCancelled',
            'src/app-layer/usecases/work-item.ts#bulkSetWorkItemState',
            'src/app-layer/usecases/work-item.ts#setWorkItemState',
            'src/app-layer/usecases/work-item.ts#softDeleteSubtrees',
            'src/app-layer/usecases/workflow-state.ts#moveItemsBetweenStates',
        ]);
    });

    it('every one ends an open round in the same function', () => {
        expect(closePaths(REPO_ROOT).filter((p) => !p.ends).map((p) => p.at)).toEqual([]);
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-review-close-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        fs.mkdirSync(path.join(root, 'src/app-layer/usecases'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'src/app-layer/usecases/states.ts'),
            [
                'export async function forgetful(db, ctx, item, to) {',
                '    await WorkItemRepository.updateVersioned(db, ctx, v, item.id, 1, { ...stateTransitionEffects(item.stateCategory, to.category, item) });',
                '}',
                'export async function careful(db, ctx, item, to) {',
                '    const effects = stateTransitionEffects(item.stateCategory, to.category, item);',
                "    if (isClosedCategory(to.category)) await endOpenRoundsOnClose(db, ctx, [item.id], 'ITEM_CLOSED');",
                '}',
                'export async function bin(db, ctx, ids) {',
                '    await WorkItemRepository.softDelete(db, ctx, ids, "d", new Date());',
                '}',
            ].join('\n'),
        );
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('flags a state path and a delete that forget the open round', () => {
        expect(closePaths(root).filter((p) => !p.ends).map((p) => p.at)).toEqual(['src/app-layer/usecases/states.ts#bin', 'src/app-layer/usecases/states.ts#forgetful']);
        expect(closePaths(root).find((p) => p.at.endsWith('#careful'))?.ends).toBe(true);
    });
});
