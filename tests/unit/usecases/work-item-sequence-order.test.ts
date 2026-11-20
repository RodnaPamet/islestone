/**
 * Side-effect ORDER of the work-item usecases. Each path keeps the order it
 * has in inflect-compliance (`usecases/task.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e), and the orders differ:
 *
 *   - create: audit, automation and the assignment email run INSIDE the
 *     transaction (the email is an outbox row that must commit with the
 *     item); the due bell and the assignment bell run after the COMMIT;
 *   - a state change, single or bulk: audit inside; then COMMIT, then the
 *     automation event, then the watcher fan-out;
 *   - waiting on (2.4b): audit inside; then COMMIT, then the bell to the
 *     person named, then the watcher fan-out;
 *   - marking an answer (2.4b-c): the answer's and the state change's audit
 *     inside; then COMMIT, the state change's automation and fan-out, then
 *     the watchers told the item was answered;
 *   - a mention (2.7d): the comment's or the edit's audit, then the mention's
 *     and the auto-watch's inside; then COMMIT, the mention bell, then the
 *     watcher fan-out (which skips the people just mentioned).
 *
 * Copied in shape from inflect-compliance's
 * `tests/unit/usecases/task-status-sequence-order.test.ts`, with the create
 * case the map asks for (no source test pinned create's order). The cache
 * bump and the reconcile steps are not ported.
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

const ITEM = {
    id: 'w1',
    number: 7,
    title: 'Item',
    projectId: 'p1',
    teamId: 't1',
    typeId: 'ty1',
    stateId: 's-todo',
    stateCategory: 'UNSTARTED',
    assigneeId: null,
    waitingOnUserId: null,
    parentId: null,
    sortKey: 'V',
    startedAt: null,
    dueDate: null,
    version: 1,
    deletedAt: null,
    deletionId: null,
    project: { keyPrefix: 'ISL', archivedAt: null, deletedAt: null },
};
const ROW = {
    ...ITEM,
    priority: 'NONE',
    startDate: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    labels: [],
};
const STATES: Record<string, object> = {
    's-todo': { id: 's-todo', teamId: 't1', name: 'Todo', category: 'UNSTARTED', archivedAt: null, isDefault: true },
    's-doing': { id: 's-doing', teamId: 't1', name: 'In progress', category: 'STARTED', archivedAt: null, isDefault: false },
    's-done': { id: 's-done', teamId: 't1', name: 'Done', category: 'DONE', archivedAt: null, isDefault: false },
};
/** The field set's rows (2.4b-b); a test that marks an answer shows it on the item's type. */
const fieldSetRows: object[] = [];

