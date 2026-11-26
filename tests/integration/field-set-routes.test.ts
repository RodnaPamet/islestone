/**
 * Required fields at the route (H2 part 4; `docs/porting/maps/H2.md`; owner
 * decisions 109 to 111 and 149): a caller of the API who skips the form gets
 * the same refusals the form would, from the usecase, through every HTTP
 * write that could leave a type's required field empty, set a hidden one, or
 * close an item a review still holds.
 *
 * `field-sets.test.ts` and `review-defaults.test.ts` drive the usecases;
 * this table drives the ROUTE HANDLERS, as the OWNER (whom no permission
 * refuses), with bodies no form would send:
 *
 *   - a type with every configurable built-in field REQUIRED (the answer
 *     cannot be, by CHECK) and one required custom field: every create
 *     without one of them, every write that empties one, a type change onto
 *     it, an intake accept and a create from a template that lack them, each
 *     400 `FIELD_SET_UNMET` naming the field in `details.fields`;
 *   - a type with every built-in field and the custom field HIDDEN: every
 *     write that sets one, 400 `FIELD_HIDDEN` naming it (the answer
 *     included: it is hidden unless a type shows it);
 *   - a type that requires a completed review for Done (2.8c): every state
 *     path into Done through HTTP (single, bulk, board move, answer), 409
 *     `REVIEW_INCOMPLETE`;
 *   - after every refusal the row is unchanged (its version, and the count of
 *     items for a create);
 *   - a forcing check: every entry of `CONFIGURABLE_BUILT_IN_FIELDS` has at
 *     least one row naming it, so a new configurable field needs its row.
 *
 * Only NextAuth's cookie decode (`auth()`) and the job queue are replaced.
 */
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';

import { DB_AVAILABLE } from './db-helper';

const mockAuth = jest.fn();
jest.mock('@/auth', () => ({ auth: () => mockAuth() }));
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: async () => ({ id: 'field-set-routes-job' }),
    getQueue: () => ({ getJob: async () => null }),
}));

import type { RequestContext } from '@/app-layer/types';
import { createCustomField } from '@/app-layer/usecases/custom-field';
import { createCycle } from '@/app-layer/usecases/cycle';
import { setProjectTypeField, setTypeField } from '@/app-layer/usecases/field-set';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createLabel } from '@/app-layer/usecases/label';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createGoal } from '@/app-layer/usecases/goal';
import { createProject } from '@/app-layer/usecases/project';
import { setTypeReviewSteps } from '@/app-layer/usecases/review-defaults';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { addComment } from '@/app-layer/usecases/work-item-collab';
import { createWorkItemTemplate } from '@/app-layer/usecases/work-item-template';
import { createWorkItemType } from '@/app-layer/usecases/work-item-type';
import { verifyAuditChain } from '@/lib/audit';
import { CONFIGURABLE_BUILT_IN_FIELDS, type BuiltInField } from '@/lib/work-items/field-sets';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `fsr${Date.now().toString(36)}`;
const T = 'src/app/api/t/[tenantSlug]';

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Fixture = 'strict' | 'hiding' | 'plain' | 'request' | 'held' | 'heldQuestion';
type Ids = Record<string, string>;

interface Row {
    readonly name: string;
    readonly route: string;
    readonly method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    /** The subject made fresh for the row; a create row names none (it counts the project's items instead). */
    readonly fixture?: Fixture;
    readonly params: (i: Ids) => Record<string, string>;
    readonly body?: (i: Ids) => unknown;
    readonly ifMatch?: (i: Ids) => string;
    readonly expect: { status: 400; reason: 'FIELD_SET_UNMET' | 'FIELD_HIDDEN'; fields: readonly string[] } | { status: 409; reason: 'REVIEW_INCOMPLETE' };
}

