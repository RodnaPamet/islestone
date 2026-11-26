/**
 * The ONE projection from a template to a work item's create input
 * (sub-phase 2.5c; docs/porting/maps/2.5.md, "Item templates"). Every caller
 * that makes an item from a template goes through `templateToCreateInput`:
 * the create with `templateId` and a project template's starter items alike.
 *
 * Pattern only, no code copied: inflect-compliance
 * `src/app-layer/usecases/control/task-from-template.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1) names the lesson, one
 * projection after four call sites drifted. Written fresh.
 *
 * Pure. The request body wins over the template for every field it names.
 * What no longer fits the project is skipped and named in `skipped`, never
 * silently dropped: a label the item cannot carry, an assignee who is no
 * longer an active member, a field or option that is archived or gone.
 */
import type { CustomFieldType, WorkItemPriority } from '@prisma/client';

import { addDays, dayKey } from './cycle';

/** What a template (or a starter item) says a new item should be. */
export interface TemplateItemSource {
    templateId: string | null;
    title: string;
    description: string | null;
    typeId: string | null;
    priority: WorkItemPriority;
    labelIds: readonly string[];
    assigneeId: string | null;
    dueInDays: number | null;
    milestoneId?: string | null;
    /** The goal a repeat's source names directly (3.2a, decision 211); item and project templates carry none. */
    goalId?: string | null;
    customFields: Readonly<Record<string, unknown>>;
    subItems: ReadonlyArray<{ title: string }>;
}

/** The fields of a create a request may name, each overriding the template's. */
export interface TemplateOverrides {
    title?: string;
    description?: string | null;
    typeId?: string;
    priority?: WorkItemPriority;
    labelIds?: string[];
    assigneeId?: string | null;
    dueDate?: string | null;
    milestoneId?: string | null;
    goalId?: string | null;
    customFields?: Readonly<Record<string, unknown>>;
}

/** The project as it is when the template is used. */
export interface TemplateUseContext {
    /** Today, date-only. */
    today: Date;
    /** Labels an item of the project may carry (live, the workspace's or its team's). */
    usableLabelIds: ReadonlySet<string>;
    /** Active members' user ids. */
    activeMemberIds: ReadonlySet<string>;
    /** The project's live (not archived) fields, with their live options. */
    liveFields: ReadonlyMap<string, { type: CustomFieldType; liveOptionIds: ReadonlySet<string> }>;
    /**
     * The source's goal as it is now (3.2a): `live`, `archived`, or
     * `unreadable` (the person the copy is made as may not read goals); a goal
     * not in the map is deleted or gone. Only a repeat's source names a goal.
     */
    goalStates?: ReadonlyMap<string, 'live' | 'archived' | 'unreadable'>;
}

export interface TemplateProjection {
    title: string;
    description: string | null;
    typeId: string | null;
    priority: WorkItemPriority;
    labelIds: string[];
    assigneeId: string | null;
    dueDate: string | null;
    milestoneId: string | null;
    goalId: string | null;
    customFields: Record<string, unknown>;
    subItems: Array<{ title: string }>;
    /** What the template held that the project no longer takes (`label:<id>`, `assignee:<id>`, `field:<id>`). */
    skipped: string[];
}

function projectFieldValue(
    field: { type: CustomFieldType; liveOptionIds: ReadonlySet<string> },
    value: unknown,
    activeMemberIds: ReadonlySet<string>,
): { keep: boolean; value: unknown } {
    if (field.type === 'SELECT') return { keep: typeof value === 'string' && field.liveOptionIds.has(value), value };
    if (field.type === 'MULTI_SELECT') {
        if (!Array.isArray(value)) return { keep: false, value };
        const live = value.filter((v): v is string => typeof v === 'string' && field.liveOptionIds.has(v));
        return { keep: live.length > 0 && live.length === value.length, value: live };
    }
    if (field.type === 'PERSON') return { keep: typeof value === 'string' && activeMemberIds.has(value), value };
    return { keep: value !== null && value !== undefined, value };
}

export function templateToCreateInput(source: TemplateItemSource, body: TemplateOverrides, use: TemplateUseContext): TemplateProjection {
    const skipped: string[] = [];

    let labelIds: string[];
    if (body.labelIds !== undefined) labelIds = [...body.labelIds];
    else {
        labelIds = [];
        for (const id of source.labelIds) {
            if (use.usableLabelIds.has(id)) labelIds.push(id);
            else skipped.push(`label:${id}`);
        }
    }

    let assigneeId: string | null;
    if (body.assigneeId !== undefined) assigneeId = body.assigneeId;
    else if (source.assigneeId && !use.activeMemberIds.has(source.assigneeId)) {
        skipped.push(`assignee:${source.assigneeId}`);
        assigneeId = null;
    } else assigneeId = source.assigneeId;

    const customFields: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(source.customFields)) {
        if (body.customFields && fieldId in body.customFields) continue;
        const field = use.liveFields.get(fieldId);
        const projected = field ? projectFieldValue(field, value, use.activeMemberIds) : { keep: false, value };
        if (projected.keep) customFields[fieldId] = projected.value;
        else skipped.push(`field:${fieldId}`);
    }
    Object.assign(customFields, body.customFields ?? {});

    // A goal no longer linkable is skipped and named, never a refusal (3.2a):
    // `goal:deleted`, `goal:archived`, `goal:unreadable`.
    let goalId: string | null;
    if (body.goalId !== undefined) goalId = body.goalId;
    else if (source.goalId) {
        const state = use.goalStates?.get(source.goalId);
        if (state === 'live') goalId = source.goalId;
        else {
            skipped.push(`goal:${state ?? 'deleted'}`);
            goalId = null;
        }
    } else goalId = null;

    const dueDate =
        body.dueDate !== undefined ? body.dueDate : source.dueInDays !== null ? dayKey(addDays(use.today, source.dueInDays)) : null;

    return {
        title: body.title ?? source.title,
        description: body.description !== undefined ? body.description : source.description,
        typeId: body.typeId ?? source.typeId,
        priority: body.priority ?? source.priority,
        labelIds,
        assigneeId,
        dueDate,
        milestoneId: body.milestoneId !== undefined ? body.milestoneId : (source.milestoneId ?? null),
        goalId,
        customFields,
        subItems: source.subItems.map((s) => ({ title: s.title })),
        skipped,
    };
}
