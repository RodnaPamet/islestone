/**
 * The one projection from a template to a create (sub-phase 2.5c) and the
 * project-template content document.
 */
import { templateToCreateInput, type TemplateItemSource, type TemplateUseContext } from '@/app-layer/domain/work-item-template';
import { ProjectTemplateContentSchema } from '@/lib/schemas/template';

const TODAY = new Date('2026-11-20T00:00:00.000Z');

const source: TemplateItemSource = {
    templateId: 't1',
    title: 'Release checklist',
    description: 'Steps',
    typeId: 'type-task',
    priority: 'HIGH',
    labelIds: ['l-live', 'l-gone'],
    assigneeId: 'u-left',
    dueInDays: 3,
    customFields: { 'f-select': 'o-live', 'f-multi': ['o-live', 'o-archived'], 'f-person': 'u-here', 'f-archived': 'x', 'f-text': 'hello' },
    subItems: [{ title: 'Tag' }, { title: 'Announce' }],
};

const use: TemplateUseContext = {
    today: TODAY,
    usableLabelIds: new Set(['l-live']),
    activeMemberIds: new Set(['u-here']),
    liveFields: new Map([
        ['f-select', { type: 'SELECT', liveOptionIds: new Set(['o-live']) }],
        ['f-multi', { type: 'MULTI_SELECT', liveOptionIds: new Set(['o-live']) }],
        ['f-person', { type: 'PERSON', liveOptionIds: new Set<string>() }],
        ['f-text', { type: 'TEXT', liveOptionIds: new Set<string>() }],
    ]),
};

describe('templateToCreateInput', () => {
    it('takes the template, dates the due date from today, and names what no longer fits', () => {
        const p = templateToCreateInput(source, {}, use);
        expect(p).toMatchObject({
            title: 'Release checklist',
            description: 'Steps',
            typeId: 'type-task',
            priority: 'HIGH',
            labelIds: ['l-live'],
            assigneeId: null,
            dueDate: '2026-11-23',
            milestoneId: null,
            customFields: { 'f-select': 'o-live', 'f-person': 'u-here', 'f-text': 'hello' },
            subItems: [{ title: 'Tag' }, { title: 'Announce' }],
        });
        expect(p.skipped.sort()).toEqual(['assignee:u-left', 'field:f-archived', 'field:f-multi', 'label:l-gone']);
    });

    it('lets the request win for every field it names, and skips nothing it replaced', () => {
        const p = templateToCreateInput(
            source,
            { title: 'Mine', description: null, typeId: 'type-bug', priority: 'LOW', labelIds: [], assigneeId: 'u-here', dueDate: null, customFields: { 'f-multi': ['o-live'] } },
            use,
        );
        expect(p).toMatchObject({ title: 'Mine', description: null, typeId: 'type-bug', priority: 'LOW', labelIds: [], assigneeId: 'u-here', dueDate: null });
        expect(p.customFields['f-multi']).toEqual(['o-live']);
        expect(p.skipped.sort()).toEqual(['field:f-archived']);
    });

    it('is deterministic and never mutates its inputs', () => {
        const before = JSON.stringify(source);
        expect(templateToCreateInput(source, {}, use)).toEqual(templateToCreateInput(source, {}, use));
        expect(JSON.stringify(source)).toBe(before);
    });

    it("a repeat source's goal (3.2a): kept while live, else skipped and named; a template names none", () => {
        const goals = new Map([
            ['g-live', 'live'],
            ['g-archived', 'archived'],
            ['g-blind', 'unreadable'],
        ] as const);
        const withGoal = (goalId: string) => templateToCreateInput({ ...source, goalId }, {}, { ...use, goalStates: goals });
        expect(withGoal('g-live')).toMatchObject({ goalId: 'g-live' });
        expect(withGoal('g-live').skipped).not.toContainEqual(expect.stringMatching(/^goal:/));
        expect(withGoal('g-archived')).toMatchObject({ goalId: null });
        expect(withGoal('g-archived').skipped).toContain('goal:archived');
        expect(withGoal('g-blind').skipped).toContain('goal:unreadable');
        expect(withGoal('g-gone').skipped).toContain('goal:deleted');
        expect(templateToCreateInput(source, {}, use).goalId).toBeNull();
        expect(templateToCreateInput({ ...source, goalId: 'g-gone' }, { goalId: 'g-live' }, use)).toMatchObject({ goalId: 'g-live' });
    });

    it('a template with no due offset gives no due date, and day 0 is today', () => {
        expect(templateToCreateInput({ ...source, dueInDays: null }, {}, use).dueDate).toBeNull();
        expect(templateToCreateInput({ ...source, dueInDays: 0 }, {}, use).dueDate).toBe('2026-11-20');
    });
});

