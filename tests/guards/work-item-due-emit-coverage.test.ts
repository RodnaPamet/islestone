/**
 * The due-date reminder is emitted AFTER the work-item transaction commits,
 * in a transaction of its own, fire-and-forget, at every write that can put
 * an item on a reminder window for its assignee or the person it waits on:
 * create, a due-date edit, an assignment (sub-phase 2.2; owner decision
 * 2026-11-18, "In 2.2") and naming who it waits on (2.7a; decision 137).
 *
 * Inside the transaction it would roll the item back on a notification
 * failure, and a bell published before the commit can name an item that
 * never existed.
 *
 * Copied in shape from inflect-compliance `tests/guards/notif-task-due-emit-coverage.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e; the detector is proved on
 * planted source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { emittedAfterCommit } from '../helpers/emit-order';
import { functionBodyOf } from '../helpers/source-blocks';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
const USECASES = read('src/app-layer/usecases/work-item.ts');
const SHARED = read('src/app-layer/usecases/work-item-shared.ts');

describe('the due reminder is emitted after the commit', () => {
    it.each(['updateWorkItem', 'assignWorkItem', 'bulkSetWorkItemDueDate', 'setWorkItemWaitingOn'])('%s', (name) => {
        expect(emittedAfterCommit(functionBodyOf(USECASES, name), 'emitDueBell')).toEqual({ called: true, insideTransaction: false });
    });

    it('the create core rings no bell; the intake accept rings the create bells after its commit (2.6a)', () => {
        expect(functionBodyOf(USECASES, 'createWorkItemInTx')).not.toMatch(/\bemitDueBell\s*\(/);
        expect(functionBodyOf(USECASES, 'emitCreatedItemBells')).toMatch(/\bemitDueBell\s*\(/);
        const accept = functionBodyOf(read('src/app-layer/usecases/intake-request.ts'), 'acceptIntakeRequest');
        expect(emittedAfterCommit(accept, 'emitCreatedItemBells')).toEqual({ called: true, insideTransaction: false });
    });

    it('the repeat job rings the create bells after its commit (2.5d)', () => {
        const run = functionBodyOf(read('src/app-layer/usecases/recurrence-run.ts'), 'runRecurrenceRule');
        expect(emittedAfterCommit(run, 'emitCreatedItemBells')).toEqual({ called: true, insideTransaction: false });
    });

    it('emitDueBell runs in its own transaction and swallows its errors', () => {
        const body = functionBodyOf(SHARED, 'emitDueBell');
        expect(body).toMatch(/\btry\s*\{[\s\S]{0,400}?runInTenantContext\(/);
        expect(body).toMatch(/\bcatch\s*\(err\)\s*\{[\s\S]{0,200}?logger\.warn\(/);
        expect(body).toMatch(/createWorkItemDueNotification\(/);
    });

    it('the detector flags an emit inside the transaction (planted)', () => {
        const planted = 'async function f() { await runInTenantContext(ctx, async (db) => { await emitDueBell(ctx, item); }); }';
        expect(emittedAfterCommit(functionBodyOf(planted, 'f'), 'emitDueBell')).toEqual({ called: true, insideTransaction: true });
    });
});
