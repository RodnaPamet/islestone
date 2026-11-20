/**
 * Side-effect ORDER of the intake accept (sub-phase 2.6a): the create path's
 * core (`createWorkItemInTx`: its audit, automation event and assignment
 * email, whose own order `work-item-sequence-order.test.ts` pins) runs INSIDE
 * the accept's transaction, with the request's claim, the requester's watch
 * and the accept's audit entry; after the COMMIT, the create's bells, then
 * the decision's automation event. A refused accept writes nothing.
 */
const events: string[] = [];

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: async (_ctx: unknown, cb: (db: unknown) => Promise<unknown>) => {
        events.push('tx:begin');
        const result = await cb({});
        events.push('tx:commit');
        return result;
    },
}));
jest.mock('@/app-layer/events/audit', () => ({
    logEvent: jest.fn(async (_db: unknown, _ctx: unknown, p: { action: string }) => {
        events.push(`audit:${p.action}`);
    }),
}));
jest.mock('@/app-layer/automation', () => ({
    emitAutomationEvent: jest.fn(async (_ctx: unknown, e: { event: string }) => {
        events.push(`automation:${e.event}`);
    }),
}));

const REQUEST = {
    id: 'r1',
    projectId: 'p1',
    channel: 'INTERNAL_FORM',
    formId: 'f1',
    status: 'PENDING',
    title: 'Please fix',
    requesterUserId: 'u-requester',
    snoozedUntil: null,
    decidedAt: null,
    declineReason: null,
    workItemId: null,
    mergedIntoWorkItemId: null,
    mergedIntoRequestId: null,
    version: 3,
    createdAt: new Date(),
    form: { name: 'Bugs', definitionJson: {}, definitionVersion: 1 },
    body: 'It broke',
    answersJson: null,
    formDefinitionVersion: 1,
    snoozedByUserId: null,
    decidedByUserId: null,
    declineExplanation: null,
    internalRemark: null,
};

let current: Record<string, unknown> = { ...REQUEST };
jest.mock('@/app-layer/repositories/IntakeRepository', () => ({
    INTAKE_LIST_ORDER: { column: 'createdAt', direction: 'desc', kind: 'date' },
    IntakeRepository: {
        getRequest: jest.fn(async () => current),
        lockRequest: jest.fn(async () => {
            events.push('lock:request');
            return true;
        }),
        claimAndUpdate: jest.fn(async (_db: unknown, _ctx: unknown, _id: string, from: string[], version: number) => {
            if (!from.includes(current.status as string) || version !== current.version) return 0;
            events.push('claim:accepted');
            current = { ...current, status: 'ACCEPTED', workItemId: 'w1', version: (current.version as number) + 1 };
            return 1;
        }),
        listMergedInto: jest.fn(async () => []),
        countMergedInto: jest.fn(async () => 0),
        // Sub-phase 2.6b: a confirmed public requester is told inside the transaction.
        listConfirmedRequesters: jest.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => {
            events.push(`read:confirmed:${ids.join(',')}`);
            return [{ id: 'r1', requesterEmail: 'outsider@example.com', form: { name: 'Bugs' } }];
        }),
    },
}));
jest.mock('@/app-layer/notifications/enqueue', () => ({
    enqueueEmail: jest.fn(async (_db: unknown, input: { type: string }) => {
        events.push(`email:${input.type}`);
        return { id: 'o1', dedupeKey: 'k' };
    }),
}));
jest.mock('@/app-layer/repositories/ProjectRepository', () => ({
    ProjectRepository: { getVisible: jest.fn(async () => ({ id: 'p1', teamId: 't1', keyPrefix: 'ISL', archivedAt: null, name: 'P' })) },
}));
jest.mock('@/app-layer/repositories/TeamRepository', () => ({ TeamRepository: { getState: jest.fn() } }));
jest.mock('@/app-layer/repositories/CustomFieldRepository', () => ({ CustomFieldRepository: { listFields: jest.fn(async () => []) } }));
jest.mock('@/app-layer/repositories/MembershipRepository', () => ({
    MembershipRepository: { listActiveUserIds: jest.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => new Set(ids)) },
}));
jest.mock('@/app-layer/repositories/WorkItemRepository', () => ({
    WorkItemRepository: { listByIds: jest.fn(async () => []) },
    WorkItemWatcherRepository: {
        add: jest.fn(async (_db: unknown, _ctx: unknown, _item: string, userId: string) => {
            events.push(`watch:${userId}`);
        }),
    },
}));
jest.mock('@/app-layer/usecases/work-item', () => ({
    createWorkItemInTx: jest.fn(async () => {
        events.push('create:in-tx');
        return { id: 'w1', key: 'ISL-1', title: 'Please fix', assigneeId: null, dueDate: null };
    }),
    emitCreatedItemBells: jest.fn(async () => {
        events.push('bells:create');
    }),
}));

import { acceptIntakeRequest } from '@/app-layer/usecases/intake-request';

import { makeRequestContext } from '../../helpers/make-context';

const ctx = makeRequestContext('MEMBER');

beforeEach(() => {
    events.length = 0;
    current = { ...REQUEST };
});

describe('intake accept side-effect order', () => {
    it('the create core, the claim, the watch and the audit inside the transaction; the bells and the decision after the commit', async () => {
        await acceptIntakeRequest(ctx, 'r1', { typeId: 'ty1' }, 3);
        expect(events).toEqual([
            'tx:begin',
            'lock:request',
            'create:in-tx',
            'claim:accepted',
            'read:confirmed:r1',
            'email:INTAKE_ACCEPTED',
            'watch:u-requester',
            'audit:INTAKE_REQUEST_ACCEPTED',
            'tx:commit',
            'bells:create',
            'automation:INTAKE_REQUEST_DECIDED',
        ]);
    });

    it('a stale version is a 409 that creates nothing and emits nothing', async () => {
        await expect(acceptIntakeRequest(ctx, 'r1', { typeId: 'ty1' }, 2)).rejects.toMatchObject({ status: 409 });
        expect(events).toEqual(['tx:begin', 'lock:request']);
    });

    it('an accept with no If-Match is a 428 before any transaction', async () => {
        await expect(acceptIntakeRequest(ctx, 'r1', { typeId: 'ty1' })).rejects.toMatchObject({ status: 428 });
        expect(events).toEqual([]);
    });

    it('a VIEWER is refused before any transaction', async () => {
        await expect(acceptIntakeRequest(makeRequestContext('VIEWER'), 'r1', { typeId: 'ty1' }, 3)).rejects.toMatchObject({ status: 403 });
        expect(events).toEqual([]);
    });
});
