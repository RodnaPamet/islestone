/**
 * The workflow-state check is wired into BOTH state paths, and the audit
 * entries carry the real from/to states (sub-phase 2.2).
 *
 * `setWorkItemState` and `bulkSetWorkItemState` must each ask
 * `checkWorkflowStateTransition` and apply `stateTransitionEffects` before
 * they write, and record the change through `applyStateAudit`, whose
 * `detailsJson` names `fromStateId`/`toStateId` and both categories. A path
 * that wrote the state without the check would accept a state of another
 * team or an archived one; without the effects, `completedAt` and friends
 * would drift from the state.
 *
 * Copied in shape from inflect-compliance `tests/guardrails/task-status-machine-wiring.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (the bundle-freeze describe
 * dropped); the detector is proved on planted source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { functionBodyOf } from '../helpers/source-blocks';

const SRC = readFileSync(path.resolve(__dirname, '../../src/app-layer/usecases/work-item.ts'), 'utf8');

/** What a state path must call, in this order: the check, the effects, the audit. */
export function wiringOf(body: string) {
    const check = body.search(/\bcheckWorkflowStateTransition\s*\(/);
    const effects = body.search(/\bstateTransitionEffects\s*\(/);
    const audit = body.search(/\bapplyStateAudit\s*\(/);
    return { check: check >= 0, effects: effects >= 0, audit: audit >= 0, ordered: check >= 0 && check < effects && effects < audit };
}

describe('the state paths ask the transition check', () => {
    it.each(['setWorkItemState', 'bulkSetWorkItemState'])('%s: check, then effects, then the audit', (name) => {
        expect(wiringOf(functionBodyOf(SRC, name))).toEqual({ check: true, effects: true, audit: true, ordered: true });
    });

    it('the audit entry carries the real from/to states and categories', () => {
        const body = functionBodyOf(SRC, 'applyStateAudit');
        for (const field of ['fromStateId: from.id', 'toStateId: to.id', 'fromCategory: from.category', 'toCategory: to.category']) {
            expect({ field, present: body.includes(field) }).toEqual({ field, present: true });
        }
        expect(body).toMatch(/action:\s*'WORK_ITEM_STATE_CHANGED'/);
    });

    it('the detector flags a path that writes without the check (planted)', () => {
        const planted = 'async function x() { const e = stateTransitionEffects(a, b, c); await applyStateAudit(db, ctx, i, a, b); }';
        expect(wiringOf(planted)).toEqual({ check: false, effects: true, audit: true, ordered: false });
        // A mention in a comment is not a call: functionBodyOf masks comments.
        const commented = 'function y() {\n // checkWorkflowStateTransition(from, to)\n stateTransitionEffects(a, b, c); applyStateAudit(); }';
        expect(wiringOf(functionBodyOf(commented, 'y')).check).toBe(false);
    });
});
