'use client';

/**
 * An item's review steps (sub-phase 2.8b; 2.8a's API, ADR 0009): the read
 * (`GET /work-items/:id/review`, one SWR key the page and the sheet share)
 * and every write, each answered with the fresh review, which replaces the
 * cached one. What the section offers comes from the answer's `viewer`
 * (`reviewAffordances`, asked on the server); nothing here decides who may.
 *
 * Every write that names the round sends its version as `If-Match` (editing
 * the steps, sending, withdrawing, skipping). Removing a reviewer and
 * removing a step not yet opened go through the undo toast: the reviewer or
 * the step leaves the section at once and the request is sent when the
 * window closes (`tests/guards/undo-toast-coverage.test.ts`).
 *
 * After a write the item itself is read again and placed in every list
 * (sending clears waiting on, an ended round names the assignee, decision
 * 152), and the lists filtered by reviewer or by "waiting on me" are read
 * again: the client cannot place a row in them.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { ReviewOutcomeValue, ReviewRoundData, ReviewStepData, ReviewStepModeValue, WorkItemDetailData, WorkItemReviewData } from '@/lib/work-items/types';

import { filtersByReviewer, waitsOnMe } from './list-filters';
import { itemPaths } from './use-work-item-collab';
import { toRow } from './use-work-item-mutations';
import { useWorkItemCache } from './work-item-cache';

/** The review's path under the item (tenant-relative). */
export const reviewPath = (itemId: string) => `/work-items/${encodeURIComponent(itemId)}/review`;

/** One step as the editor holds it and `PUT …/review/steps` takes it. */
export interface ReviewStepDraft {
    name: string;
    mode: ReviewStepModeValue;
    dueInWorkingDays: number;
    memberIds: string[];
    recipientListIds: string[];
}

/** A step not yet opened, as the editor and the PUT read it: its named members and lists. */
export function draftOf(step: ReviewStepData): ReviewStepDraft {
    return {
        name: step.name,
        mode: step.mode,
        dueInWorkingDays: step.dueInWorkingDays,
        memberIds: step.reviewers.filter((r) => r.withdrawnAt === null && r.viaRecipientListId === null).map((r) => r.userId),
        recipientListIds: step.lists.map((l) => l.id),
    };
}

/** The live (planned or open) round, when there is one: the first of the newest-first list. */
export function liveRound(review: WorkItemReviewData | undefined): ReviewRoundData | null {
    const first = review?.rounds[0];
    return first && (first.status === 'PLANNED' || first.status === 'OPEN') ? first : null;
}

/** The steps a PUT replaces: every step of the live round not yet opened, in order. */
export function pendingSteps(round: ReviewRoundData | null): ReviewStepData[] {
    return (round?.steps ?? []).filter((s) => s.status === 'PENDING');
}

export function useWorkItemReview(itemId: string | null) {
    return useTenantSWR<WorkItemReviewData>(itemId ? reviewPath(itemId) : null);
}

/** A write's outcome: null when it was saved, else the sentence to show. */
export type ReviewWriteResult = string | null;

