'use client';

/**
 * A work item's marked answer on the detail (sub-phase 2.4b-c; ADR 0002 §15;
 * owner decisions 113 to 118):
 *
 *   - `PinnedAnswer`: the answer under the description, with its author, and
 *     "Clear answer" for someone who may edit the item (the state stays);
 *   - `useMarkAnswer`: marking from a comment. A closed item, or an open one
 *     whose team has one Done state, is marked at once; when the team has
 *     several Done states the person chooses one (`MarkAnswerDialog`, the
 *     first preselected, decision 114).
 *
 * Who may mark is the comment policy's (`commentAffordances`), asked by the
 * comments panel; the server asks the same rules.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { formatDateTime } from '@inflect/ui/lib/format-date';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import type { WorkItemDetailData, WorkItemRow } from '@/lib/work-items/types';

import { memberLabel, useMembers, useWorkConfig } from '../data/use-work-config';
import { useWorkItemMutations } from '../data/use-work-item-mutations';
import { MentionText } from '../mentions/MentionText';

export function PinnedAnswer({ item, row, canEdit }: { item: WorkItemDetailData; row: WorkItemRow; canEdit: boolean }) {
    const tAnswer = useTranslations('workItems.answer');
    const { byId } = useMembers();
    const mutations = useWorkItemMutations();
    const answer = item.answer;
    if (!answer) return null;
    return (
        <section aria-labelledby={`answer-${item.id}`} className="space-y-tight rounded-md border border-border-emphasis p-3">
            <h2 id={`answer-${item.id}`} className="text-sm font-semibold text-content-emphasis">
                {tAnswer('title')}
            </h2>
            <p className="text-xs text-content-muted">
                {memberLabel(byId.get(answer.authorUserId)) ?? tAnswer('formerMember')} · {formatDateTime(answer.createdAt)}
            </p>
            <MentionText text={answer.body} mentions={answer.mentions} />
            {canEdit && (
                <Button variant="ghost" size="sm" text={tAnswer('clear')} onClick={() => mutations.clearAnswer(row, answer)} />
            )}
        </section>
    );
}

/** The Done states an open item may move to on marking, in the team's order. */
function useDoneStates(teamId: string) {
    const config = useWorkConfig();
    return config.statesOfTeam(teamId).filter((s) => s.category === 'DONE');
}

/**
 * Mark a comment as the answer: at once, or after the person chooses a Done
 * state when the team has several. Render `dialog` once in the detail.
 */
export function useMarkAnswer(row: WorkItemRow | null) {
    const mutations = useWorkItemMutations();
    const doneStates = useDoneStates(row?.teamId ?? '');
    const [pending, setPending] = useState<string | null>(null);
    const closed = row ? row.stateCategory === 'DONE' || row.stateCategory === 'CANCELLED' : false;

    const mark = (commentId: string) => {
        if (!row) return;
        if (closed) return void mutations.markAnswer(row, commentId, null);
        if (doneStates.length > 1) return setPending(commentId);
        return void mutations.markAnswer(row, commentId, doneStates[0]?.id ?? null);
    };

    const dialog =
        row && pending ? (
            <MarkAnswerDialog
                states={doneStates}
                onCancel={() => setPending(null)}
                onConfirm={(stateId) => {
                    const commentId = pending;
                    setPending(null);
                    void mutations.markAnswer(row, commentId, stateId);
                }}
            />
        ) : null;
    return { mark, dialog };
}

function MarkAnswerDialog({
    states,
    onCancel,
    onConfirm,
}: {
    states: ReadonlyArray<{ id: string; name: string }>;
    onCancel: () => void;
    onConfirm: (stateId: string) => void;
}) {
    const tDialog = useTranslations('workItems.answer');
    const [stateId, setStateId] = useState(states[0]?.id ?? '');
    const options: ComboboxOption[] = states.map((s) => ({ value: s.id, label: s.name }));
    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (stateId) onConfirm(stateId);
    };
    return (
        <Modal
            showModal
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(true) : v;
                if (!next) onCancel();
            }}
            title={tDialog('dialogTitle')}
            onClose={onCancel}
        >
            <Modal.Header title={tDialog('dialogTitle')} description={tDialog('dialogDescription')} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <FormField label={tDialog('doneState')}>
                        <Combobox
                            id="answer-done-state"
                            selected={options.find((o) => o.value === stateId) ?? null}
                            setSelected={(o) => o && setStateId(String(o.value))}
                            options={options}
                            caret
                            hideSearch
                            buttonProps={{ 'aria-label': tDialog('doneState') }}
                        />
                    </FormField>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tDialog('cancel')} onClick={onCancel} />
                        <Button type="submit" variant="primary" text={tDialog('confirm')} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}
