'use client';

/**
 * The item detail's review section (sub-phase 2.8b; ADR 0009; owner
 * decisions 148 to 165), on the Overview of the page and the sheet: the
 * live round's review steps with their reviewers, statuses, due dates and
 * responses; "Send for review"; the steps not yet opened, edited one at a
 * time (members and recipient lists, all or any, the working days, the
 * order); Sign off and Return (text required to Return, decision 157), and
 * changing a response while the step is open (decision 162); skip, withdraw,
 * add or remove a reviewer; "changed since signed off" (decision 163); and
 * the earlier rounds, read-only.
 *
 * Every button follows the `viewer` the server answered with
 * (`reviewAffordances`): this file never asks a role, a key or who the
 * assignee is. Removing a reviewer and removing a step go through the undo
 * toast (`use-review.ts`).
 *
 * The words are decision 148's: Review step, Round, Reviewer, Signed off,
 * Returned. Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { formatDate, formatDateTime } from '@inflect/ui/lib/format-date';
import { changedSinceSignedOff, REVIEW_LIMITS } from '@/app-layer/domain/review-steps';
import { useUsableRecipientLists } from '@/components/recipient-lists/use-recipient-lists';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import type { ReviewOutcomeValue, ReviewRoundData, ReviewStepData, ReviewStepModeValue, WorkItemReviewData } from '@/lib/work-items/types';

import { draftOf, liveRound, pendingSteps, useReviewWrites, useWorkItemReview, type ReviewStepDraft, type ReviewWriteResult } from '../data/use-review';
import { memberLabel, useMembers } from '../data/use-work-config';

type NameOf = (userId: string | null) => string;

function useNameOf(): NameOf {
    const tName = useTranslations('workItems');
    const { byId } = useMembers();
    return (userId) => (userId ? (memberLabel(byId.get(userId)) ?? tName('detail.formerMember')) : tName('detail.system'));
}

// ─── The step editor ──────────────────────────────────────────────────────

function StepEditorDialog({
    projectId,
    initial,
    onClose,
    onSave,
}: {
    projectId: string;
    initial: ReviewStepDraft | null;
    onClose: () => void;
    onSave: (draft: ReviewStepDraft) => Promise<ReviewWriteResult>;
}) {
    const tEditor = useTranslations('workItems.review');
    const { members, isLoading: membersLoading } = useMembers();
    const lists = useUsableRecipientLists(projectId);
    const [name, setName] = useState(initial?.name ?? '');
    const [mode, setMode] = useState<ReviewStepModeValue>(initial?.mode ?? 'ALL');
    const [days, setDays] = useState(String(initial?.dueInWorkingDays ?? 3));
    const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds ?? []);
    const [listIds, setListIds] = useState<string[]>(initial?.recipientListIds ?? []);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const modeOptions: ComboboxOption[] = (['ALL', 'ANY'] as const).map((m) => ({ value: m, label: tEditor(`mode.${m}`) }));
    const memberOptions = useMemo<ComboboxOption[]>(
        () => members.map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id })),
        [members],
    );
    const listOptions = useMemo<ComboboxOption[]>(
        () => (lists.data ?? []).map((l) => ({ value: l.id, label: l.projectId ? l.name : tEditor('workspaceList', { name: l.name }) })),
        [lists.data, tEditor],
    );

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const n = Number(days);
        if (!name.trim()) return setError(tEditor('editor.nameRequired'));
        if (!/^\d{1,2}$/.test(days) || n < REVIEW_LIMITS.minDueInWorkingDays || n > REVIEW_LIMITS.maxDueInWorkingDays) {
            return setError(tEditor('editor.daysInvalid', { max: REVIEW_LIMITS.maxDueInWorkingDays }));
        }
        if (memberIds.length === 0 && listIds.length === 0) return setError(tEditor('editor.nobody'));
        setSaving(true);
        const failure = await onSave({ name: name.trim(), mode, dueInWorkingDays: n, memberIds, recipientListIds: listIds });
        setSaving(false);
        if (failure) setError(failure);
        else onClose();
    };

    const title = initial ? tEditor('editor.editTitle') : tEditor('editor.addTitle');
    return (
        <Modal
            showModal
            setShowModal={(v) => {
                if (!(typeof v === 'function' ? v(true) : v)) onClose();
            }}
            title={title}
            onClose={onClose}
        >
            <Modal.Header title={title} description={tEditor('editor.description')} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-default">
                        <FormField label={tEditor('editor.name')}>
                            <Input id="review-step-name" maxLength={REVIEW_LIMITS.stepNameMax} value={name} onChange={(e) => setName(e.target.value)} />
                        </FormField>
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={tEditor('editor.mode')}>
                                <Combobox
                                    id="review-step-mode"
                                    selected={modeOptions.find((o) => o.value === mode) ?? null}
                                    setSelected={(o) => o && setMode(o.value as ReviewStepModeValue)}
                                    options={modeOptions}
                                    caret
                                    hideSearch
                                />
                            </FormField>
                            <FormField label={tEditor('editor.days')} hint={tEditor('editor.daysHint')}>
                                <Input id="review-step-days" inputMode="numeric" maxLength={2} value={days} onChange={(e) => setDays(e.target.value)} />
                            </FormField>
                        </div>
                        <FormField label={tEditor('editor.members')}>
                            <Combobox
                                id="review-step-members"
                                multiple
                                selected={memberOptions.filter((o) => memberIds.includes(o.value))}
                                setSelected={(opts) => setMemberIds(opts.map((o) => o.value))}
                                options={membersLoading ? undefined : memberOptions}
                                caret
                                placeholder={tEditor('editor.nobodyNamed')}
                                searchPlaceholder={tEditor('editor.searchMembers')}
                            />
                        </FormField>
                        <FormField label={tEditor('editor.lists')} hint={tEditor('editor.listsHint')}>
                            <Combobox
                                id="review-step-lists"
                                multiple
                                selected={listOptions.filter((o) => listIds.includes(o.value))}
                                setSelected={(opts) => setListIds(opts.map((o) => o.value))}
                                options={lists.isLoading ? undefined : listOptions}
                                caret
                                placeholder={tEditor('editor.noLists')}
                                searchPlaceholder={tEditor('editor.searchLists')}
                            />
                        </FormField>
                        {error && (
                            <p role="alert" className="text-sm text-content-error">
                                {error}
                            </p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tEditor('cancel')} onClick={onClose} />
                        <Button type="submit" variant="primary" text={tEditor('editor.save')} loading={saving} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}

// ─── The response dialog ──────────────────────────────────────────────────

function RespondDialog({
    step,
    outcome,
    previous,
    onClose,
    onSave,
}: {
    step: ReviewStepData;
    outcome: ReviewOutcomeValue;
    /** The viewer's response so far, when they are changing it (decision 162). */
    previous: { outcome: ReviewOutcomeValue; text: string | null } | null;
    onClose: () => void;
    onSave: (outcome: ReviewOutcomeValue, text: string) => Promise<ReviewWriteResult>;
}) {
    const tRespond = useTranslations('workItems.review');
    const [text, setText] = useState(previous && previous.outcome === outcome ? (previous.text ?? '') : '');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const returning = outcome === 'RETURNED';

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        // The server refuses a Return without text too (`RETURN_NEEDS_TEXT`); saying so here saves a round trip.
        if (returning && !text.trim()) return setError(tRespond('respond.textRequired'));
        setSaving(true);
        const failure = await onSave(outcome, text);
        setSaving(false);
        if (failure) setError(failure);
        else onClose();
    };

    const title = returning ? tRespond('respond.returnTitle', { step: step.name }) : tRespond('respond.signOffTitle', { step: step.name });
    return (
        <Modal
            showModal
            setShowModal={(v) => {
                if (!(typeof v === 'function' ? v(true) : v)) onClose();
            }}
            title={title}
            onClose={onClose}
        >
            <Modal.Header title={title} description={returning ? tRespond('respond.returnDescription') : tRespond('respond.signOffDescription')} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-default">
                        {previous && <p className="text-sm text-content-muted">{tRespond('respond.changing', { outcome: tRespond(`outcome.${previous.outcome}`) })}</p>}
                        <FormField label={returning ? tRespond('respond.textReturn') : tRespond('respond.textSignOff')} required={returning}>
                            <Textarea id="review-response-text" rows={4} maxLength={REVIEW_LIMITS.responseTextMax} value={text} onChange={(e) => setText(e.target.value)} />
                        </FormField>
                        {error && (
                            <p role="alert" className="text-sm text-content-error">
                                {error}
                            </p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tRespond('cancel')} onClick={onClose} />
                        <Button type="submit" variant="primary" text={returning ? tRespond('respond.return') : tRespond('respond.signOff')} loading={saving} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}

// ─── One step ─────────────────────────────────────────────────────────────

interface StepActions {
    respond: (step: ReviewStepData, outcome: ReviewOutcomeValue) => void;
    edit: (index: number) => void;
    move: (index: number, by: -1 | 1) => void;
    remove: (step: ReviewStepData) => void;
    skip: (step: ReviewStepData) => void;
    addReviewer: (step: ReviewStepData, userId: string) => void;
    removeReviewer: (step: ReviewStepData, userId: string) => void;
}

function StepItem({
    step,
    round,
    review,
    viewerId,
    nameOf,
    headingLevel,
    pendingIndex,
    pendingCount,
    actions,
}: {
    step: ReviewStepData;
    round: ReviewRoundData;
    review: WorkItemReviewData;
    viewerId: string;
    nameOf: NameOf;
    headingLevel: 3 | 4;
    /** The step's index among the steps not yet opened, when it is one and may be edited. */
    pendingIndex: number | null;
    pendingCount: number;
    actions: StepActions | null;
}) {
    const tStep = useTranslations('workItems.review');
    const { members } = useMembers();
    const headingId = useId();
    const Heading = headingLevel === 3 ? 'h3' : 'h4';
    const viewer = review.viewer;
    const live = round.status === 'PLANNED' || round.status === 'OPEN';
    const listName = new Map(step.lists.map((l) => [l.id, l.name]));
    const mine = step.reviewers.find((r) => r.userId === viewerId && r.withdrawnAt === null);
    const canRespond = actions && viewer.respondStepId === step.id;
    const canSkip = actions && viewer.skip && round.status === 'OPEN' && (step.status === 'OPEN' || step.status === 'PENDING');
    const onStep = new Set(step.reviewers.map((r) => r.userId));
    const addOptions = members.filter((m) => !onStep.has(m.id)).map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id }));

    return (
        <li className="space-y-tight rounded-md border border-border-subtle p-3" aria-labelledby={headingId} data-review-step={step.status}>
            <div className="flex flex-wrap items-baseline gap-2">
                <Heading id={headingId} className="text-sm font-semibold text-content-emphasis">
                    {step.name}
                </Heading>
                <span className="rounded border border-border-subtle px-1 text-xs text-content-muted">{tStep(`stepStatus.${step.status}`)}</span>
                <span className="text-xs text-content-muted">{tStep(`mode.${step.mode}`)}</span>
                <span className="text-xs text-content-muted">
                    {step.dueOn ? tStep('dueOn', { date: step.dueOn }) : tStep('dueIn', { days: step.dueInWorkingDays })}
                </span>
            </div>
            {step.skipReason && (
                <p className="text-xs text-content-muted">{tStep(`skipped.${step.skipReason}`, { name: nameOf(step.skippedByUserId) })}</p>
            )}
            {step.noReviewersLeft && (
                <p role="status" className="text-xs text-content-warning">
                    {tStep('noReviewersLeft')}
                </p>
            )}
            {step.lists.length > 0 && (
                <p className="text-xs text-content-muted">
                    {tStep('listsNamed', { lists: step.lists.map((l) => (l.archived ? tStep('archivedList', { name: l.name }) : l.name)).join(', ') })}
                </p>
            )}
            <ul className="space-y-tight" aria-label={tStep('reviewersOf', { step: step.name })}>
                {step.reviewers.map((r) => {
                    const name = nameOf(r.userId);
                    const changed = changedSinceSignedOff(r, round.status, review.itemVersion);
                    const removable = actions && viewer.skip && step.status === 'OPEN' && r.outcome === null && r.withdrawnAt === null;
                    return (
                        <li key={r.userId} className="text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className={r.withdrawnAt ? 'text-content-muted line-through' : undefined}>{name}</span>
                                {r.viaRecipientListId && (
                                    <span className="text-xs text-content-muted">{tStep('via', { list: listName.get(r.viaRecipientListId) ?? tStep('aList') })}</span>
                                )}
                                <span className="text-xs text-content-muted">
                                    {r.withdrawnAt
                                        ? tStep(`withdrawn.${r.withdrawnReason ?? 'REMOVED_BY_PERSON'}`)
                                        : r.outcome
                                          ? tStep(`outcome.${r.outcome}`)
                                          : step.status === 'PENDING'
                                            ? tStep('notAskedYet')
                                            : tStep('pending')}
                                </span>
                                {r.respondedAt && <span className="text-xs text-content-muted">{formatDateTime(r.respondedAt)}</span>}
                                {changed && (
                                    <span className="rounded border border-border-subtle px-1 text-xs text-content-warning">{tStep('changedSinceSignedOff')}</span>
                                )}
                                {removable && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        text={tStep('remove')}
                                        aria-label={tStep('removeReviewer', { name, step: step.name })}
                                        onClick={() => actions.removeReviewer(step, r.userId)}
                                    />
                                )}
                            </div>
                            {r.responseText && <p className="mt-1 whitespace-pre-wrap rounded bg-bg-subtle p-2 text-sm">{r.responseText}</p>}
                        </li>
                    );
                })}
            </ul>
            {step.reviewers.length === 0 && step.lists.length === 0 && <p className="text-xs text-content-muted">{tStep('nobodyYet')}</p>}
            {actions && (
                <div className="flex flex-wrap items-center gap-tight">
                    {canRespond && (
                        <>
                            {mine?.outcome && (
                                <span className="text-xs text-content-muted">{tStep('youResponded', { outcome: tStep(`outcome.${mine.outcome}`) })}</span>
                            )}
                            <Button
                                variant="primary"
                                size="sm"
                                text={tStep('signOff')}
                                aria-label={tStep('signOffStep', { step: step.name })}
                                onClick={() => actions.respond(step, 'SIGNED_OFF')}
                            />
                            <Button
                                variant="secondary"
                                size="sm"
                                text={tStep('return')}
                                aria-label={tStep('returnStep', { step: step.name })}
                                onClick={() => actions.respond(step, 'RETURNED')}
                            />
                        </>
                    )}
                    {live && viewer.editSteps && step.status === 'OPEN' && (
                        <Combobox
                            selected={null}
                            setSelected={(o) => o && actions.addReviewer(step, o.value)}
                            options={addOptions}
                            caret
                            placeholder={tStep('addReviewer')}
                            searchPlaceholder={tStep('editor.searchMembers')}
                            buttonProps={{ 'aria-label': tStep('addReviewerTo', { step: step.name }) }}
                        />
                    )}
                    {pendingIndex !== null && (
                        <>
                            <Button variant="ghost" size="sm" text={tStep('edit')} aria-label={tStep('editStep', { step: step.name })} onClick={() => actions.edit(pendingIndex)} />
                            <Button
                                variant="ghost"
                                size="sm"
                                text={tStep('moveUp')}
                                aria-label={tStep('moveStepUp', { step: step.name })}
                                disabled={pendingIndex === 0}
                                onClick={() => actions.move(pendingIndex, -1)}
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                text={tStep('moveDown')}
                                aria-label={tStep('moveStepDown', { step: step.name })}
                                disabled={pendingIndex === pendingCount - 1}
                                onClick={() => actions.move(pendingIndex, 1)}
                            />
                            <Button variant="ghost" size="sm" text={tStep('remove')} aria-label={tStep('removeStep', { step: step.name })} onClick={() => actions.remove(step)} />
                        </>
                    )}
                    {canSkip && (
                        <Button
                            variant="ghost"
                            size="sm"
                            text={step.noReviewersLeft ? tStep('closeStep') : tStep('skip')}
                            aria-label={step.noReviewersLeft ? tStep('closeStepNamed', { step: step.name }) : tStep('skipStep', { step: step.name })}
                            onClick={() => actions.skip(step)}
                        />
                    )}
                </div>
            )}
        </li>
    );
}

