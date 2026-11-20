/**
 * The triage rules of an intake request (sub-phase 2.6a; owner decision 90),
 * pure: which status each action starts from and leads to. The usecases ask
 * `checkTriage` before any write, and the claim of each write names the same
 * starting statuses in its `WHERE`, so a decision another person made in
 * between is a 409, never a second decision.
 *
 * Written fresh for Islestone.
 */
import type { IntakeRequestStatus } from '@/lib/intake/types';

export type TriageAction = 'accept' | 'decline' | 'merge' | 'snooze' | 'move' | 'edit' | 'reopen';

/** The statuses each action may start from. */
export const TRIAGE_FROM: Record<TriageAction, readonly IntakeRequestStatus[]> = {
    accept: ['PENDING', 'SNOOZED'],
    decline: ['PENDING', 'SNOOZED'],
    merge: ['PENDING', 'SNOOZED'],
    snooze: ['PENDING', 'SNOOZED'],
    move: ['PENDING', 'SNOOZED'],
    edit: ['PENDING', 'SNOOZED'],
    // An accepted request is never reopened: its work item exists.
    reopen: ['SNOOZED', 'DECLINED', 'MERGED'],
};

/** The status each action leaves the request in (`null`: unchanged). */
export const TRIAGE_TO: Record<TriageAction, IntakeRequestStatus | null> = {
    accept: 'ACCEPTED',
    decline: 'DECLINED',
    merge: 'MERGED',
    snooze: 'SNOOZED',
    move: null,
    edit: null,
    reopen: 'PENDING',
};

export const OPEN_STATUSES: readonly IntakeRequestStatus[] = ['PENDING', 'SNOOZED'];
export const DECIDED_STATUSES: readonly IntakeRequestStatus[] = ['ACCEPTED', 'DECLINED', 'MERGED'];

export type TriageRefusal = { reason: 'ALREADY_DECIDED' | 'NOT_REOPENABLE' | 'NOT_OPEN'; message: string };

const STATUS_WORD: Record<IntakeRequestStatus, string> = {
    PENDING: 'new',
    SNOOZED: 'snoozed',
    ACCEPTED: 'accepted',
    DECLINED: 'declined',
    MERGED: 'merged',
};

/** `null` when `action` may run from `status`, else the refusal a person reads. */
export function checkTriage(action: TriageAction, status: IntakeRequestStatus): TriageRefusal | null {
    if (TRIAGE_FROM[action].includes(status)) return null;
    if (action === 'reopen') {
        return status === 'ACCEPTED'
            ? { reason: 'NOT_REOPENABLE', message: 'An accepted request cannot be reopened: its work item exists.' }
            : { reason: 'NOT_OPEN', message: 'This request is already open.' };
    }
    return { reason: 'ALREADY_DECIDED', message: `This request was already ${STATUS_WORD[status]}.` };
}

/** Whether a snooze date (date-only, `YYYY-MM-DD`) lies after `today` (also date-only). */
export function snoozeDateIsFuture(until: string, today: string): boolean {
    return until > today;
}

/** The intake purge windows (decision 90): decided requests after 90 days, spam after 7. */
export const INTAKE_PURGE_DAYS = 90;
export const INTAKE_SPAM_PURGE_DAYS = 7;
/** Settled inbound email deliveries (2.6c) are purged this many days after they arrived. */
export const INBOUND_RETENTION_DAYS = 30;

// ─── Answers → the accepted item's fields ─────────────────────────────────

/** One stored answer: a snapshot of its field at the moment the request was sent. */
export interface StoredAnswer {
    fieldId: string;
    label: string;
    kind: string;
    /** The project custom field the form field filled when the request was sent. */
    customFieldId: string | null;
    value: string | string[] | number | boolean;
}

/** A live custom field of the target project, as the accept reads it. */
export interface AcceptFieldTarget {
    id: string;
    type: 'TEXT' | 'NUMBER' | 'SELECT' | 'MULTI_SELECT' | 'DATE' | 'PERSON' | 'URL' | 'CHECKBOX';
    options: ReadonlyArray<{ id: string; name: string; archivedAt: Date | null }>;
}

const KIND_FILLS: Record<string, AcceptFieldTarget['type'] | undefined> = {
    SHORT_TEXT: 'TEXT',
    SELECT: 'SELECT',
    MULTI_SELECT: 'MULTI_SELECT',
    DATE: 'DATE',
    NUMBER: 'NUMBER',
    URL: 'URL',
    CHECKBOX: 'CHECKBOX',
};

function valueText(v: StoredAnswer['value']): string {
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
}

/**
 * Split a request's answers into the custom-field values the accepted item
 * takes and the lines appended to its description. An answer fills its
 * custom field only when that field is still a live field of the target
 * project, of the type the form field fills, and (for a select) every chosen
 * option still exists there by name; anything else becomes a "Label: value"
 * line, so no answer is lost and the accept is never refused for one.
 */
export function planAcceptedFields(
    answers: readonly StoredAnswer[],
    targets: ReadonlyMap<string, AcceptFieldTarget>,
): { customFields: Record<string, unknown>; lines: string[] } {
    const customFields: Record<string, unknown> = {};
    const lines: string[] = [];
    for (const a of answers) {
        const target = a.customFieldId ? targets.get(a.customFieldId) : undefined;
        const fills = KIND_FILLS[a.kind];
        let value: unknown = undefined;
        if (target && fills === target.type && !(target.id in customFields)) {
            if (target.type === 'SELECT' || target.type === 'MULTI_SELECT') {
                const live = new Map(target.options.filter((o) => !o.archivedAt).map((o) => [o.name.toLowerCase(), o.id]));
                const names = Array.isArray(a.value) ? a.value : [String(a.value)];
                const ids = names.map((n) => live.get(n.toLowerCase()));
                if (ids.every((x): x is string => !!x)) value = target.type === 'SELECT' ? ids[0] : ids;
            } else if (target.type === 'NUMBER') {
                value = typeof a.value === 'number' ? a.value : undefined;
            } else if (target.type === 'CHECKBOX') {
                value = a.value === true ? true : undefined;
            } else if (typeof a.value === 'string') {
                value = a.value;
            }
        }
        if (value !== undefined) customFields[target!.id] = value;
        else lines.push(`${a.label}: ${valueText(a.value)}`);
    }
    return { customFields, lines };
}

/** The accepted item's description: the request's text, then the answers that filled no field. */
export function acceptedDescription(body: string | null, lines: readonly string[]): string | null {
    const parts = [body?.trim() ?? '', lines.join('\n')].filter((p) => p.length > 0);
    return parts.length > 0 ? parts.join('\n\n') : null;
}
