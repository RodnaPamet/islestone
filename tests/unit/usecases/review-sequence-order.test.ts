/**
 * Side-effect ORDER of the review usecases (sub-phase 2.8a; the rule of
 * `work-item-sequence-order.test.ts` applied to reviews):
 *
 *   - send: the round opens and its first step opens inside the transaction,
 *     audited there; then COMMIT, then the review bells;
 *   - respond: the response and its audit entry inside, then the step is
 *     decided inside (the next step, the round's end, waiting on); then
 *     COMMIT, the review bells, then the watcher fan-out (which skips the
 *     people the bells reached).
 *
 * Nothing rings before the commit: a rolled-back response notifies nobody.
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
jest.mock('@/lib/audit', () => ({ appendAuditEntryOrQueue: jest.fn(async () => events.push('audit:AUTHZ_DENIED')) }));

const ITEM = {
    id: 'w1',
    number: 7,
    title: 'Item',
    projectId: 'p1',
    teamId: 't1',
    typeId: 'ty1',
    stateId: 's1',
    stateCategory: 'STARTED',
    assigneeId: 'u-assignee',
    waitingOnUserId: null,
    version: 3,
    project: { keyPrefix: 'ISL', archivedAt: null, deletedAt: null },
};
const reviewer = { id: 'r1', stepId: 'st1', roundId: 'rd1', workItemId: 'w1', userId: 'u-reviewer', viaRecipientListId: null, outcome: null, respondedAt: null, responseText: null, itemVersionAt: null, withdrawnAt: null, withdrawnReason: null, createdAt: new Date() };
const step = { id: 'st1', roundId: 'rd1', workItemId: 'w1', position: 1, name: 'Check', mode: 'ALL', dueInWorkingDays: 2, status: 'OPEN', openedAt: new Date(), dueOn: new Date(), endedAt: null, skippedByUserId: null, skipReason: null, lists: [], reviewers: [reviewer] };
let round: Record<string, unknown> = {};

jest.mock('@/app-layer/repositories/ReviewRepository', () => ({
    ReviewRepository: {
        lockItem: jest.fn(async () => undefined),
        liveRound: jest.fn(async () => round),
        listRounds: jest.fn(async () => [round]),
        stepOfItemExists: jest.fn(async () => true),
        recordResponse: jest.fn(async () => {
            events.push('write:response');
            return 1;
        }),
        updateRound: jest.fn(async () => 1),
    },
}));
jest.mock('@/app-layer/usecases/review-engine', () => ({
    eligibleReviewers: jest.fn(async () => ({ userIds: ['u-reviewer'], via: new Map(), dropped: [] })),
    clearWaitingOnForRound: jest.fn(async () => events.push('write:waiting-on')),
    openStepInTx: jest.fn(async () => {
        events.push('engine:open-step');
        return [{ item: { id: 'w1', title: 'Item', key: 'ISL-7' }, userIds: ['u-reviewer'], notice: { kind: 'requested', stepId: 'st1', stepName: 'Check' } }];
    }),
    settleStepInTx: jest.fn(async () => {
        events.push('engine:settle');
        return [{ item: { id: 'w1', title: 'Item', key: 'ISL-7' }, userIds: ['u-assignee'], notice: { kind: 'completed', roundId: 'rd1', roundNumber: 1 } }];
    }),
    planRoundAfterWithdrawal: jest.fn(),
    skipStepInTx: jest.fn(),
    withdrawRoundsInTx: jest.fn(),
}));
jest.mock('@/app-layer/usecases/work-item-shared', () => ({
    loadVisibleItem: jest.fn(async () => ITEM),
    loadWritableItem: jest.fn(async () => ITEM),
    preconditionRequired: jest.fn(),
    emitReviewNotices: jest.fn(async () => {
        events.push('bells:review');
        return ['u-assignee'];
    }),
    emitWatcherActivity: jest.fn(async (_ctx: unknown, evs: Array<{ skipUserIds?: string[] }>) => {
        events.push(`watchers:skip=${(evs[0]?.skipUserIds ?? []).join(',')}`);
    }),
}));

import { respondToReviewStep, sendWorkItemReview } from '@/app-layer/usecases/review';

import { makeRequestContext } from '../../helpers/make-context';

beforeEach(() => {
    events.length = 0;
});

describe('review side-effect order', () => {
    it('send: the round and its first step open inside, audited; then COMMIT, then the bells', async () => {
        round = { id: 'rd1', workItemId: 'w1', number: 1, status: 'PLANNED', startedByUserId: null, version: 1, steps: [step] };
        await sendWorkItemReview(makeRequestContext('MEMBER', { userId: 'u-sender', tenantId: 't' }), 'w1');
        const commit = events.indexOf('tx:commit');
        expect(events.slice(0, commit + 1)).toEqual(['tx:begin', 'write:waiting-on', 'engine:open-step', 'audit:WORK_ITEM_REVIEW_ROUND_STARTED', 'tx:commit']);
        expect(events.indexOf('bells:review')).toBeGreaterThan(commit);
    });

    it('respond: response and audit inside, the step decided inside; then COMMIT, the bells, then the watchers', async () => {
        round = { id: 'rd1', workItemId: 'w1', number: 1, status: 'OPEN', startedByUserId: 'u-sender', version: 2, steps: [step] };
        await respondToReviewStep(makeRequestContext('VIEWER', { userId: 'u-reviewer', tenantId: 't' }), 'w1', 'st1', { outcome: 'SIGNED_OFF' });
        expect(events.slice(0, 7)).toEqual([
            'tx:begin',
            'write:response',
            'audit:WORK_ITEM_REVIEW_RESPONDED',
            'engine:settle',
            'tx:commit',
            'bells:review',
            'watchers:skip=u-assignee',
        ]);
    });

    it("the assignee's response is refused and audited before anything is written or rung", async () => {
        round = { id: 'rd1', workItemId: 'w1', number: 1, status: 'OPEN', startedByUserId: 'u-sender', version: 2, steps: [step] };
        await expect(respondToReviewStep(makeRequestContext('MEMBER', { userId: 'u-assignee', tenantId: 't' }), 'w1', 'st1', { outcome: 'SIGNED_OFF' })).rejects.toMatchObject({ status: 403 });
        expect(events).toEqual(['tx:begin', 'audit:AUTHZ_DENIED']);
    });
});
