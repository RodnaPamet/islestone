/**
 * What the item's review section offers (sub-phase 2.8b; owner decisions 150,
 * 158 and 160): `reviewAffordances`, the server's answer the detail renders.
 * A component never restates these; this is where they are held.
 */
import { reviewAffordances } from '@/app-layer/policies/review.policies';

import { makeRequestContext } from '../../helpers/make-context';

const open = { assigneeId: 'u-mia', closed: false, projectArchived: false };
const round = (status: string, over: Partial<{ startedByUserId: string | null; stepCount: number; openStep: { id: string; namesViewer: boolean } | null }> = {}) => ({
    status,
    startedByUserId: 'u-olive',
    stepCount: 2,
    openStep: null,
    ...over,
});

describe('reviewAffordances', () => {
    it('lets anyone who edits work items plan steps, live round or none, and a new round after one ended', () => {
        const member = makeRequestContext('MEMBER', { userId: 'u-max' });
        expect(reviewAffordances(member, open, null).editSteps).toBe(true);
        expect(reviewAffordances(member, open, round('PLANNED')).editSteps).toBe(true);
        expect(reviewAffordances(member, open, round('OPEN')).editSteps).toBe(true);
        // 2.8b: with no live round a PUT plans a new one, so the section offers it.
        for (const ended of ['COMPLETED', 'RETURNED', 'WITHDRAWN']) expect(reviewAffordances(member, open, round(ended)).editSteps).toBe(true);
    });

    it('offers no write to a viewer or on an archived project', () => {
        const viewer = makeRequestContext('VIEWER', { userId: 'u-vic' });
        expect(reviewAffordances(viewer, open, round('PLANNED'))).toMatchObject({ editSteps: false, send: false, withdraw: false, skip: false });
        const owner = makeRequestContext('OWNER', { userId: 'u-olive' });
        expect(reviewAffordances(owner, { ...open, projectArchived: true }, round('OPEN'))).toMatchObject({ editSteps: false, withdraw: false, skip: false });
    });

    it('sends a planned round with steps on an open item only, and withdraws an open one', () => {
        const member = makeRequestContext('MEMBER', { userId: 'u-max' });
        expect(reviewAffordances(member, open, round('PLANNED')).send).toBe(true);
        expect(reviewAffordances(member, open, round('PLANNED', { stepCount: 0 })).send).toBe(false);
        expect(reviewAffordances(member, { ...open, closed: true }, round('PLANNED')).send).toBe(false);
        expect(reviewAffordances(member, open, round('OPEN')).withdraw).toBe(true);
        expect(reviewAffordances(member, open, round('PLANNED')).withdraw).toBe(false);
    });

    it('lets the assignee, the sender or an admin skip (decision 150), nobody else', () => {
        const opened = round('OPEN');
        expect(reviewAffordances(makeRequestContext('MEMBER', { userId: 'u-mia' }), open, opened).skip).toBe(true);
        expect(reviewAffordances(makeRequestContext('MEMBER', { userId: 'u-olive' }), open, opened).skip).toBe(true);
        expect(reviewAffordances(makeRequestContext('ADMIN', { userId: 'u-ada' }), open, opened).skip).toBe(true);
        expect(reviewAffordances(makeRequestContext('MEMBER', { userId: 'u-max' }), open, opened).skip).toBe(false);
    });

    it('offers a response to a named reviewer, a Viewer included, never the assignee (decision 158)', () => {
        const opened = round('OPEN', { openStep: { id: 'st-1', namesViewer: true } });
        expect(reviewAffordances(makeRequestContext('VIEWER', { userId: 'u-vic' }), open, opened).respondStepId).toBe('st-1');
        expect(reviewAffordances(makeRequestContext('MEMBER', { userId: 'u-mia' }), open, opened).respondStepId).toBeNull();
        expect(reviewAffordances(makeRequestContext('MEMBER', { userId: 'u-max' }), open, round('OPEN', { openStep: { id: 'st-1', namesViewer: false } })).respondStepId).toBeNull();
        expect(reviewAffordances(makeRequestContext('MEMBER', { userId: 'u-max', apiKeyId: 'k-1' }), open, opened).respondStepId).toBeNull();
    });
});
