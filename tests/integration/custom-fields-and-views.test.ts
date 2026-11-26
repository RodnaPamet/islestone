/**
 * Custom fields and saved views against a real Postgres, as `app_user`
 * (sub-phase 2.4; docs/porting/maps/2.4.md):
 *
 *   - the SQL constructs bite: one typed column, the checkbox and text CHECKs,
 *     the two partial uniques, the project lock (a value on another
 *     project's item, a move that keeps values) and the priority-rank trigger;
 *   - value writes per type, the version bump and the 409, archived and
 *     foreign options, a non-member person, an unsafe URL, the option-in-use
 *     refusal, and a member's removal clearing their person values;
 *   - the list filtered and sorted by a field and by every named sort, paged
 *     with no repeat or gap and empty values last;
 *   - saved views: who sees, saves, changes and deletes what;
 *   - every write audited, and the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import {
    addCustomFieldOption,
    createCustomField,
    deleteCustomFieldOption,
    listCustomFields,
    setWorkItemCustomFieldValue,
    updateCustomField,
    updateCustomFieldOption,
} from '@/app-layer/usecases/custom-field';
import { createProject } from '@/app-layer/usecases/project';
import { createSavedView, deleteSavedView, getSavedView, listSavedViews, updateSavedView } from '@/app-layer/usecases/saved-view';
import { createTeam } from '@/app-layer/usecases/team';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, getWorkItem, listWorkItems, updateWorkItem } from '@/app-layer/usecases/work-item';
import { moveWorkItemToProject } from '@/app-layer/usecases/work-item-moves';
import { verifyAuditChain } from '@/lib/audit';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `cfsv${Date.now().toString(36)}`;

type Dto = Awaited<ReturnType<typeof createCustomField>>;

describeFn('custom fields and saved views', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let member2: RequestContext;
    let viewer: RequestContext;
    let member2UserId = '';
    let teamId = '';
    let projectId = '';
    let otherProjectId = '';
    let typeId = '';
    const f = {} as Record<'stage' | 'tags' | 'size' | 'when' | 'note' | 'site' | 'done' | 'who', Dto>;

    const newItem = (title: string, extra: Partial<Parameters<typeof createWorkItem>[1]> = {}) =>
        createWorkItem(owner, { projectId, typeId, title, ...extra });
    const opt = (field: Dto, name: string) => field.options.find((o) => o.name === name)!.id;
    const allKeys = async (query: Parameters<typeof listWorkItems>[1], limit = 2) => {
        const keys: string[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 50; page += 1) {
            const res = await listWorkItems(owner, { projectId, ...query, limit, cursor });
            keys.push(...res.items.map((i) => i.title));
            if (!res.pageInfo.hasNextPage) break;
            cursor = res.pageInfo.nextCursor;
        }
        return keys;
    };

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (role: 'OWNER' | 'MEMBER' | 'VIEWER', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return { id: u.id, ctx: makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` }) };
        };
        owner = (await mk('OWNER', 'olive')).ctx;
        member = (await mk('MEMBER', 'max')).ctx;
        const m2 = await mk('MEMBER', 'mia');
        member2 = m2.ctx;
        member2UserId = m2.id;
        viewer = (await mk('VIEWER', 'vic')).ctx;
        const team = await createTeam(owner, { name: 'Core' });
        teamId = team.id;
        projectId = (await createProject(owner, { teamId, name: 'Fields', keyPrefix: 'FLD' })).id;
        otherProjectId = (await createProject(owner, { teamId, name: 'Other', keyPrefix: 'OTH' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        f.stage = await createCustomField(member, projectId, { name: 'Stage', type: 'SELECT', options: [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }] });
        f.tags = await createCustomField(owner, projectId, { name: 'Tags', type: 'MULTI_SELECT', options: [{ name: 'red' }, { name: 'blue' }] });
        f.size = await createCustomField(owner, projectId, { name: 'Size', type: 'NUMBER' });
        f.when = await createCustomField(owner, projectId, { name: 'When', type: 'DATE' });
        f.note = await createCustomField(owner, projectId, { name: 'Note', type: 'TEXT' });
        f.site = await createCustomField(owner, projectId, { name: 'Site', type: 'URL' });
        f.done = await createCustomField(owner, projectId, { name: 'Done', type: 'CHECKBOX' });
        f.who = await createCustomField(owner, projectId, { name: 'Who', type: 'PERSON' });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('definitions', () => {
        it('lists a project\'s fields in order; a VIEWER may read but not define', async () => {
            const listed = await listCustomFields(viewer, projectId);
            expect(listed.map((x) => x.name)).toEqual(['Stage', 'Tags', 'Size', 'When', 'Note', 'Site', 'Done', 'Who']);
            await expect(createCustomField(viewer, projectId, { name: 'Nope', type: 'TEXT' })).rejects.toMatchObject({ status: 403 });
        });

        it('refuses a duplicate name, a select with no options and options on a number', async () => {
            await expect(createCustomField(owner, projectId, { name: 'Stage', type: 'TEXT' })).rejects.toMatchObject({ status: 409 });
            await expect(createCustomField(owner, projectId, { name: 'Empty', type: 'SELECT' })).rejects.toMatchObject({ status: 400 });
            await expect(createCustomField(owner, projectId, { name: 'Bad', type: 'NUMBER', options: [{ name: 'x' }] })).rejects.toMatchObject({ status: 400 });
        });

        it('reorders, archives and unarchives a field; the name is sanitised', async () => {
            const field = await createCustomField(owner, projectId, { name: '<b>Temp</b>', type: 'TEXT' });
            expect(field.name).not.toContain('<b>');
            const moved = await updateCustomField(owner, projectId, field.id, { position: { beforeId: f.stage.id } });
            expect((await listCustomFields(owner, projectId)).map((x) => x.id)[0]).toBe(moved.id);
            await updateCustomField(owner, projectId, field.id, { archived: true });
            expect((await listCustomFields(owner, projectId)).map((x) => x.id)).not.toContain(field.id);
            expect((await listCustomFields(owner, projectId, { includeArchived: true })).find((x) => x.id === field.id)?.archived).toBe(true);
        });
    });

    describe('values', () => {
        it('writes each type, folds the values into the row, and increases the version each time', async () => {
            const item = await newItem('typed');
            let v = item.version;
            const set = async (field: Dto, value: unknown) => {
                const after = await setWorkItemCustomFieldValue(member, item.id, field.id, value);
                expect(after.version).toBe(v + 1);
                v = after.version;
                return after;
            };
            await set(f.stage, opt(f.stage, 'Beta'));
            await set(f.tags, [opt(f.tags, 'red'), opt(f.tags, 'blue'), opt(f.tags, 'red')]);
            await set(f.size, 12.5);
            await set(f.when, '2031-02-03');
            await set(f.note, 'line one\nline two');
            await set(f.site, 'https://example.com/a');
            await set(f.done, true);
            const last = await set(f.who, member2UserId);
            expect(last.customFields).toEqual({
                [f.stage.id]: opt(f.stage, 'Beta'),
                [f.tags.id]: expect.arrayContaining([opt(f.tags, 'red'), opt(f.tags, 'blue')]),
                [f.size.id]: 12.5,
                [f.when.id]: '2031-02-03',
                [f.note.id]: 'line one line two',
                [f.site.id]: 'https://example.com/a',
                [f.done.id]: true,
                [f.who.id]: member2UserId,
            });
            expect((last.customFields[f.tags.id] as string[]).length).toBe(2);
            const cleared = await set(f.done, false);
            expect(cleared.customFields[f.done.id]).toBeUndefined();
        });

        it('a stale If-Match is a 409 carrying the current row; a VIEWER is refused', async () => {
            const item = await newItem('versioned');
            await expect(setWorkItemCustomFieldValue(owner, item.id, f.size.id, 1, item.version + 5)).rejects.toMatchObject({
                status: 409,
                details: expect.objectContaining({ reason: 'VERSION_CONFLICT', version: item.version }),
            });
            await expect(setWorkItemCustomFieldValue(viewer, item.id, f.size.id, 1)).rejects.toMatchObject({ status: 403 });
            expect((await setWorkItemCustomFieldValue(owner, item.id, f.size.id, 1, item.version)).version).toBe(item.version + 1);
        });

        it('refuses another field\'s option, an archived option newly picked, a non-member, an unsafe URL and a bad number', async () => {
            const item = await newItem('refusals');
            await expect(setWorkItemCustomFieldValue(owner, item.id, f.stage.id, opt(f.tags, 'red'))).rejects.toMatchObject({ status: 400 });
            const gamma = opt(f.stage, 'Gamma');
            await setWorkItemCustomFieldValue(owner, item.id, f.stage.id, gamma);
            await updateCustomFieldOption(owner, projectId, f.stage.id, gamma, { archived: true });
            // Held already: re-writing it stands; a new item cannot pick it.
            await expect(setWorkItemCustomFieldValue(owner, item.id, f.stage.id, gamma)).resolves.toBeTruthy();
            const fresh = await newItem('refusals 2');
            await expect(setWorkItemCustomFieldValue(owner, fresh.id, f.stage.id, gamma)).rejects.toMatchObject({ status: 400 });
            await updateCustomFieldOption(owner, projectId, f.stage.id, gamma, { archived: false });
            await expect(setWorkItemCustomFieldValue(owner, item.id, f.who.id, 'not-a-member')).rejects.toMatchObject({ status: 400 });
            await expect(setWorkItemCustomFieldValue(owner, item.id, f.site.id, 'javascript:alert(1)')).rejects.toMatchObject({ status: 400 });
            await expect(setWorkItemCustomFieldValue(owner, item.id, f.size.id, '1e3')).rejects.toMatchObject({ status: 400 });
            await expect(setWorkItemCustomFieldValue(owner, item.id, f.size.id, 1_000_000_000)).rejects.toMatchObject({ status: 400 });
            // A field of another project is not this item's.
            const foreign = await createCustomField(owner, otherProjectId, { name: 'Elsewhere', type: 'TEXT' });
            await expect(setWorkItemCustomFieldValue(owner, item.id, foreign.id, 'x')).rejects.toMatchObject({ status: 404 });
        });

        it('an option in use is not deleted (409 OPTION_IN_USE); an unused one is', async () => {
            const item = await newItem('in use');
            const withOpt = await addCustomFieldOption(owner, projectId, f.stage.id, { name: 'Delta' });
            const delta = opt(withOpt, 'Delta');
            await setWorkItemCustomFieldValue(owner, item.id, f.stage.id, delta);
            await expect(deleteCustomFieldOption(owner, projectId, f.stage.id, delta)).rejects.toMatchObject({
                status: 409,
                details: expect.objectContaining({ reason: 'OPTION_IN_USE' }),
            });
            const spare = opt(await addCustomFieldOption(owner, projectId, f.stage.id, { name: 'Spare' }), 'Spare');
            await expect(deleteCustomFieldOption(owner, projectId, f.stage.id, spare)).resolves.toEqual({ deleted: true });
        });

        it('create takes customFields; a move to another project drops the values, and the FK refuses keeping them', async () => {
            const item = await newItem('mover', { customFields: { [f.note.id]: 'carried', [f.size.id]: 3 } });
            expect(item.customFields).toEqual({ [f.note.id]: 'carried', [f.size.id]: 3 });
            // Bypassing the usecase, the database itself refuses the move.
            await expect(prisma.workItem.update({ where: { id: item.id }, data: { projectId: otherProjectId, number: 900 } })).rejects.toThrow();
            const moved = await moveWorkItemToProject(owner, item.id, { projectId: otherProjectId });
            expect(moved.item.customFields).toEqual({});
            expect(await prisma.customFieldValue.count({ where: { workItemId: item.id } })).toBe(0);
        });

        it('removing a member clears their person values and increases those items\' versions', async () => {
            const u = await prisma.user.create({ data: { email: `leaver-${TAG}@example.test` } });
            const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'MEMBER' } });
            const item = await newItem('person');
            const set = await setWorkItemCustomFieldValue(owner, item.id, f.who.id, u.id);
            await removeTenantMember(owner, { membershipId: membership.id });
            const after = await getWorkItem(owner, item.id);
            expect(after.customFields[f.who.id]).toBeUndefined();
            expect(after.version).toBe(set.version + 1);
        });
    });

    describe('SQL constructs', () => {
        it('one typed column, checkbox true only, the text cap and the partial uniques bite', async () => {
            const item = await newItem('constructs');
            const base = { tenantId, projectId, workItemId: item.id };
            await expect(prisma.customFieldValue.create({ data: { ...base, fieldId: f.note.id, fieldType: 'TEXT', numberValue: '1' } })).rejects.toThrow();
            await expect(prisma.customFieldValue.create({ data: { ...base, fieldId: f.note.id, fieldType: 'TEXT', textValue: 'a', numberValue: '1' } })).rejects.toThrow();
            await expect(prisma.customFieldValue.create({ data: { ...base, fieldId: f.done.id, fieldType: 'CHECKBOX', boolValue: false } })).rejects.toThrow();
            await expect(prisma.customFieldValue.create({ data: { ...base, fieldId: f.note.id, fieldType: 'TEXT', textValue: 'x'.repeat(501) } })).rejects.toThrow();
            // The type must match the field's (composite FK).
            await expect(prisma.customFieldValue.create({ data: { ...base, fieldId: f.note.id, fieldType: 'URL', textValue: 'https://x.y' } })).rejects.toThrow();
            await prisma.customFieldValue.create({ data: { ...base, fieldId: f.size.id, fieldType: 'NUMBER', numberValue: '1' } });
            await expect(prisma.customFieldValue.create({ data: { ...base, fieldId: f.size.id, fieldType: 'NUMBER', numberValue: '2' } })).rejects.toThrow();
            const red = opt(f.tags, 'red');
            await prisma.customFieldValue.create({ data: { ...base, fieldId: f.tags.id, fieldType: 'MULTI_SELECT', optionId: red } });
            await prisma.customFieldValue.create({ data: { ...base, fieldId: f.tags.id, fieldType: 'MULTI_SELECT', optionId: opt(f.tags, 'blue') } });
            await expect(prisma.customFieldValue.create({ data: { ...base, fieldId: f.tags.id, fieldType: 'MULTI_SELECT', optionId: red } })).rejects.toThrow();
            // A value on another project's item cannot name this project's field.
            const elsewhere = await createWorkItem(owner, { projectId: otherProjectId, typeId, title: 'elsewhere' });
            await expect(
                prisma.customFieldValue.create({ data: { tenantId, projectId, workItemId: elsewhere.id, fieldId: f.size.id, fieldType: 'NUMBER', numberValue: '1' } }),
            ).rejects.toThrow();
        });

        it('the catalogue holds the CHECKs, the partial uniques and the rank trigger', async () => {
            const checks = await prisma.$queryRaw<{ conname: string }[]>`
                SELECT conname FROM pg_constraint WHERE conrelid = '"CustomFieldValue"'::regclass AND contype = 'c' ORDER BY conname`;
            expect(checks.map((c) => c.conname)).toEqual(['CustomFieldValue_checkbox_true', 'CustomFieldValue_one_column', 'CustomFieldValue_text_cap']);
            const idx = await prisma.$queryRaw<{ indexname: string }[]>`
                SELECT indexname FROM pg_indexes WHERE tablename = 'CustomFieldValue' AND indexdef LIKE '%WHERE%' ORDER BY indexname`;
            expect(idx.map((i) => i.indexname)).toEqual(['CustomFieldValue_one_per_item_field', 'CustomFieldValue_one_per_item_option']);
            const trig = await prisma.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE tgname = 'work_item_priority_rank'`;
            expect(trig).toHaveLength(1);
        });

        it('the priority rank follows the priority, whoever writes it', async () => {
            const item = await newItem('ranked', { priority: 'URGENT' });
            const rank = async () => (await prisma.workItem.findUniqueOrThrow({ where: { id: item.id }, select: { priorityRank: true } })).priorityRank;
            expect(await rank()).toBe(1);
            await updateWorkItem(owner, item.id, { priority: 'LOW' });
            expect(await rank()).toBe(4);
            await prisma.workItem.update({ where: { id: item.id }, data: { priorityRank: 1 } });
            expect(await rank()).toBe(4);
        });
    });

    describe('list: filters and sorts', () => {
        const titles: Record<string, string> = {};
        let ids: Record<string, string> = {};

        beforeAll(async () => {
            // A fresh project, so earlier cases' items do not count.
            projectId = (await createProject(owner, { teamId, name: 'Sorted', keyPrefix: 'SRT' })).id;
            const stage = await createCustomField(owner, projectId, { name: 'Stage', type: 'SELECT', options: [{ name: 'Alpha' }, { name: 'Beta' }] });
            const size = await createCustomField(owner, projectId, { name: 'Size', type: 'NUMBER' });
            const when = await createCustomField(owner, projectId, { name: 'When', type: 'DATE' });
            const note = await createCustomField(owner, projectId, { name: 'Note', type: 'TEXT' });
            const done = await createCustomField(owner, projectId, { name: 'Done', type: 'CHECKBOX' });
            Object.assign(titles, { stage: stage.id, size: size.id, when: when.id, note: note.id, done: done.id, alpha: opt(stage, 'Alpha'), beta: opt(stage, 'Beta') });
            const rows: Array<[string, Parameters<typeof createWorkItem>[1]['customFields'], Partial<Parameters<typeof createWorkItem>[1]>]> = [
                ['a', { [size.id]: 5, [stage.id]: titles.beta!, [when.id]: '2031-01-05', [note.id]: 'apple pie' }, { priority: 'LOW', dueDate: '2031-03-01' }],
                ['b', { [size.id]: 1, [stage.id]: titles.alpha!, [done.id]: true }, { priority: 'URGENT' }],
                ['c', { [size.id]: 5, [when.id]: '2031-01-01' }, { priority: 'HIGH', dueDate: '2031-01-01' }],
                ['d', {}, { priority: 'NONE', dueDate: '2031-02-01' }],
                ['e', { [size.id]: -2, [stage.id]: titles.alpha!, [note.id]: 'Banana' }, { priority: 'MEDIUM' }],
            ];
            ids = {};
            for (const [title, customFields, extra] of rows) ids[title] = (await newItem(title, { customFields, ...extra })).id;
        });

        it('filters by each operator kind; a negative condition includes empty values', async () => {
            const q = async (cf: Record<string, string>) => (await allKeys({ customFields: cf }, 50)).sort();
            expect(await q({ [titles.stage!]: `any:${titles.alpha}` })).toEqual(['b', 'e']);
            expect(await q({ [titles.stage!]: `any:${titles.beta},none` })).toEqual(['a', 'c', 'd']);
            expect(await q({ [titles.stage!]: 'empty' })).toEqual(['c', 'd']);
            expect(await q({ [titles.size!]: 'gt:1' })).toEqual(['a', 'c']);
            expect(await q({ [titles.size!]: 'lte:1' })).toEqual(['b', 'e']);
            expect(await q({ [titles.when!]: 'before:2031-01-03' })).toEqual(['c']);
            expect(await q({ [titles.note!]: 'contains:BAN' })).toEqual(['e']);
            expect(await q({ [titles.done!]: 'is:true' })).toEqual(['b']);
            expect(await q({ [titles.done!]: 'is:false' })).toEqual(['a', 'c', 'd', 'e']);
            expect(await q({ [titles.size!]: 'set', [titles.stage!]: `any:${titles.alpha}` })).toEqual(['b', 'e']);
        });

        it('refuses an unknown field, an operator the type does not take, and an unsortable field', async () => {
            await expect(listWorkItems(owner, { customFields: { nope: 'set' } })).rejects.toMatchObject({ status: 400 });
            await expect(listWorkItems(owner, { customFields: { [titles.size!]: 'contains:1' } })).rejects.toMatchObject({ status: 400 });
            const tags = await createCustomField(owner, projectId, { name: 'Tags', type: 'MULTI_SELECT', options: [{ name: 'x' }] });
            await expect(listWorkItems(owner, { order: `cf:${tags.id}` })).rejects.toMatchObject({ status: 400 });
            await expect(listWorkItems(owner, { order: 'sideways' })).rejects.toMatchObject({ status: 400 });
        });

        it('every named sort pages (two at a time) to the full order, nulls last', async () => {
            expect(await allKeys({ order: 'priority' })).toEqual(['b', 'c', 'e', 'a', 'd']);
            expect(await allKeys({ order: 'priority', dir: 'desc' })).toEqual(['d', 'a', 'e', 'c', 'b']);
            const due = await allKeys({ order: 'due' });
            expect(due.slice(0, 3)).toEqual(['c', 'd', 'a']);
            expect(due.slice(3).sort()).toEqual(['b', 'e']);
            const dueDesc = await allKeys({ order: 'due', dir: 'desc' });
            expect(dueDesc.slice(0, 3)).toEqual(['a', 'd', 'c']);
            expect(await allKeys({ order: 'key' })).toEqual(['a', 'b', 'c', 'd', 'e']);
            expect(await allKeys({ order: 'key', dir: 'desc' })).toEqual(['e', 'd', 'c', 'b', 'a']);
            expect(await allKeys({ order: 'created', dir: 'asc' })).toEqual(['a', 'b', 'c', 'd', 'e']);
            expect((await allKeys({ order: 'updated' })).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
            expect(await allKeys({ order: 'manual' })).toEqual(['a', 'b', 'c', 'd', 'e']);
        });

        it('a custom-field sort pages to the value order, ties by row, empty values last in both directions', async () => {
            const asc = await allKeys({ order: `cf:${titles.size}` });
            expect(asc[0]).toBe('e');
            expect(asc[1]).toBe('b');
            expect(asc.slice(2, 4).sort()).toEqual(['a', 'c']);
            expect(asc[4]).toBe('d');
            const desc = await allKeys({ order: `cf:${titles.size}`, dir: 'desc' });
            expect(desc.slice(0, 2).sort()).toEqual(['a', 'c']);
            expect(desc.slice(2)).toEqual(['b', 'e', 'd']);
            // A select sorts by its options' order, not by name or id.
            const byStage = await allKeys({ order: `cf:${titles.stage}` }, 1);
            expect(byStage.slice(0, 2).sort()).toEqual(['b', 'e']);
            expect(byStage[2]).toBe('a');
            expect(byStage.slice(3).sort()).toEqual(['c', 'd']);
            // Filters still apply under a field sort.
            expect(await allKeys({ order: `cf:${titles.size}`, customFields: { [titles.stage!]: `any:${titles.alpha}` } })).toEqual(['e', 'b']);
            expect(await allKeys({ order: `cf:${titles.done}` })).toEqual(expect.arrayContaining(['b']));
            await expect(listWorkItems(owner, { order: `cf:${titles.size}`, cursor: 'garbage' })).rejects.toMatchObject({ status: 400 });
        });
    });

    describe('saved views', () => {
        const config = { filters: { priority: ['HIGH'] }, sort: 'due' as const, laneBy: 'none' };

        it('a personal view is its creator\'s alone; a shared one is everybody\'s to see', async () => {
            const mine = await createSavedView(member, { name: 'Mine', visibility: 'PERSONAL', layout: 'LIST', config });
            const shared = await createSavedView(member, { name: 'Ours', visibility: 'SHARED', projectId, layout: 'BOARD', config: { ...config, q: '<script>x</script>hi' } });
            expect(shared.config.q).not.toContain('<script>');
            const seenBy2 = (await listSavedViews(member2, undefined)).views.map((v) => v.id);
            expect(seenBy2).toContain(shared.id);
            expect(seenBy2).not.toContain(mine.id);
            await expect(getSavedView(member2, mine.id)).rejects.toMatchObject({ status: 404 });
            expect((await listSavedViews(member, projectId)).views.map((v) => v.id)).toEqual([shared.id]);
            expect((await listSavedViews(member, null)).views.map((v) => v.id)).toEqual([mine.id]);
            expect((await listSavedViews(viewer, undefined)).views.map((v) => v.id)).toContain(shared.id);
        });

        it('a calendar view stores CALENDAR and its two switches (3.3a)', async () => {
            const view = await createSavedView(member, { name: 'Due dates', visibility: 'PERSONAL', layout: 'CALENDAR', config: { ...config, calendar: { showCycles: false, showMilestones: true } } });
            expect(view.layout).toBe('CALENDAR');
            expect(view.config.calendar).toEqual({ showCycles: false, showMilestones: true });
            expect((await getSavedView(member, view.id)).layout).toBe('CALENDAR');
        });

        it('a VIEWER saves and edits its own personal view, audited, and is refused a shared one (decision 60)', async () => {
            const own = await createSavedView(viewer, { name: 'Viewer only', visibility: 'PERSONAL', layout: 'LIST', config });
            expect(own).toMatchObject({ visibility: 'PERSONAL', mine: true, createdByUserId: viewer.userId });
            expect((await listSavedViews(member, undefined)).views.map((v) => v.id)).not.toContain(own.id);
            const created = await prisma.auditLog.findFirst({ where: { tenantId, entityId: own.id, action: 'SAVED_VIEW_CREATED' } });
            expect(created?.userId).toBe(viewer.userId);
            expect(await updateSavedView(viewer, own.id, { name: 'Viewer only, renamed', config: { ...config, sort: 'created' } })).toMatchObject({
                name: 'Viewer only, renamed',
                visibility: 'PERSONAL',
                config: { sort: 'created' },
            });
            const updated = await prisma.auditLog.findFirst({ where: { tenantId, entityId: own.id, action: 'SAVED_VIEW_UPDATED' } });
            expect(updated?.userId).toBe(viewer.userId);

            const denied = () => prisma.auditLog.count({ where: { tenantId, userId: viewer.userId, action: 'AUTHZ_DENIED' } });
            const before = await denied();
            await expect(createSavedView(viewer, { name: 'Ours', visibility: 'SHARED', layout: 'LIST', config })).rejects.toMatchObject({ status: 403 });
            await expect(updateSavedView(viewer, own.id, { visibility: 'SHARED' })).rejects.toMatchObject({ status: 403 });
            const teamView = await createSavedView(member, { name: 'Team board', visibility: 'SHARED', layout: 'LIST', config });
            await expect(updateSavedView(viewer, teamView.id, { name: 'Mine now' })).rejects.toMatchObject({ status: 403 });
            await expect(deleteSavedView(viewer, teamView.id)).rejects.toMatchObject({ status: 403 });
            expect(await denied()).toBe(before + 4);
            expect((await getSavedView(viewer, own.id)).visibility).toBe('PERSONAL');
            expect(await deleteSavedView(viewer, own.id)).toEqual({ deleted: true, moderated: false });
            await deleteSavedView(member, teamView.id);
        });

        it('only the creator changes a view; an admin may delete a shared one, audited as moderation', async () => {
            const shared = await createSavedView(member, { name: 'Team view', visibility: 'SHARED', layout: 'LIST', config });
            await expect(updateSavedView(member2, shared.id, { name: 'Hijacked' })).rejects.toMatchObject({ status: 403 });
            await expect(updateSavedView(owner, shared.id, { name: 'Hijacked' })).rejects.toMatchObject({ status: 403 });
            await expect(deleteSavedView(member2, shared.id)).rejects.toMatchObject({ status: 403 });
            const renamed = await updateSavedView(member, shared.id, { name: 'Renamed', visibility: 'PERSONAL' });
            expect(renamed).toMatchObject({ name: 'Renamed', visibility: 'PERSONAL' });
            await expect(getSavedView(member2, shared.id)).rejects.toMatchObject({ status: 404 });
            await updateSavedView(member, shared.id, { visibility: 'SHARED' });
            expect(await deleteSavedView(owner, shared.id)).toEqual({ deleted: true, moderated: true });
            const audit = await prisma.auditLog.findFirst({ where: { tenantId, entityId: shared.id, action: 'SAVED_VIEW_MODERATED' } });
            expect(audit?.userId).toBe(owner.userId);
            const own = await createSavedView(member, { name: 'Gone soon', visibility: 'PERSONAL', layout: 'LIST', config });
            expect(await deleteSavedView(member, own.id)).toEqual({ deleted: true, moderated: false });
        });

        it('a project-scoped view of a project nobody can see is not saved; a GUEST is refused the views (decision 204), and one granted the read key, as 8.4 will, still sees no project view', async () => {
            await expect(createSavedView(member, { name: 'X', visibility: 'PERSONAL', projectId: 'missing', layout: 'LIST', config })).rejects.toMatchObject({ status: 404 });
            const u = await prisma.user.create({ data: { email: `guest-${TAG}@example.test` } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'GUEST' } });
            const guest = makeRequestContext('GUEST', { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-g` });
            await expect(listSavedViews(guest, undefined)).rejects.toMatchObject({ status: 403 });
            const granted = makeRequestContext('GUEST', { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-g2`, appPermissions: getPermissionsForRole('VIEWER') });
            const views = (await listSavedViews(granted, undefined)).views;
            expect(views.some((v) => v.projectId !== null)).toBe(false);
        });

        it('a malformed config is refused by the schema', async () => {
            await expect(
                createSavedView(member, { name: 'Bad', visibility: 'PERSONAL', layout: 'LIST', config: { filters: { 'evil key': ['x'] }, sort: 'manual' as const, laneBy: 'none' } }),
            ).rejects.toThrow();
        });
    });

    it('every write is audited, and the chain verifies', async () => {
        const actions = new Set((await prisma.auditLog.findMany({ where: { tenantId }, select: { action: true } })).map((r) => r.action));
        for (const a of [
            'CUSTOM_FIELD_CREATED',
            'CUSTOM_FIELD_UPDATED',
            'CUSTOM_FIELD_ARCHIVED',
            'CUSTOM_FIELD_OPTION_CREATED',
            'CUSTOM_FIELD_OPTION_UPDATED',
            'CUSTOM_FIELD_OPTION_DELETED',
            'WORK_ITEM_CUSTOM_FIELD_SET',
            'CUSTOM_FIELD_VALUES_CLEARED_ON_MEMBER_REMOVAL',
            'SAVED_VIEW_CREATED',
            'SAVED_VIEW_UPDATED',
            'SAVED_VIEW_DELETED',
            'SAVED_VIEW_MODERATED',
        ]) {
            expect({ a, present: actions.has(a) }).toEqual({ a, present: true });
        }
        const set = await prisma.auditLog.findFirst({ where: { tenantId, action: 'WORK_ITEM_CUSTOM_FIELD_SET' } });
        expect(JSON.stringify(set?.detailsJson)).not.toContain('line one');
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
