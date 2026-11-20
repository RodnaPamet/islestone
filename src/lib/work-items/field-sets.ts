/**
 * Field sets (sub-phase 2.4b-b; ADR 0002 §1 and §7; owner decisions 101 and
 * 108 to 112): for each work item type, which fields are required, optional
 * or hidden. The ONE home of the rules: the usecases assert them, the server
 * pages hand the rows to the client, and every form evaluates them with these
 * same functions. A component never restates a rule.
 *
 *   - A built-in field's rule belongs to the type across the workspace; a
 *     custom field's belongs to the type within the field's project.
 *   - With no rule a field is OPTIONAL; the answer is HIDDEN (2.4b-c) and is
 *     shown or hidden, never required.
 *   - Required applies while the item is open: a closed item is never refused
 *     for a missing field (closing a Question clears its waiting on).
 *   - An archived custom field is never required (its rule is ignored).
 *
 * Client-safe: no Prisma runtime, no server import. Written fresh for
 * Islestone.
 */

/** The built-in fields a field set configures (decision 110). Title, type, project and state are always required. */
export const CONFIGURABLE_BUILT_IN_FIELDS = [
    'description',
    'assignee',
    'waitingOn',
    'priority',
    'labels',
    'startDate',
    'dueDate',
    'cycle',
    'milestone',
    'answer',
] as const;
export type BuiltInField = (typeof CONFIGURABLE_BUILT_IN_FIELDS)[number];

export const FIELD_REQUIREMENTS = ['REQUIRED', 'OPTIONAL', 'HIDDEN'] as const;
export type FieldRequirementValue = (typeof FIELD_REQUIREMENTS)[number];

/** A built-in field (`dueDate`) or a custom field (`cf:<fieldId>`). */
export type FieldKey = BuiltInField | `cf:${string}`;

/** One stored rule, as the API and the view configuration carry it. */
export interface FieldSetEntry {
    typeId: string;
    /** NULL for a built-in rule. */
    projectId: string | null;
    builtInField: string | null;
    customFieldId: string | null;
    requirement: FieldRequirementValue;
}

/** A type's field set, resolved for one project. */
export interface ResolvedFieldSet {
    builtIn: Record<BuiltInField, FieldRequirementValue>;
    /** Live custom fields with a rule; a field absent here is OPTIONAL. */
    customFields: Record<string, FieldRequirementValue>;
}

/** The values a write leaves (a create's whole item, or the fields a write names). */
export interface FieldValues {
    description?: string | null;
    assigneeId?: string | null;
    waitingOnUserId?: string | null;
    priority?: string | null;
    labelIds?: readonly string[] | null;
    startDate?: string | Date | null;
    dueDate?: string | Date | null;
    cycleId?: string | null;
    milestoneId?: string | null;
    answerCommentId?: string | null;
    /** Field id → value; empty is absent, null, '', [] or false. */
    customFields?: Readonly<Record<string, unknown>>;
}

const VALUE_OF: Record<BuiltInField, keyof FieldValues> = {
    description: 'description',
    assignee: 'assigneeId',
    waitingOn: 'waitingOnUserId',
    priority: 'priority',
    labels: 'labelIds',
    startDate: 'startDate',
    dueDate: 'dueDate',
    cycle: 'cycleId',
    milestone: 'milestoneId',
    answer: 'answerCommentId',
};

export function isBuiltInField(value: string): value is BuiltInField {
    return (CONFIGURABLE_BUILT_IN_FIELDS as readonly string[]).includes(value);
}

/** The requirement a field has with no rule. */
export function defaultRequirement(field: BuiltInField | 'custom'): FieldRequirementValue {
    return field === 'answer' ? 'HIDDEN' : 'OPTIONAL';
}

/** The requirements a field may take: the answer is shown or hidden only. */
export function allowedRequirements(field: BuiltInField | 'custom'): readonly FieldRequirementValue[] {
    return field === 'answer' ? ['OPTIONAL', 'HIDDEN'] : FIELD_REQUIREMENTS;
}

/** Closed means a Done or Cancelled category: required fields are not asked of it. */
export function isClosedCategory(category: string | null | undefined): boolean {
    return category === 'DONE' || category === 'CANCELLED';
}

/**
 * The field set of `typeId` in `projectId`: built-in rules of the type, and
 * the type's rules for that project's live custom fields (`liveCustomFieldIds`;
 * a rule for an archived or unknown field is ignored).
 */