jest.mock('@/app-layer/repositories/ProjectRepository', () => ({
    ProjectRepository: {
        getVisible: jest.fn(async () => ({ id: 'p1', teamId: 't1', keyPrefix: 'ISL', archivedAt: null })),
        claimNumber: jest.fn(async () => 7),
        projectIdForPrefix: jest.fn(async () => null),
    },
}));
jest.mock('@/app-layer/repositories/WorkItemTypeRepository', () => ({
    WorkItemTypeRepository: { getById: jest.fn(async () => ({ id: 'ty1', name: 'Bug', archivedAt: null })) },
}));
jest.mock('@/app-layer/repositories/TeamRepository', () => ({
    TeamRepository: {
        getState: jest.fn(async (_db: unknown, _ctx: unknown, id: string) => STATES[id]),
        defaultState: jest.fn(async () => STATES['s-todo']),
        liveStatesOfTeams: jest.fn(async () => Object.values(STATES)),
        listStates: jest.fn(async () => Object.values(STATES)),
    },
}));
jest.mock('@/app-layer/repositories/MembershipRepository', () => ({
    MembershipRepository: {
        listActiveUserIds: jest.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => new Set(ids)),
        activeMembershipsWithRoles: jest.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => ids.map((userId) => ({ userId, role: 'MEMBER', customRole: null }))),
        contactsOf: jest.fn(async () => []),
    },
}));
jest.mock('@/app-layer/repositories/LabelRepository', () => ({ LabelRepository: { attach: jest.fn(), getMany: jest.fn(async () => []) } }));
// The field set (2.4b-b): no entries, no project fields.
jest.mock('@/app-layer/repositories/FieldSetRepository', () => ({ FieldSetRepository: { listForTypesInProject: jest.fn(async () => fieldSetRows) } }));
jest.mock('@/app-layer/repositories/CustomFieldRepository', () => ({ CustomFieldRepository: { listFields: jest.fn(async () => []) } }));
// Mentions (2.7d): nobody recorded before; adds and removes succeed.
jest.mock('@/app-layer/repositories/MentionRepository', () => ({
    MentionRepository: {
        listForSource: jest.fn(async () => new Set()),
        listForComments: jest.fn(async () => []),
        add: jest.fn(async (_db: unknown, _ctx: unknown, _s: unknown, ids: string[]) => ({ count: ids.length })),
        remove: jest.fn(async () => ({ count: 0 })),
        removeForComment: jest.fn(async () => ({ count: 0 })),
    },
}));
jest.mock('@/app-layer/repositories/WorkItemRepository', () => ({
    LIST_ORDERS: { manual: { column: 'sortKey', direction: 'asc', kind: 'string' } },
    CommentRepository: {
        get: jest.fn(async (_db: unknown, _ctx: unknown, workItemId: string, id: string) => ({ id, workItemId, authorUserId: 'u2', createdAt: new Date() })),
        getWithBody: jest.fn(async () => null),
        create: jest.fn(async (_db: unknown, _ctx: unknown, workItemId: string, body: string) => ({ id: 'c-new', workItemId, authorUserId: 'u1', body, editedAt: null, createdAt: new Date() })),
        edit: jest.fn(async () => ({ count: 1 })),
    },
    WorkItemWatcherRepository: {
        addMany: jest.fn(async (_db: unknown, _ctx: unknown, _id: string, ids: string[]) => ids),
    },
    WorkItemRepository: {
        lastSortKey: jest.fn(async () => null),
        create: jest.fn(async (_db: unknown, _ctx: unknown, data: { waitingOnUserId?: string | null }) => ({ ...ROW, assigneeId: 'u-assignee', dueDate: new Date(), waitingOnUserId: data.waitingOnUserId ?? null })),
        getById: jest.fn(async () => ({ ...ROW, description: null, createdByUserId: 'u1', state: {}, type: {}, parent: null, labels: [], _count: { subItems: 0, comments: 0, watchers: 0 } })),
        updateVersioned: jest.fn(async () => 1),
        listByIds: jest.fn(async () => [{ ...ITEM, type: { name: 'Bug' } }]),
        bulkUpdate: jest.fn(async () => 1),
    },
}));
jest.mock('@/app-layer/usecases/work-item-shared', () => {
    const actual = jest.requireActual('@/app-layer/usecases/work-item-shared');
    return {
        ...actual,
        loadWritableItem: jest.fn(async () => ITEM),
        enqueueAssignedEmail: jest.fn(async () => {
            events.push('email:enqueued');
        }),
        emitDueBell: jest.fn(async () => {
            events.push('bell:due');
        }),
        emitAssignedBells: jest.fn(async () => {
            events.push('bell:assigned');
        }),
        emitWaitingOnBell: jest.fn(async (_ctx: unknown, userId: string | null) => {
            if (userId) events.push('bell:waiting-on');
        }),
        emitWatcherActivity: jest.fn(async (_ctx: unknown, e: Array<{ skipUserIds?: string[] }>) => {
            events.push(e[0]?.skipUserIds?.length ? `watchers:fan-out(skip ${e[0].skipUserIds.join(',')})` : 'watchers:fan-out');
        }),
        emitMentionBells: jest.fn(async (_ctx: unknown, _item: unknown, _source: unknown, userIds: string[]) => {
            if (userIds.length > 0) events.push(`bell:mentioned(${userIds.join(',')})`);
        }),
    };
});

import { bulkSetWorkItemState, createWorkItem, setWorkItemState, setWorkItemWaitingOn, updateWorkItem } from '@/app-layer/usecases/work-item';
import { addComment, editComment } from '@/app-layer/usecases/work-item-collab';
import { markWorkItemAnswer } from '@/app-layer/usecases/work-item-answer';

import { makeRequestContext } from '../../helpers/make-context';

const ctx = makeRequestContext('OWNER');

beforeEach(() => {
    events.length = 0;
    fieldSetRows.length = 0;
});

