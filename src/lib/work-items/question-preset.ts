/**
 * The Question preset (sub-phase 2.4b-c; owner decisions 116 and 118).
 * Nothing is seeded: Settings → Work item types offers "Add the Question
 * type" (`addQuestionType`, one transaction), and a project's item-templates
 * manager offers "Add a Question template", saved through 2.5c's ordinary
 * template route. "Question" is user data, like the seeded Feature; nothing
 * in code depends on a type's name or identity: a question-like type is any
 * type whose field set shows the answer (`typeShowsAnswer`).
 *
 * Client-safe: the server and the forms read these same values.
 * Written fresh for Islestone.
 */
import { requirementOf, resolveFieldSet, type BuiltInField, type FieldRequirementValue, type FieldSetEntry } from './field-sets';

export const QUESTION_TYPE_PRESET: { name: string; fields: ReadonlyArray<{ field: BuiltInField; requirement: FieldRequirementValue }> } = {
    name: 'Question',
    fields: [
        { field: 'dueDate', requirement: 'REQUIRED' },
        { field: 'waitingOn', requirement: 'REQUIRED' },
        { field: 'answer', requirement: 'OPTIONAL' },
    ],
};

export const QUESTION_TEMPLATE_PRESET = { name: 'Question', title: 'Question', dueInDays: 5 } as const;

/** Does `typeId`'s field set (its workspace-wide built-in rules) show the answer? */
export function typeShowsAnswer(entries: readonly FieldSetEntry[], typeId: string): boolean {
    return requirementOf(resolveFieldSet(entries, typeId), 'answer') !== 'HIDDEN';
}