const STRICT_FIELDS: readonly BuiltInField[] = ['description', 'assignee', 'waitingOn', 'priority', 'labels', 'startDate', 'dueDate', 'cycle', 'milestone', 'goal'];
const unmet = (...fields: string[]) => ({ status: 400 as const, reason: 'FIELD_SET_UNMET' as const, fields });
const hidden = (...fields: string[]) => ({ status: 400 as const, reason: 'FIELD_HIDDEN' as const, fields });
const held = { status: 409 as const, reason: 'REVIEW_INCOMPLETE' as const };
const item = (i: Ids) => ({ workItemId: i.item! });

/** A complete create of the strict type, minus the named fields. */
function strictCreate(i: Ids, without: readonly string[]): Record<string, unknown> {
    const all: Record<string, unknown> = {
        projectId: i.project,
        typeId: i.strictType,
        title: `strict ${Math.random()}`,
        description: 'every field given',
        assigneeId: i.ann,
        waitingOnUserId: i.ann,
        priority: 'HIGH',
        labelIds: [i.label],
        startDate: '2049-02-01',
        dueDate: '2049-02-10',
        cycleId: i.cycle,
        milestoneId: i.milestone,
        goalId: i.goal,
        customFields: { [i.field!]: 7 },
    };
    const key: Record<string, string> = {
        description: 'description',
        assignee: 'assigneeId',
        waitingOn: 'waitingOnUserId',
        priority: 'priority',
        labels: 'labelIds',
        startDate: 'startDate',
        dueDate: 'dueDate',
        cycle: 'cycleId',
        milestone: 'milestoneId',
        goal: 'goalId',
    };
    for (const f of without) {
        if (f === 'custom') delete all.customFields;
        else delete all[key[f]!];
    }
    return all;
}