export function resolveFieldSet(
    rules: readonly FieldSetEntry[],
    typeId: string,
    opts: { projectId?: string | null; liveCustomFieldIds?: Iterable<string> } = {},
): ResolvedFieldSet {
    const builtIn = Object.fromEntries(CONFIGURABLE_BUILT_IN_FIELDS.map((f) => [f, defaultRequirement(f)])) as Record<BuiltInField, FieldRequirementValue>;
    const live = opts.liveCustomFieldIds ? new Set(opts.liveCustomFieldIds) : null;
    const customFields: Record<string, FieldRequirementValue> = {};
    for (const rule of rules) {
        if (rule.typeId !== typeId) continue;
        if (rule.builtInField && isBuiltInField(rule.builtInField) && rule.projectId === null) {
            builtIn[rule.builtInField] = rule.requirement;
        } else if (rule.customFieldId && opts.projectId && rule.projectId === opts.projectId) {
            if (live && !live.has(rule.customFieldId)) continue;
            customFields[rule.customFieldId] = rule.requirement;
        }
    }
    return { builtIn, customFields };
}

export function requirementOf(set: ResolvedFieldSet, key: FieldKey): FieldRequirementValue {
    if (key.startsWith('cf:')) return set.customFields[key.slice(3)] ?? 'OPTIONAL';
    return set.builtIn[key as BuiltInField];
}

function emptyValue(value: unknown): boolean {
    if (value === undefined || value === null || value === false) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/** Is `key` empty in `values`? Priority `NONE` is empty; so are no labels. */
export function isFieldEmpty(key: FieldKey, values: FieldValues): boolean {
    if (key.startsWith('cf:')) return emptyValue(values.customFields?.[key.slice(3)]);
    const field = key as BuiltInField;
    const value = values[VALUE_OF[field]];
    if (field === 'priority') return value === undefined || value === null || value === 'NONE';
    return emptyValue(value);
}

/** Does `values` name `key` at all (a write that leaves it alone does not)? */
export function namesField(key: FieldKey, values: FieldValues): boolean {
    if (key.startsWith('cf:')) return values.customFields !== undefined && Object.prototype.hasOwnProperty.call(values.customFields, key.slice(3));
    return values[VALUE_OF[key as BuiltInField]] !== undefined;
}

/** Every field the set gives a rule or a default to, built-in first. */
export function fieldKeysOf(set: ResolvedFieldSet): FieldKey[] {
    return [...CONFIGURABLE_BUILT_IN_FIELDS, ...Object.keys(set.customFields).map((id) => `cf:${id}` as const)];
}

/**
 * The required fields left empty. `only` limits the check to the fields a
 * write names (a single-field change); a create checks every field.
 */
export function fieldSetGaps(set: ResolvedFieldSet, values: FieldValues, only?: readonly FieldKey[]): FieldKey[] {
    const keys = only ?? fieldKeysOf(set);
    return keys.filter((k) => requirementOf(set, k) === 'REQUIRED' && isFieldEmpty(k, values));
}

/** The hidden fields `values` names with a value (clearing one is allowed). */
export function hiddenFieldsSet(set: ResolvedFieldSet, values: FieldValues): FieldKey[] {
    const custom = Object.keys(values.customFields ?? {}).map((id) => `cf:${id}` as const);
    return [...CONFIGURABLE_BUILT_IN_FIELDS, ...custom].filter(
        (k) => requirementOf(set, k) === 'HIDDEN' && namesField(k, values) && !isFieldEmpty(k, values),
    );
}

/** The English name of a field for a server message (the UI reads `workItems.fieldSet.*`). */
export const BUILT_IN_FIELD_LABELS: Record<BuiltInField, string> = {
    description: 'Description',
    assignee: 'Assignee',
    waitingOn: 'Waiting on',
    priority: 'Priority',
    labels: 'Labels',
    startDate: 'Start date',
    dueDate: 'Due date',
    cycle: 'Cycle',
    milestone: 'Milestone',
    answer: 'Answer',
};

export function fieldLabel(key: FieldKey, customFieldNames?: ReadonlyMap<string, string>): string {
    if (key.startsWith('cf:')) return customFieldNames?.get(key.slice(3)) ?? 'A custom field';
    return BUILT_IN_FIELD_LABELS[key as BuiltInField];
}