// ─── A round ──────────────────────────────────────────────────────────────

/** "Round 1: Returned by Ana on 3 Dec 2026". */
function roundLine(round: ReviewRoundData, nameOf: NameOf, t: (key: string, values?: Record<string, string | number>) => string): string {
    const status = t(`roundStatus.${round.status}`);
    if (!round.endedAt) return t('roundHeading', { number: round.number, status });
    const date = formatDate(round.endedAt);
    return round.endedByUserId
        ? t('roundEndedBy', { number: round.number, status, name: nameOf(round.endedByUserId), date })
        : t('roundEnded', { number: round.number, status, date });
}

// ─── The section ──────────────────────────────────────────────────────────

export interface ReviewStepsProps {
    workItemId: string;
    projectId: string;
    viewerId: string;
}

export function ReviewSteps({ workItemId, projectId, viewerId }: ReviewStepsProps) {
    const tReview = useTranslations('workItems.review');
    const { data: review, error } = useWorkItemReview(workItemId);
    const writes = useReviewWrites(workItemId);
    const nameOf = useNameOf();
    const headingId = useId();
    const [editing, setEditing] = useState<{ index: number | null } | null>(null);
    const [responding, setResponding] = useState<{ step: ReviewStepData; outcome: ReviewOutcomeValue } | null>(null);

    const live = liveRound(review);
    const pending = pendingSteps(live);
    const ended = (review?.rounds ?? []).filter((r) => r !== live);
    const lastEnded = ended[0] ?? null;
    const viewer = review?.viewer;

    const savePending = (drafts: ReviewStepDraft[]) => writes.setSteps(live, drafts);
    const actions: StepActions = {
        respond: (step, outcome) => setResponding({ step, outcome }),
        edit: (index) => setEditing({ index }),
        move: (index, by) => {
            const drafts = pending.map(draftOf);
            const [moved] = drafts.splice(index, 1);
            drafts.splice(index + by, 0, moved!);
            void savePending(drafts).then((failure) => failure && writes.reportFailure(failure));
        },
        remove: (step) => live && writes.removeStep(live, step),
        skip: (step) => live && void writes.skip(live, step),
        addReviewer: (step, userId) => void writes.addReviewer(step, userId),
        removeReviewer: (step, userId) => writes.removeReviewer(step, userId, nameOf(userId)),
    };

    const mineOn = (step: ReviewStepData) => step.reviewers.find((r) => r.userId === viewerId && r.withdrawnAt === null && r.outcome !== null);

    return (
        <section aria-labelledby={headingId} className="space-y-default" data-testid="review-steps">
            <h2 id={headingId} className="text-sm font-semibold text-content-emphasis">
                {tReview('title')}
            </h2>
            {error && <p role="alert">{tReview('loadFailed')}</p>}
            {review && (
                <>
                    {/* How the last round ended, while the next waits to be sent. */}
                    {live?.status === 'PLANNED' && lastEnded && (lastEnded.status === 'RETURNED' || lastEnded.status === 'WITHDRAWN') && (
                        <p role="status" className="text-sm text-content-warning">
                            {tReview(`afterRound.${lastEnded.status}`, { number: lastEnded.number, next: live.number })}
                        </p>
                    )}
                    {!live && lastEnded && <p className="text-sm text-content-muted">{roundLine(lastEnded, nameOf, tReview)}</p>}
                    {!live && !lastEnded && <p className="text-sm text-content-muted">{tReview('none')}</p>}
                    {live && (
                        <div className="space-y-tight">
                            <p className="text-sm text-content-emphasis">{roundLine(live, nameOf, tReview)}</p>
                            {live.steps.length === 0 && <p className="text-sm text-content-muted">{tReview('noSteps')}</p>}
                            <ol className="space-y-tight" aria-label={tReview('stepsOfRound', { number: live.number })}>
                                {live.steps.map((step) => {
                                    const index = pending.indexOf(step);
                                    return (
                                        <StepItem
                                            key={step.id}
                                            step={step}
                                            round={live}
                                            review={review}
                                            viewerId={viewerId}
                                            nameOf={nameOf}
                                            headingLevel={3}
                                            pendingIndex={viewer?.editSteps && index !== -1 ? index : null}
                                            pendingCount={pending.length}
                                            actions={actions}
                                        />
                                    );
                                })}
                            </ol>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-tight">
                        {viewer?.editSteps && <Button variant="secondary" size="sm" text={tReview('addStep')} onClick={() => setEditing({ index: null })} />}
                        {viewer?.send && live && <Button variant="primary" size="sm" text={tReview('send')} onClick={() => void writes.send(live)} />}
                        {viewer?.withdraw && live && <Button variant="ghost" size="sm" text={tReview('withdraw')} onClick={() => void writes.withdraw(live)} />}
                    </div>
                    {ended.length > 0 && (
                        <div className="space-y-tight">
                            <h3 className="text-sm font-semibold text-content-emphasis">{tReview('earlierRounds')}</h3>
                            {ended.map((round) => (
                                <details key={round.id} className="rounded-md border border-border-subtle p-2">
                                    <summary className="cursor-pointer text-sm">{roundLine(round, nameOf, tReview)}</summary>
                                    <ol className="mt-2 space-y-tight" aria-label={tReview('stepsOfRound', { number: round.number })}>
                                        {round.steps.map((step) => (
                                            <StepItem
                                                key={step.id}
                                                step={step}
                                                round={round}
                                                review={review}
                                                viewerId={viewerId}
                                                nameOf={nameOf}
                                                headingLevel={4}
                                                pendingIndex={null}
                                                pendingCount={0}
                                                actions={null}
                                            />
                                        ))}
                                    </ol>
                                </details>
                            ))}
                        </div>
                    )}
                </>
            )}
            {editing && (
                <StepEditorDialog
                    projectId={projectId}
                    initial={editing.index !== null && pending[editing.index] ? draftOf(pending[editing.index]!) : null}
                    onClose={() => setEditing(null)}
                    onSave={(draft) => {
                        const drafts = pending.map(draftOf);
                        if (editing.index === null) drafts.push(draft);
                        else drafts[editing.index] = draft;
                        return savePending(drafts);
                    }}
                />
            )}
            {responding && (
                <RespondDialog
                    step={responding.step}
                    outcome={responding.outcome}
                    previous={(() => {
                        const mine = mineOn(responding.step);
                        return mine?.outcome ? { outcome: mine.outcome, text: mine.responseText } : null;
                    })()}
                    onClose={() => setResponding(null)}
                    onSave={(outcome, text) => writes.respond(responding.step, outcome, text)}
                />
            )}
        </section>
    );
}

/**
 * Who the item waits on while a round is open (decision 152): the open
 * step's pending reviewers, read-only. Null when no round is open: the
 * detail then shows the waiting-on picker.
 */
export function useReviewWaitingOn(workItemId: string | null): { stepName: string; userIds: string[] } | null {
    const { data } = useWorkItemReview(workItemId);
    const round = liveRound(data);
    if (!data || round?.status !== 'OPEN') return null;
    const step = round.steps.find((s) => s.status === 'OPEN');
    return { stepName: step?.name ?? '', userIds: data.waitingOnReviewerIds };
}