const W = `${T}/work-items/[workItemId]`;
const ROWS: readonly Row[] = [
    // ── A create without each required field ──
    ...[...STRICT_FIELDS, 'custom'].map(
        (f): Row => ({
            name: `POST /work-items without ${f}`,
            route: `${T}/work-items/route.ts`,
            method: 'POST',
            params: () => ({}),
            body: (i) => strictCreate(i, [f]),
            expect: unmet(f === 'custom' ? 'cf' : f),
        }),
    ),
    { name: 'POST /work-items from a template that gives none of them', route: `${T}/work-items/route.ts`, method: 'POST', params: () => ({}), body: (i) => ({ projectId: i.project, templateId: i.template }), expect: unmet(...STRICT_FIELDS, 'cf') },
    // ── A write that empties one ──
    { name: 'PATCH /work-items/:id clearing the description', route: `${W}/route.ts`, method: 'PATCH', fixture: 'strict', params: item, ifMatch: (i) => i.version!, body: () => ({ description: null }), expect: unmet('description') },
    { name: 'PATCH /work-items/:id setting priority to NONE', route: `${W}/route.ts`, method: 'PATCH', fixture: 'strict', params: item, body: () => ({ priority: 'NONE' }), expect: unmet('priority') },
    { name: 'PATCH /work-items/:id clearing the start date', route: `${W}/route.ts`, method: 'PATCH', fixture: 'strict', params: item, body: () => ({ startDate: null }), expect: unmet('startDate') },
    { name: 'PATCH /work-items/:id clearing the due date', route: `${W}/route.ts`, method: 'PATCH', fixture: 'strict', params: item, body: () => ({ dueDate: null }), expect: unmet('dueDate') },
    { name: 'PATCH /work-items/:id changing a bare item onto the strict type', route: `${W}/route.ts`, method: 'PATCH', fixture: 'plain', params: item, body: (i) => ({ typeId: i.strictType }), expect: unmet(...STRICT_FIELDS, 'cf') },
    { name: 'POST /work-items/:id/assign to nobody', route: `${W}/assign/route.ts`, method: 'POST', fixture: 'strict', params: item, body: () => ({ assigneeId: null }), expect: unmet('assignee') },
    { name: 'POST /work-items/bulk/assign to nobody', route: `${T}/work-items/bulk/assign/route.ts`, method: 'POST', fixture: 'strict', params: () => ({}), body: (i) => ({ workItemIds: [i.item], assigneeId: null }), expect: unmet('assignee') },
    { name: 'POST /work-items/bulk/due to no date', route: `${T}/work-items/bulk/due/route.ts`, method: 'POST', fixture: 'strict', params: () => ({}), body: (i) => ({ workItemIds: [i.item], dueDate: null }), expect: unmet('dueDate') },
    {
        name: 'POST /work-items/bulk/dates clearing the due date (3.1c)', route: `${T}/work-items/bulk/dates/route.ts`, method: 'POST', fixture: 'strict', params: () => ({}),
        body: (i) => ({ dragged: { id: i.item, version: Number(i.version), startDate: '2049-02-01', dueDate: null }, pushed: [] }),
        expect: unmet('dueDate'),
    },
    { name: 'PUT /work-items/:id/waiting-on to nobody', route: `${W}/waiting-on/route.ts`, method: 'PUT', fixture: 'strict', params: item, body: () => ({ userId: null }), expect: unmet('waitingOn') },
    { name: 'PUT /work-items/:id/cycle to none', route: `${W}/cycle/route.ts`, method: 'PUT', fixture: 'strict', params: item, body: () => ({ cycleId: null }), expect: unmet('cycle') },
    { name: 'PUT /work-items/:id/milestone to none', route: `${W}/milestone/route.ts`, method: 'PUT', fixture: 'strict', params: item, body: () => ({ milestoneId: null }), expect: unmet('milestone') },
    { name: 'PUT /work-items/:id/goal to none (3.2a)', route: `${W}/goal/route.ts`, method: 'PUT', fixture: 'strict', params: item, body: () => ({ goalId: null }), expect: unmet('goal') },
    { name: 'DELETE /work-items/:id/labels/:labelId, the last label', route: `${W}/labels/[labelId]/route.ts`, method: 'DELETE', fixture: 'strict', params: (i) => ({ workItemId: i.item!, labelId: i.label! }), expect: unmet('labels') },
    { name: 'PUT /work-items/:id/custom-fields/:fieldId to empty', route: `${W}/custom-fields/[fieldId]/route.ts`, method: 'PUT', fixture: 'strict', params: (i) => ({ workItemId: i.item!, fieldId: i.field! }), body: () => ({ value: null }), expect: unmet('cf') },
    {
        name: 'POST /intake/requests/:id/accept onto the strict type, giving none of them', route: `${T}/intake/requests/[requestId]/accept/route.ts`, method: 'POST', fixture: 'request',
        params: (i) => ({ requestId: i.request! }), ifMatch: (i) => i.version!, body: (i) => ({ typeId: i.strictType }),
        // The request carries no text, so its description is missing too.
        expect: unmet(...STRICT_FIELDS, 'cf'),
    },
    // ── A write that sets a hidden field ──
    ...([
        ['description', { description: 'hidden text' }],
        ['assignee', { assigneeId: 'ANN' }],
        ['waitingOn', { waitingOnUserId: 'ANN' }],
        ['priority', { priority: 'HIGH' }],
        ['labels', { labelIds: ['LABEL'] }],
        ['startDate', { startDate: '2049-02-01' }],
        ['dueDate', { dueDate: '2049-02-10' }],
        ['cycle', { cycleId: 'CYCLE' }],
        ['milestone', { milestoneId: 'MILESTONE' }],
        ['goal', { goalId: 'GOAL' }],
        ['cf', { customFields: { FIELD: 7 } }],
    ] as const).map(
        ([f, extra]): Row => ({
            name: `POST /work-items of the hiding type naming ${f}`,
            route: `${T}/work-items/route.ts`,
            method: 'POST',
            params: () => ({}),
            body: (i) => ({ projectId: i.project, typeId: i.hidingType, title: `hiding ${Math.random()}`, ...resolve(extra, i) }),
            expect: hidden(f),
        }),
    ),
    { name: 'PATCH /work-items/:id setting a hidden due date', route: `${W}/route.ts`, method: 'PATCH', fixture: 'hiding', params: item, body: () => ({ dueDate: '2049-03-01' }), expect: hidden('dueDate') },
    {
        name: 'POST /work-items/bulk/dates setting a hidden start date (3.1c)', route: `${T}/work-items/bulk/dates/route.ts`, method: 'POST', fixture: 'hiding', params: () => ({}),
        body: (i) => ({ dragged: { id: i.item, version: Number(i.version), startDate: '2049-03-01', dueDate: null }, pushed: [] }),
        expect: hidden('startDate'),
    },
    { name: 'POST /work-items/:id/assign on the hiding type', route: `${W}/assign/route.ts`, method: 'POST', fixture: 'hiding', params: item, body: (i) => ({ assigneeId: i.ann }), expect: hidden('assignee') },
    { name: 'PUT /work-items/:id/waiting-on on the hiding type', route: `${W}/waiting-on/route.ts`, method: 'PUT', fixture: 'hiding', params: item, body: (i) => ({ userId: i.ann }), expect: hidden('waitingOn') },
    { name: 'PUT /work-items/:id/cycle on the hiding type', route: `${W}/cycle/route.ts`, method: 'PUT', fixture: 'hiding', params: item, body: (i) => ({ cycleId: i.cycle }), expect: hidden('cycle') },
    { name: 'PUT /work-items/:id/milestone on the hiding type', route: `${W}/milestone/route.ts`, method: 'PUT', fixture: 'hiding', params: item, body: (i) => ({ milestoneId: i.milestone }), expect: hidden('milestone') },
    { name: 'PUT /work-items/:id/goal on the hiding type (3.2a)', route: `${W}/goal/route.ts`, method: 'PUT', fixture: 'hiding', params: item, body: (i) => ({ goalId: i.goal }), expect: hidden('goal') },
    { name: 'POST /work-items/:id/labels on the hiding type', route: `${W}/labels/route.ts`, method: 'POST', fixture: 'hiding', params: item, body: (i) => ({ labelIds: [i.label] }), expect: hidden('labels') },
    { name: 'PUT /work-items/:id/custom-fields/:fieldId on the hiding type', route: `${W}/custom-fields/[fieldId]/route.ts`, method: 'PUT', fixture: 'hiding', params: (i) => ({ workItemId: i.item!, fieldId: i.field! }), body: () => ({ value: 7 }), expect: hidden('cf') },
    { name: 'PUT /work-items/:id/answer on a type that hides the answer', route: `${W}/answer/route.ts`, method: 'PUT', fixture: 'hiding', params: item, body: (i) => ({ commentId: i.comment }), expect: hidden('answer') },
    // ── Every HTTP state path into Done, while a required review has not completed (2.8c) ──
    { name: 'POST /work-items/:id/state into Done', route: `${W}/state/route.ts`, method: 'POST', fixture: 'held', params: item, body: (i) => ({ stateId: i.doneState }), expect: held },
    { name: 'POST /work-items/bulk/state into Done', route: `${T}/work-items/bulk/state/route.ts`, method: 'POST', fixture: 'held', params: () => ({}), body: (i) => ({ workItemIds: [i.item], stateCategory: 'DONE' }), expect: held },
    { name: 'POST /work-items/:id/move dropped in the Done column', route: `${W}/move/route.ts`, method: 'POST', fixture: 'held', params: item, body: (i) => ({ stateId: i.doneState, position: { afterId: i.anchor } }), expect: held },
    { name: 'PUT /work-items/:id/answer, which moves the item to Done', route: `${W}/answer/route.ts`, method: 'PUT', fixture: 'heldQuestion', params: item, body: (i) => ({ commentId: i.comment }), expect: held },
];