export function useReviewWrites(itemId: string) {
    const cache = useWorkItemCache();
    const apiUrl = useTenantApiUrl();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('workItems.review');

    return useMemo(() => {
        const path = reviewPath(itemId);
        const url = (sub = '') => apiUrl(`${path}${sub}`);
        const reason = (err: unknown) => (err instanceof ApiClientError && err.reason ? err.reason : t('failed'));

        /** The item, its Activity and the lists the client cannot place it in, read again. */
        async function afterChange() {
            const fresh = (await cache.revalidateItem(itemId)) as WorkItemDetailData | undefined;
            if (fresh) cache.applyRow(toRow(fresh));
            void cache.revalidatePath(itemPaths(itemId).activity);
            cache.revalidateLists((f) => filtersByReviewer(f) || waitsOnMe(f));
        }

        /** Send a write; its answer is the fresh review. A refusal re-reads the review and returns the reason. */
        async function write(send: () => Promise<WorkItemReviewData | undefined>): Promise<ReviewWriteResult> {
            try {
                const answer = await send();
                if (answer) await cache.setPath<WorkItemReviewData>(path, () => answer);
                else await cache.revalidatePath(path);
                await afterChange();
                return null;
            } catch (err) {
                void cache.revalidatePath(path);
                if (!(err instanceof ApiClientError)) throw err;
                return reason(err);
            }
        }

        /** A write from a button: a refusal is a toast. */
        async function act(send: () => Promise<WorkItemReviewData | undefined>): Promise<boolean> {
            const failure = await write(send);
            if (failure) toast.error(failure);
            return failure === null;
        }

        const putSteps = (round: ReviewRoundData | null, steps: readonly ReviewStepDraft[]) =>
            apiSend<WorkItemReviewData>('PUT', url('/steps'), { steps }, { ifMatch: round?.version });

        return {
            /** Show a refusal a caller already holds (a reorder from the section). */
            reportFailure(message: string) {
                toast.error(message);
            },

            /** Replace the steps not yet opened (`PUT …/review/steps`); the round's version as `If-Match` once there is one. */
            setSteps(round: ReviewRoundData | null, steps: readonly ReviewStepDraft[]): Promise<ReviewWriteResult> {
                return write(() => putSteps(round, steps));
            },

            /** "Send for review" (decision 155). */
            send(round: ReviewRoundData) {
                return act(() => apiSend<WorkItemReviewData>('POST', url('/send'), undefined, { ifMatch: round.version }));
            },

            /** End the open round unfinished; a planned round with the same steps follows. */
            withdraw(round: ReviewRoundData) {
                return act(() => apiSend<WorkItemReviewData>('POST', url('/withdraw'), undefined, { ifMatch: round.version }));
            },

            /** Skip a step, or close one whose reviewers left (decision 150). */
            skip(round: ReviewRoundData, step: ReviewStepData) {
                return act(() => apiSend<WorkItemReviewData>('POST', url(`/steps/${encodeURIComponent(step.id)}/skip`), undefined, { ifMatch: round.version }));
            },

            /** Signed off or Returned, or a change to it while the step is open (decisions 157 and 162). */
            respond(step: ReviewStepData, outcome: ReviewOutcomeValue, text: string): Promise<ReviewWriteResult> {
                return write(() =>
                    apiSend<WorkItemReviewData>('POST', url(`/steps/${encodeURIComponent(step.id)}/respond`), { outcome, text: text.trim() ? text : null }),
                );
            },

            /** Ask one more person on a step that has not ended. */
            addReviewer(step: ReviewStepData, userId: string) {
                return act(() => apiSend<WorkItemReviewData>('POST', url(`/steps/${encodeURIComponent(step.id)}/reviewers`), { userId }));
            },

            /**
             * Withdraw a pending reviewer, through the undo toast: they leave
             * the step on screen now and the request goes when the window
             * closes. Undo puts them back and sends nothing.
             */
            removeReviewer(step: ReviewStepData, userId: string, name: string) {
                let before: WorkItemReviewData | undefined;
                void cache.setPath<WorkItemReviewData>(path, (current) => {
                    before = current;
                    if (!current) return current;
                    return {
                        ...current,
                        rounds: current.rounds.map((r) => ({
                            ...r,
                            steps: r.steps.map((s) =>
                                s.id === step.id
                                    ? { ...s, reviewers: s.reviewers.filter((x) => x.userId !== userId), pendingUserIds: s.pendingUserIds.filter((id) => id !== userId) }
                                    : s,
                            ),
                        })),
                    };
                });
                triggerUndo({
                    message: t('reviewerRemoved', { name, step: step.name }),
                    undoMessage: t('undo'),
                    action: () => apiSend('DELETE', url(`/steps/${encodeURIComponent(step.id)}/reviewers/${encodeURIComponent(userId)}`)),
                    undoAction: () => {
                        void cache.setPath<WorkItemReviewData>(path, () => before);
                    },
                    onCommit: () => {
                        void cache.revalidatePath(path);
                        void afterChange();
                    },
                    onError: (err) => {
                        void cache.setPath<WorkItemReviewData>(path, () => before);
                        void cache.revalidatePath(path);
                        toast.error(reason(err));
                    },
                });
            },

            /**
             * Remove a step not yet opened, through the undo toast: the step
             * leaves the section now, and the remaining steps are sent when
             * the window closes (`PUT …/review/steps`, the round's version).
             */
            removeStep(round: ReviewRoundData, step: ReviewStepData) {
                const remaining = pendingSteps(round).filter((s) => s.id !== step.id).map(draftOf);
                let before: WorkItemReviewData | undefined;
                void cache.setPath<WorkItemReviewData>(path, (current) => {
                    before = current;
                    if (!current) return current;
                    return { ...current, rounds: current.rounds.map((r) => (r.id === round.id ? { ...r, steps: r.steps.filter((s) => s.id !== step.id) } : r)) };
                });
                triggerUndo({
                    message: t('stepRemoved', { name: step.name }),
                    undoMessage: t('undo'),
                    action: () => putSteps(round, remaining),
                    undoAction: () => {
                        void cache.setPath<WorkItemReviewData>(path, () => before);
                    },
                    onCommit: () => {
                        void cache.revalidatePath(path);
                        void afterChange();
                    },
                    onError: (err) => {
                        void cache.setPath<WorkItemReviewData>(path, () => before);
                        void cache.revalidatePath(path);
                        toast.error(reason(err));
                    },
                });
            },
        };
    }, [itemId, cache, apiUrl, toast, triggerUndo, t]);
}
