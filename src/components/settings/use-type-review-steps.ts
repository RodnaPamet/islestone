'use client';

/**
 * A work item type's default review steps and its Done check (sub-phase
 * 2.8c; decisions 149 and 159): the read (`GET /work-item-types/:id/review-steps`)
 * and the write, which replaces the type's steps as a whole and answers with
 * them. Removing a step goes through the undo toast: it leaves the list at
 * once and the change is sent when the window closes
 * (`tests/guards/undo-toast-coverage.test.ts` lists this file). Nothing here
 * decides who may write: the page receives the affordances, asked on the
 * server.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import type { TypeReviewStepData, TypeReviewStepsData } from '@/lib/work-items/types';

import type { ReviewStepDraft, ReviewWriteResult } from '../work-items/data/use-review';
import { refusalText, SETTINGS_PATHS, useSettingsApi } from './settings-data';

/** A type's review steps (tenant-relative). */
export const typeReviewStepsPath = (typeId: string) => `/work-item-types/${encodeURIComponent(typeId)}/review-steps`;

export function useTypeReviewSteps(typeId: string) {
    return useTenantSWR<TypeReviewStepsData>(typeReviewStepsPath(typeId));
}

/** A default step as the editor and the PUT take it. */
export function defaultDraftOf(step: TypeReviewStepData): ReviewStepDraft {
    return { name: step.name, mode: step.mode, dueInWorkingDays: step.dueInWorkingDays, memberIds: [...step.memberIds], recipientListIds: [...step.recipientListIds] };
}

export function useTypeReviewStepWrites(typeId: string) {
    const { send, revalidate, setPath } = useSettingsApi();
    const triggerUndo = useToastWithUndo();
    const toast = useToast();
    const t = useTranslations('settings.typeReviewSteps');
    const tCommon = useTranslations('settings.common');
    const path = typeReviewStepsPath(typeId);

    return useMemo(() => {
        const put = (reviewRequiredForDone: boolean, steps: readonly ReviewStepDraft[]) =>
            send<TypeReviewStepsData>('PUT', path, { reviewRequiredForDone, steps });
        /** Replace the steps (or the switch); answers with the server's refusal, or null. */
        const save = async (reviewRequiredForDone: boolean, steps: readonly ReviewStepDraft[]): Promise<ReviewWriteResult> => {
            try {
                const fresh = await put(reviewRequiredForDone, steps);
                await setPath<TypeReviewStepsData>(path, () => fresh);
                await revalidate(SETTINGS_PATHS.types);
                return null;
            } catch (err) {
                await revalidate(path);
                return refusalText(err, tCommon('failed'));
            }
        };
        return {
            save,
            /** Remove one step through the undo toast: it leaves at once, the PUT goes when the window closes. */
            removeStep(current: TypeReviewStepsData, step: TypeReviewStepData) {
                const remaining = current.steps.filter((s) => s.id !== step.id);
                let before: TypeReviewStepsData | undefined;
                void setPath<TypeReviewStepsData>(path, (data) => {
                    before = data;
                    return data ? { ...data, steps: data.steps.filter((s) => s.id !== step.id) } : data;
                });
                triggerUndo({
                    message: t('stepRemoved', { name: step.name }),
                    undoMessage: tCommon('undo'),
                    action: () => put(current.reviewRequiredForDone, remaining.map(defaultDraftOf)),
                    undoAction: () => {
                        void setPath<TypeReviewStepsData>(path, () => before);
                    },
                    onCommit: () => {
                        void revalidate(path);
                    },
                    onError: (err) => {
                        void setPath<TypeReviewStepsData>(path, () => before).then(() => revalidate(path));
                        toast.error(refusalText(err, tCommon('failed')));
                    },
                });
            },
        };
    }, [send, revalidate, setPath, triggerUndo, toast, t, tCommon, path]);
}