/** Placeholders in a hidden-field body, filled from the world. */
function resolve(extra: Record<string, unknown>, i: Ids): Record<string, unknown> {
    const map: Record<string, string> = { ANN: i.ann!, LABEL: i.label!, CYCLE: i.cycle!, MILESTONE: i.milestone!, GOAL: i.goal!, FIELD: i.field! };
    return JSON.parse(JSON.stringify(extra).replace(/"(ANN|LABEL|CYCLE|MILESTONE|GOAL|FIELD)"/g, (_m, k: string) => JSON.stringify(map[k]))) as Record<string, unknown>;
}

describeFn('required and hidden fields, and the Done check, at the route (H2 part 4)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let ownerId = '';
    const w: Ids = {};
    let owner: RequestContext;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (who: string, role: 'OWNER' | 'MEMBER') => {
            const u = await prisma.user.create({ data: { email: `${who}-${TAG}@example.test`, name: who } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return u.id;
        };
        ownerId = await mk('owner', 'OWNER');
        w.ann = await mk('ann', 'MEMBER');
        w.rae = await mk('rae', 'MEMBER');
        owner = makeRequestContext('OWNER', { tenantId, tenantSlug: TAG, userId: ownerId, requestId: `${TAG}-setup` });

        const team = await createTeam(owner, { name: 'Fields' });
        const project = await createProject(owner, { teamId: team.id, name: 'Fields', keyPrefix: 'FLD' });
        w.project = project.id;
        w.doneState = team.workflowStates.find((s) => s.category === 'DONE')!.id;
        w.label = (await createLabel(owner, { name: 'fields label' })).id;
        w.cycle = (await createCycle(owner, { teamId: team.id, startsOn: '2049-01-04', endsOn: '2049-03-28' })).id;
        w.milestone = (await createMilestone(owner, project.id, { name: 'Fields milestone' })).id;
        w.goal = (await createGoal(owner, { title: 'Fields goal' })).id;
        w.field = (await createCustomField(owner, project.id, { name: 'Effort', type: 'NUMBER' })).id;

        w.strictType = (await createWorkItemType(owner, { name: 'Strict' })).id;
        w.hidingType = (await createWorkItemType(owner, { name: 'Hiding' })).id;
        w.plainType = (await createWorkItemType(owner, { name: 'Plain' })).id;
        w.reviewedType = (await createWorkItemType(owner, { name: 'Reviewed' })).id;
        w.reviewedQuestionType = (await createWorkItemType(owner, { name: 'Reviewed question' })).id;
        for (const f of STRICT_FIELDS) {
            await setTypeField(owner, w.strictType, { field: f, requirement: 'REQUIRED' });
            await setTypeField(owner, w.hidingType, { field: f, requirement: 'HIDDEN' });
        }
        await setProjectTypeField(owner, project.id, { typeId: w.strictType, customFieldId: w.field, requirement: 'REQUIRED' });
        await setProjectTypeField(owner, project.id, { typeId: w.hidingType, customFieldId: w.field, requirement: 'HIDDEN' });
        await setTypeField(owner, w.reviewedQuestionType, { field: 'answer', requirement: 'OPTIONAL' });
        const steps = [{ name: 'Check', mode: 'ALL' as const, dueInWorkingDays: 2, memberIds: [w.rae], recipientListIds: [] }];
        await setTypeReviewSteps(owner, w.reviewedType, { reviewRequiredForDone: true, steps });
        await setTypeReviewSteps(owner, w.reviewedQuestionType, { reviewRequiredForDone: true, steps });

        w.template = (await createWorkItemTemplate(owner, project.id, { name: 'Bare', title: 'From a bare template', typeId: w.strictType })).id;
        w.anchor = (await createWorkItem(owner, { projectId: project.id, typeId: w.plainType, title: 'an anchor' })).id;
        await setProjectIntake(owner, project.id, { enabled: true });
        w.form = (await createIntakeForm(owner, { projectId: project.id, name: 'Fields form', definition: { fields: [] }, published: true })).id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    async function fixture(f: Fixture | undefined): Promise<Ids> {
        const i: Ids = { ...w };
        if (!f) return i;
        if (f === 'request') {
            const r = await sendIntakeRequest(makeRequestContext('MEMBER', { tenantId, tenantSlug: TAG, userId: w.ann! }), w.form!, { title: 'Please', answers: {} });
            return { ...i, request: r.id, version: String(r.version) };
        }
        const typeId = { strict: w.strictType, hiding: w.hidingType, plain: w.plainType, held: w.reviewedType, heldQuestion: w.reviewedQuestionType }[f]!;
        const made = await createWorkItem(owner, f === 'strict' ? (strictCreate({ ...w, strictType: typeId }, []) as never) : { projectId: w.project!, typeId, title: `${f} ${Math.random()}` });
        const comment = await addComment(owner, made.id, { body: 'a reply' });
        return { ...i, item: made.id, version: String(made.version), comment: comment.id };
    }

    /** What a refusal must leave as it was. */
    async function state(i: Ids): Promise<unknown> {
        const items = await prisma.workItem.count({ where: { tenantId } });
        const row = i.item ? await prisma.workItem.findUnique({ where: { id: i.item }, select: { version: true, stateId: true, typeId: true } }) : null;
        const req = i.request ? await prisma.intakeRequest.findUnique({ where: { id: i.request }, select: { status: true, version: true } }) : null;
        return { items, row, req };
    }

    it('every configurable built-in field has a row naming it (a new field needs its row)', () => {
        const named = new Set(ROWS.flatMap((r) => ('fields' in r.expect ? r.expect.fields : [])));
        expect(CONFIGURABLE_BUILT_IN_FIELDS.filter((f) => !named.has(f))).toEqual([]);
        expect(named.has('cf')).toBe(true);
    });

    it.each(ROWS.map((r) => [r.name, r] as const))('%s', async (_n, row) => {
        const i = await fixture(row.fixture);
        const before = await state(i);
        mockAuth.mockImplementation(async () => ({
            user: { id: ownerId, email: `owner-${TAG}@example.test`, name: 'owner', image: null, role: 'OWNER', tenantId, memberships: [{ slug: TAG, role: 'OWNER', tenantId }], orgMemberships: [], mfaPendingTenantIds: [] },
            expires: new Date(Date.now() + 3_600_000).toISOString(),
        }));
        const params = { tenantSlug: TAG, ...row.params(i) };
        const path = row.route.replace(`${T}/`, '').replace(/\/?route\.ts$/, '').replace(/\[(\w+)\]/g, (_m, k: string) => params[k as keyof typeof params]!);
        const body = row.body?.(i);
        const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '10.0.4.4', 'sec-fetch-site': 'same-origin' };
        if (row.ifMatch) headers['if-match'] = `"${row.ifMatch(i)}"`;
        const mod = (await import(`../../${row.route}`)) as Record<string, Handler>;
        const res = await mod[row.method]!(new NextRequest(`http://localhost/api/t/${TAG}/${path}`, { method: row.method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve(params) });
        const json = (await res.json()) as { error?: { details?: { reason?: string; fields?: string[] } } };
        const fields = (json.error?.details?.fields ?? []).map((k) => (k.startsWith('cf:') ? 'cf' : k)).sort();
        expect({ status: res.status, reason: json.error?.details?.reason, ...('fields' in row.expect ? { fields } : {}) }).toEqual({
            status: row.expect.status,
            reason: row.expect.reason,
            ...('fields' in row.expect ? { fields: [...row.expect.fields].sort() } : {}),
        });
        expect(await state(i)).toEqual(before);
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
