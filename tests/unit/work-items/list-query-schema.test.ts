/**
 * The work-item list query's My Work filters (owner decision 54): the schema
 * the route parses, the `where` the repository builds from it, and the
 * client's placement rule for an optimistic row.
 *
 * `watching` takes only `me`, which the repository reads from the request
 * context: a user id in the query is refused, so no caller can list another
 * person's watched items. `due=soon` is open items due within
 * `DUE_SOON_DAYS` of the workspace's today, overdue included.
 */
import { WorkItemRepository } from '@/app-layer/repositories/WorkItemRepository';
import { DUE_SOON_DAYS } from '@/app-layer/domain/work-item-due';
import type { ProjectVisibility } from '@/app-layer/policies/project-visibility';
import { rowBelongs } from '@/components/work-items/data/list-filters';
import { WorkItemQuerySchema } from '@/lib/schemas/work-item';

import type { WorkItemRow } from '@/lib/work-items/types';

import { makeRequestContext } from '../../helpers/make-context';

const ctx = makeRequestContext('MEMBER', { tenantId: 'tenant-1', userId: 'u-me' });
const ALL: ProjectVisibility = { kind: 'ALL' };

function row(n: number, over: Partial<WorkItemRow> = {}): WorkItemRow {
    return {
        id: `wi-${n}`,
        key: `ISL-${n}`,
        number: n,
        title: `Item ${n}`,
        projectId: 'p1',
        teamId: 't1',
        typeId: 'ty1',
        stateId: 's1',
        stateCategory: 'UNSTARTED',
        priority: 'NONE',
        assigneeId: null,
        createdByUserId: 'u-ada',
        parentId: null,
        sortKey: `a${n}`,
        startDate: null,
        dueDate: null,
        version: 1,
        labelIds: [],
        customFields: {},
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        ...over,
    };
}

describe('WorkItemQuerySchema — the My Work filters', () => {
    it('accepts createdById, watching=me and due=soon', () => {
        expect(WorkItemQuerySchema.parse({ createdById: 'u-1,u-2', watching: 'me', due: 'soon' })).toEqual({
            createdById: 'u-1,u-2',
            watching: 'me',
            due: 'soon',
        });
    });

    it('keeps the earlier due windows', () => {
        expect(WorkItemQuerySchema.parse({ due: 'overdue' }).due).toBe('overdue');
        expect(WorkItemQuerySchema.parse({ due: 'next7d' }).due).toBe('next7d');
    });

    it('refuses a user id, or anything but me, as the watching filter', () => {
        expect(WorkItemQuerySchema.safeParse({ watching: 'u-someone-else' }).success).toBe(false);
        expect(WorkItemQuerySchema.safeParse({ watching: '' }).success).toBe(false);
        expect(WorkItemQuerySchema.safeParse({ watching: 'ME' }).success).toBe(false);
    });

    it('refuses an unknown due window', () => {
        expect(WorkItemQuerySchema.safeParse({ due: 'next30d' }).success).toBe(false);
    });
});

describe('WorkItemRepository._buildWhere — the My Work filters', () => {
    const today = new Date('2026-11-20T00:00:00.000Z');
    const and = (filters: Parameters<typeof WorkItemRepository._buildWhere>[2]) =>
        WorkItemRepository._buildWhere(ctx, ALL, filters, null, today).AND as Array<Record<string, unknown>>;

    it('watching=me is the CALLER from the request context, in the caller\'s workspace', () => {
        expect(and({ watching: 'me' })).toContainEqual({ watchers: { some: { tenantId: 'tenant-1', userId: 'u-me' } } });
    });

    it('refuses a watching value other than me even past the schema', () => {
        expect(() => and({ watching: 'u-other' as 'me' })).toThrow(/watching/);
    });

    it('createdById filters the creator, one or several', () => {
        expect(and({ createdById: 'u-1' })).toContainEqual({ createdByUserId: 'u-1' });
        expect(and({ createdById: 'u-1,u-2' })).toContainEqual({ createdByUserId: { in: ['u-1', 'u-2'] } });
    });

    it('due=soon is open items due on or before today + DUE_SOON_DAYS, overdue included (no lower bound)', () => {
        const clause = and({ due: 'soon' }).find((c) => 'dueDate' in c)!;
        expect(clause).toEqual({
            dueDate: { lte: new Date(Date.UTC(2026, 10, 20 + DUE_SOON_DAYS)) },
            stateCategory: { in: ['BACKLOG', 'UNSTARTED', 'STARTED'] },
        });
    });

    it('the tenant and the live-row predicates stay on the where', () => {
        const where = WorkItemRepository._buildWhere(ctx, ALL, { watching: 'me', createdById: 'u-1', due: 'soon' }, null, today);
        expect(where).toMatchObject({ tenantId: 'tenant-1', deletedAt: null });
    });
});

describe('rowBelongs — the My Work filters on the client', () => {
    it('decides createdById from the row', () => {
        expect(rowBelongs({ createdById: 'u-ada' }, row(1, { createdByUserId: 'u-ada' }))).toBe('yes');
        expect(rowBelongs({ createdById: 'u-ada' }, row(1, { createdByUserId: 'u-bob' }))).toBe('no');
    });

    it('cannot decide watching on the client', () => {
        expect(rowBelongs({ watching: 'me' }, row(1))).toBe('unknown');
        // …but another facet can still rule a row out.
        expect(rowBelongs({ watching: 'me', assigneeId: 'u-ada' }, row(1, { assigneeId: 'u-bob' }))).toBe('no');
    });
});
