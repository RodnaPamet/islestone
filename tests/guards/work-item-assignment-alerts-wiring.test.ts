/**
 * Assignment alerts are wired end to end (sub-phase 2.2):
 *
 *   1. the schema and a migration carry `WORK_ITEM_ASSIGNED` in both the
 *      bell and the email enums;
 *   2. the bell writer asks the workspace's mute list before it writes and
 *      writes with `createMany({ skipDuplicates })`;
 *   3. the work-item usecases wire it: the outbox email INSIDE the
 *      transaction (it commits with the assignment), the bell AFTER it, at
 *      create, assign and bulk assign.
 *
 * Copied in shape from inflect-compliance `tests/guards/notif-assignment-alerts-wiring.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (describes 1–3; the control,
 * risk and asset describes are not ported); the detector is proved on
 * planted source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { codeOf, functionBodyOf } from '../helpers/source-blocks';
import { gitFiles } from '../helpers/git-files';

import { emittedAfterCommit } from '../helpers/emit-order';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('1. the enums carry WORK_ITEM_ASSIGNED', () => {
    it('in the schema, for the bell and the email', () => {
        const enums = codeOf(read('prisma/schema/enums.prisma'));
        expect(enums).toMatch(/enum NotificationType \{[^}]*\bWORK_ITEM_ASSIGNED\b/);
        expect(enums).toMatch(/enum EmailNotificationType \{[^}]*\bWORK_ITEM_ASSIGNED\b/);
    });

    it('in a migration', () => {
        const migrations = gitFiles(ROOT).filter((f) => f.startsWith('prisma/migrations/') && f.endsWith('.sql'));
        expect(migrations.some((f) => /'WORK_ITEM_ASSIGNED'/.test(read(f)))).toBe(true);
    });
});

describe('2. the bell writer', () => {
    it('asks the mute list first and writes idempotently', () => {
        const body = functionBodyOf(read('src/app-layer/notifications/assignment.ts'), 'createAssignmentNotification');
        const mute = body.search(/\bisInAppTypeEnabled\s*\(/);
        const write = body.search(/\.notification\.createMany\s*\(/);
        expect(mute).toBeGreaterThanOrEqual(0);
        expect(mute).toBeLessThan(write);
        expect(body).toMatch(/skipDuplicates:\s*true/);
    });
});

describe('3. the work-item usecases wire it', () => {
    const src = read('src/app-layer/usecases/work-item.ts');

    it.each(['createWorkItem', 'assignWorkItem', 'bulkAssignWorkItems'])('%s: the email inside the transaction, the bell after it', (name) => {
        const body = functionBodyOf(src, name);
        expect(emittedAfterCommit(body, 'emitAssignedBells')).toEqual({ called: true, insideTransaction: false });
        expect(emittedAfterCommit(body, 'enqueueAssignedEmail')).toEqual({ called: true, insideTransaction: true });
    });

    it('the detector tells a bell inside the transaction from one after it (planted)', () => {
        const planted = 'async function g() { await runInTenantContext(ctx, async () => { await emitAssignedBells(ctx, u, []); }); }';
        expect(emittedAfterCommit(functionBodyOf(planted, 'g'), 'emitAssignedBells').insideTransaction).toBe(true);
    });
});