describe('ProjectTemplateContentSchema', () => {
    const base = { version: 1, customFields: [], milestones: [{ name: 'Beta', dueInDays: 14 }], itemTemplates: [], items: [] };
    const item = { title: 'Kick-off', description: null, typeName: 'Task', priority: 'NONE', labelNames: [], dueInDays: null, subItems: [] };

    it('accepts version 1 and a starter item naming a milestone it holds', () => {
        expect(ProjectTemplateContentSchema.safeParse({ ...base, items: [{ ...item, milestoneIndex: 0 }] }).success).toBe(true);
    });

    it('refuses another version, unknown keys, a milestone index past the list and too many sub-items', () => {
        expect(ProjectTemplateContentSchema.safeParse({ ...base, version: 2 }).success).toBe(false);
        expect(ProjectTemplateContentSchema.safeParse({ ...base, extra: true }).success).toBe(false);
        expect(ProjectTemplateContentSchema.safeParse({ ...base, items: [{ ...item, milestoneIndex: 1 }] }).success).toBe(false);
        const subs = Array.from({ length: 51 }, (_, i) => ({ title: `s${i}` }));
        expect(ProjectTemplateContentSchema.safeParse({ ...base, items: [{ ...item, milestoneIndex: null, subItems: subs }] }).success).toBe(false);
    });
});

describe('templateToCreateInput and the estimate (3.4a, decision 258)', () => {
    it("keeps the source's estimate in the column of the team's unit, and skips one in another unit, named", () => {
        const points = { ...source, estimatePoints: 5, estimateMinutes: null };
        expect(templateToCreateInput(points, {}, { ...use, estimateUnit: 'POINTS' })).toMatchObject({ estimatePoints: 5, estimateMinutes: null });
        const skipped = templateToCreateInput(points, {}, { ...use, estimateUnit: 'HOURS' });
        expect(skipped).toMatchObject({ estimatePoints: null, estimateMinutes: null });
        expect(skipped.skipped).toContain('estimate:unit');
        // A team that does not estimate, or a context that says nothing, skips it too.
        expect(templateToCreateInput(points, {}, { ...use, estimateUnit: null }).skipped).toContain('estimate:unit');
        expect(templateToCreateInput(points, {}, use).skipped).toContain('estimate:unit');
    });

    it('a hidden value beside the counted one is not copied and not named; no estimate names nothing', () => {
        const both = templateToCreateInput({ ...source, estimatePoints: 3, estimateMinutes: 90 }, {}, { ...use, estimateUnit: 'HOURS' });
        expect(both).toMatchObject({ estimatePoints: null, estimateMinutes: 90 });
        expect(both.skipped).not.toContain('estimate:unit');
        expect(templateToCreateInput(source, {}, { ...use, estimateUnit: 'POINTS' }).skipped).not.toContain('estimate:unit');
    });

    it('the request wins when it names the estimate', () => {
        const p = templateToCreateInput({ ...source, estimatePoints: 5 }, { estimatePoints: 1 }, { ...use, estimateUnit: 'POINTS' });
        expect(p).toMatchObject({ estimatePoints: 1, estimateMinutes: null });
        expect(templateToCreateInput({ ...source, estimatePoints: 5 }, { estimatePoints: null }, { ...use, estimateUnit: 'POINTS' })).toMatchObject({ estimatePoints: null });
    });

    it("a project template's starter item may carry an estimate; content saved before has none", () => {
        const content = { version: 1, customFields: [], milestones: [], itemTemplates: [], items: [] };
        expect(ProjectTemplateContentSchema.safeParse(content).success).toBe(true);
        const item = { title: 'x', description: null, typeName: null, priority: 'NONE', labelNames: [], dueInDays: null, subItems: [], milestoneIndex: null };
        expect(ProjectTemplateContentSchema.safeParse({ ...content, items: [{ ...item, estimatePoints: 13 }] }).success).toBe(true);
        expect(ProjectTemplateContentSchema.safeParse({ ...content, items: [{ ...item, estimatePoints: 101 }] }).success).toBe(false);
    });
});