describe('work-item side-effect order', () => {
    it('create: audit, automation and the email inside the transaction; the bells after the commit', async () => {
        await createWorkItem(ctx, { projectId: 'p1', typeId: 'ty1', title: 'New', assigneeId: 'u-assignee', dueDate: '2030-01-01' });
        expect(events).toEqual([
            'tx:begin',
            'audit:WORK_ITEM_CREATED',
            'automation:WORK_ITEM_CREATED',
            'email:enqueued',
            'tx:commit',
            'bell:due',
            'bell:assigned',
        ]);
    });

    it('a state change: audit inside; then COMMIT, automation, watchers', async () => {
        await setWorkItemState(ctx, 'w1', { stateId: 's-doing' });
        const tail = events.slice(0, events.indexOf('watchers:fan-out') + 1);
        expect(tail).toEqual(['tx:begin', 'audit:WORK_ITEM_STATE_CHANGED', 'tx:commit', 'automation:WORK_ITEM_STATE_CHANGED', 'watchers:fan-out']);
    });

    it('a bulk state change keeps the same order', async () => {
        await bulkSetWorkItemState(ctx, { workItemIds: ['w1'], stateId: 's-doing' });
        expect(events).toEqual(['tx:begin', 'audit:WORK_ITEM_STATE_CHANGED', 'tx:commit', 'automation:WORK_ITEM_STATE_CHANGED', 'watchers:fan-out']);
    });

    it('waiting on: audit inside; then COMMIT, the bell to the person named, the due reminder (2.7a), watchers', async () => {
        await setWorkItemWaitingOn(ctx, 'w1', { userId: 'u-other' });
        const firstCommit = events.indexOf('tx:commit');
        expect(events.slice(0, firstCommit + 1)).toEqual(['tx:begin', 'audit:WORK_ITEM_WAITING_ON_CHANGED', 'tx:commit']);
        expect(events.filter((e) => e.startsWith('bell:') || e.startsWith('watchers:'))).toEqual(['bell:waiting-on', 'bell:due', 'watchers:fan-out']);
        expect(events.indexOf('bell:waiting-on')).toBeGreaterThan(firstCommit);
    });

    it('clearing who an item waits on rings no due reminder', async () => {
        const before = ITEM.waitingOnUserId;
        (ITEM as { waitingOnUserId: string | null }).waitingOnUserId = 'u-other';
        try {
            await setWorkItemWaitingOn(ctx, 'w1', { userId: null });
        } finally {
            (ITEM as { waitingOnUserId: string | null }).waitingOnUserId = before;
        }
        expect(events).toContain('watchers:fan-out');
        expect(events).not.toContain('bell:due');
    });

    it('a create naming who it waits on rings that bell after the commit, last', async () => {
        await createWorkItem(ctx, { projectId: 'p1', typeId: 'ty1', title: 'New', waitingOnUserId: 'u-other' });
        expect(events.slice(events.indexOf('tx:commit'))).toEqual(['tx:commit', 'bell:due', 'bell:assigned', 'bell:waiting-on']);
    });

    it('marking an answer: both audits inside; then COMMIT, the state change\'s automation and fan-out, then "answered"', async () => {
        fieldSetRows.push({ typeId: 'ty1', projectId: null, builtInField: 'answer', customFieldId: null, requirement: 'OPTIONAL' });
        await markWorkItemAnswer(ctx, 'w1', { commentId: 'c1' });
        expect(events).toEqual([
            'tx:begin',
            'audit:WORK_ITEM_ANSWER_MARKED',
            'audit:WORK_ITEM_STATE_CHANGED',
            'tx:commit',
            'automation:WORK_ITEM_STATE_CHANGED',
            'watchers:fan-out',
            'tx:begin',
            'tx:commit',
            'watchers:fan-out',
        ]);
    });

    it('a comment mentioning someone: its audits inside; then COMMIT, the mention bell, then the watchers without them', async () => {
        await addComment(ctx, 'w1', { body: 'Can you look, <@u-ada>?' });
        expect(events).toEqual([
            'tx:begin',
            'audit:COMMENT_ADDED',
            'audit:WORK_ITEM_MENTIONED',
            'audit:WORK_ITEM_WATCHER_ADDED',
            'tx:commit',
            'bell:mentioned(u-ada)',
            'watchers:fan-out(skip u-ada)',
        ]);
    });

    it('a comment edit adding a mention: audits inside; then COMMIT, the mention bell', async () => {
        // The mocked comment's author is u2: only they edit it.
        const own = { ...ctx, userId: 'u2' };
        await editComment(own, 'w1', 'c1', { body: 'Also <@u-bob>' });
        expect(events).toEqual(['tx:begin', 'audit:COMMENT_EDITED', 'audit:WORK_ITEM_MENTIONED', 'audit:WORK_ITEM_WATCHER_ADDED', 'tx:commit', 'bell:mentioned(u-bob)']);
    });

    it('a description edit mentioning someone: audits inside; then COMMIT, the mention bell', async () => {
        await updateWorkItem(ctx, 'w1', { description: 'For <@u-ada>' }, 1);
        const commit = events.indexOf('tx:commit');
        expect(events.slice(0, commit + 1)).toEqual(['tx:begin', 'audit:WORK_ITEM_UPDATED', 'audit:WORK_ITEM_MENTIONED', 'audit:WORK_ITEM_WATCHER_ADDED', 'tx:commit']);
        expect(events.filter((e) => e.startsWith('bell:'))).toEqual(['bell:mentioned(u-ada)']);
        expect(events.indexOf('bell:mentioned(u-ada)')).toBeGreaterThan(commit);
    });

    it('a create whose description mentions someone rings them after the commit, last', async () => {
        await createWorkItem(ctx, { projectId: 'p1', typeId: 'ty1', title: 'New', description: 'Ask <@u-ada>' });
        expect(events).toEqual([
            'tx:begin',
            'audit:WORK_ITEM_CREATED',
            'audit:WORK_ITEM_MENTIONED',
            'audit:WORK_ITEM_WATCHER_ADDED',
            'automation:WORK_ITEM_CREATED',
            'email:enqueued',
            'tx:commit',
            'bell:due',
            'bell:assigned',
            'bell:mentioned(u-ada)',
        ]);
    });

    it('the author mentioning themselves records the mention and rings nobody', async () => {
        await addComment(ctx, 'w1', { body: `Note to self <@${ctx.userId}>` });
        expect(events).toEqual(['tx:begin', 'audit:COMMENT_ADDED', 'audit:WORK_ITEM_MENTIONED', 'tx:commit', 'watchers:fan-out']);
    });

    it('a refused transition writes nothing and emits nothing', async () => {
        await expect(setWorkItemState(ctx, 'w1', { stateId: 's-todo' })).rejects.toMatchObject({ status: 400 });
        expect(events).toEqual(['tx:begin']);
    });
});
