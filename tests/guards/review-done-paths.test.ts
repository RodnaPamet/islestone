/**
 * Every state path into Done asks the item's review first (sub-phase 2.8c;
 * ADR 0009 §14; owner decision 149): a type may require its review to finish
 * before Done.
 *
 * A function under `src/app-layer/usecases/` that applies
 * `stateTransitionEffects` must also call `assertReviewAllowsDone` (or, for a
 * state's delete, which moves every item of the state,
 * `assertReviewAllowsDoneInState`) in the same function, so before its write
 * in the same transaction. The two create paths apply the effects to a new
 * item and are covered by `copyTypeReviewDefaultsInTx`, which refuses a
 * create into Done that the defaults it copies would hold. A path that only
 * ever cancels is never held and is named in `CANCEL_ONLY` with its reason.
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

/** Paths whose only move is into CANCELLED, which the check never holds. */
const CANCEL_ONLY = new Map([['src/app-layer/usecases/work-item-relations.ts#markDuplicateCancelled', 'marking a duplicate cancels the item: it never moves into Done']]);

interface Path {
    at: string;
    asks: boolean;
}

function enclosing(node: ts.Node): ts.FunctionDeclaration | null {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) if (ts.isFunctionDeclaration(n) && n.name) return n;
    return null;
}

/** Every function that applies `stateTransitionEffects`, and whether it asks the Done check. */
function statePaths(root: string, cancelOnly: ReadonlyMap<string, string> = CANCEL_ONLY): Path[] {
    const out = new Map<string, Path>();
    for (const rel of gitFiles(root).filter((r) => r.startsWith('src/app-layer/usecases/') && r.endsWith('.ts'))) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && /\bstateTransitionEffects$/.test(node.expression.getText(sf))) {
                const fn = enclosing(node);
                if (fn) {
                    const at = `${rel}#${fn.name!.text}`;
                    out.set(at, { at, asks: /\b(assertReviewAllowsDone|assertReviewAllowsDoneInState|copyTypeReviewDefaultsInTx)\(/.test(fn.getText(sf)) });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return [...out.values()].filter((p) => !cancelOnly.has(p.at)).sort((a, b) => (a.at < b.at ? -1 : 1));
}

describe('every state path into Done asks the review first', () => {
    it('finds the state paths (the population is real)', () => {
        expect(statePaths(REPO_ROOT).map((p) => p.at)).toEqual([
            'src/app-layer/usecases/work-item-answer.ts#markWorkItemAnswer',
            'src/app-layer/usecases/work-item-moves.ts#moveWorkItemOnBoard',
            'src/app-layer/usecases/work-item.ts#bulkSetWorkItemState',
            'src/app-layer/usecases/work-item.ts#createWorkItemInTx',
            'src/app-layer/usecases/work-item.ts#insertTemplateItemInTx',
            'src/app-layer/usecases/work-item.ts#setWorkItemState',
            'src/app-layer/usecases/workflow-state.ts#moveItemsBetweenStates',
        ]);
    });

    it('every one asks the Done check in the same function', () => {
        expect(statePaths(REPO_ROOT).filter((p) => !p.asks).map((p) => p.at)).toEqual([]);
    });

    it('every cancel-only path still exists (no stale entry)', () => {
        const all = statePaths(REPO_ROOT, new Map()).map((p) => p.at);
        for (const at of CANCEL_ONLY.keys()) expect(all).toContain(at);
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-review-done-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        fs.mkdirSync(path.join(root, 'src/app-layer/usecases'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'src/app-layer/usecases/states.ts'),
            [
                'export async function forgetful(db, ctx, item, from, to) {',
                '    await WorkItemRepository.updateVersioned(db, ctx, v, item.id, 1, { ...stateTransitionEffects(from.category, to.category, item) });',
                '}',
                'export async function careful(db, ctx, item, from, to) {',
                '    await assertReviewAllowsDone(db, ctx, [{ item, fromCategory: from.category, toCategory: to.category }]);',
                '    const effects = stateTransitionEffects(from.category, to.category, item);',
                '}',
            ].join('\n'),
        );
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('flags a state path that forgets the check', () => {
        expect(statePaths(root).filter((p) => !p.asks).map((p) => p.at)).toEqual(['src/app-layer/usecases/states.ts#forgetful']);
        expect(statePaths(root).find((p) => p.at.endsWith('#careful'))?.asks).toBe(true);
    });
});
