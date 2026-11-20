'use client';

/**
 * Settings → a work item type → Review steps (sub-phase 2.8c; ADR 0009 §14
 * and §15; owner decisions 149, 158 and 159): the type's default review
 * steps, copied onto every new item of the type as its first round, planned
 * and never sent; and "Review must finish before Done". The steps name
 * members and the workspace's recipient lists (a type spans every project);
 * a change applies to items made afterwards, never to existing ones. The
 * item's assignee is left out of the copy (decision 158).
 *
 * Every write is offered only with `manageWorkConfig`, the predicate the
 * usecase asserts (asked on the server); refusals are shown as the server
 * words them. Removing a step goes through the undo toast
 * (`use-type-review-steps.ts`).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { useWorkspaceRecipientLists } from '@/components/recipient-lists/use-recipient-lists';
import { useToast } from '@/components/ui/hooks';
import { Switch } from '@/components/ui/switch';
import { createColumns } from '@/components/ui/table';
import { StepEditorDialog } from '@/components/work-items/detail/ReviewSteps';
import type { ReviewStepDraft } from '@/components/work-items/data/use-review';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import { REVIEW_LIMITS } from '@/app-layer/domain/review-steps';
import type { TypeReviewStepData, WorkConfigAffordances } from '@/lib/work-items/types';

import { useWorkItemTypes } from './settings-data';
import { defaultDraftOf, useTypeReviewSteps, useTypeReviewStepWrites } from './use-type-review-steps';

type Editing = { mode: 'add' } | { mode: 'edit'; step: TypeReviewStepData } | null;

export function WorkItemTypeReviewStepsSettings({ typeId, affordances }: { typeId: string; affordances: WorkConfigAffordances }) {
    const t = useTranslations('settings');
    const tSteps = useTranslations('settings.typeReviewSteps');
    const tMode = useTranslations('workItems.review.mode');
    const toast = useToast();
    const { data: types } = useWorkItemTypes();
    const { data, error, isLoading } = useTypeReviewSteps(typeId);
    const writes = useTypeReviewStepWrites(typeId);
    const { byId } = useMembers();
    const lists = useWorkspaceRecipientLists();
    const [editing, setEditing] = useState<Editing>(null);
    const canManage = affordances.manageWorkConfig;
    const typeName = types?.find((ty) => ty.id === typeId)?.name ?? '';
    const required = data?.reviewRequiredForDone ?? false;
    const steps = useMemo(() => data?.steps ?? [], [data]);

    const columns = useMemo(() => {
        const listName = (id: string, fallback?: string) => lists.data?.find((l) => l.id === id)?.name ?? fallback ?? tSteps('unknownList');
        const move = async (index: number, by: -1 | 1) => {
            const drafts = steps.map(defaultDraftOf);
            const [moved] = drafts.splice(index, 1);
            drafts.splice(index + by, 0, moved!);
            const failure = await writes.save(required, drafts);
            if (failure) toast.error(failure);
        };
        return createColumns<TypeReviewStepData>([
            { id: 'position', header: tSteps('col.position'), cell: ({ row }) => row.original.position },
            { id: 'name', header: tSteps('col.name'), cell: ({ row }) => <span className="text-content-emphasis">{row.original.name}</span> },
            { id: 'mode', header: tSteps('col.mode'), cell: ({ row }) => tMode(row.original.mode) },
            { id: 'days', header: tSteps('col.days'), cell: ({ row }) => row.original.dueInWorkingDays },
            {
                id: 'reviewers',
                header: tSteps('col.reviewers'),
                cell: ({ row }) => {
                    const s = row.original;
                    const names = [
                        ...s.memberIds.map((id) => memberLabel(byId.get(id)) ?? tSteps('formerMember')),
                        ...s.lists.map((l) => (l.archived ? tSteps('archivedList', { name: listName(l.id, l.name) }) : tSteps('list', { name: listName(l.id, l.name) }))),
                    ];
                    return names.length > 0 ? names.join(', ') : <span className="text-content-warning">{tSteps('nobody')}</span>;
                },
            },
            ...(canManage
                ? [
                      {
                          id: 'actions',
                          header: t('common.actions'),
                          cell: ({ row }: { row: { original: TypeReviewStepData; index: number } }) => {
                              const s = row.original;
                              const index = steps.findIndex((x) => x.id === s.id);
                              return (
                                  <div className="flex flex-wrap gap-tight">
                                      <Button variant="ghost" size="sm" text={tSteps('edit')} aria-label={tSteps('editNamed', { name: s.name })} onClick={() => setEditing({ mode: 'edit', step: s })} />
                                      {index > 0 && (
                                          <Button variant="ghost" size="sm" text={tSteps('moveUp')} aria-label={tSteps('moveUpNamed', { name: s.name })} onClick={() => void move(index, -1)} />
                                      )}
                                      {index < steps.length - 1 && (
                                          <Button variant="ghost" size="sm" text={tSteps('moveDown')} aria-label={tSteps('moveDownNamed', { name: s.name })} onClick={() => void move(index, 1)} />
                                      )}
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          text={tSteps('remove')}
                                          aria-label={tSteps('removeNamed', { name: s.name })}
                                          onClick={() => data && writes.removeStep(data, s)}
                                      />
                                  </div>
                              );
                          },
                      },
                  ]
                : []),
        ]);
    }, [t, tSteps, tMode, canManage, steps, data, writes, required, toast, byId, lists.data]);

    const saveStep = async (draft: ReviewStepDraft) => {
        const drafts = steps.map(defaultDraftOf);
        if (editing?.mode === 'edit') {
            const i = steps.findIndex((s) => s.id === editing.step.id);
            drafts[i] = draft;
        } else drafts.push(draft);
        return writes.save(required, drafts);
    };

    const toggleRequired = async (value: boolean) => {
        const failure = await writes.save(value, steps.map(defaultDraftOf));
        if (failure) toast.error(failure);
        else toast.success(value ? tSteps('requiredOn') : tSteps('requiredOff'));
    };

    return (
        <EntityListPage<TypeReviewStepData>
            header={{
                title: tSteps('title', { type: typeName }),
                description: tSteps('description'),
                back: { smart: true },
                actions:
                    canManage && steps.length < REVIEW_LIMITS.maxSteps ? (
                        <Button id="add-type-review-step-btn" variant="primary" icon={<Plus />} text={tSteps('add')} onClick={() => setEditing({ mode: 'add' })} />
                    ) : undefined,
            }}
            banner={
                <div className="space-y-tight">
                    <div className="flex flex-wrap items-center gap-tight">
                        <Switch
                            id="type-review-required"
                            checked={required}
                            disabled={!canManage || !data}
                            onCheckedChange={(v) => void toggleRequired(v)}
                            aria-label={tSteps('requiredFor', { type: typeName })}
                        />
                        <label htmlFor="type-review-required" className="text-sm text-content-default">
                            {tSteps('required')}
                        </label>
                    </div>
                    <p className="text-sm text-content-muted">{tSteps('requiredHint')}</p>
                    {required && data && steps.length === 0 && (
                        <p role="note" className="text-sm text-content-warning">
                            {tSteps('requiredWithoutSteps')}
                        </p>
                    )}
                </div>
            }
            table={{
                data: steps,
                columns,
                loading: isLoading,
                error: error ? t('common.loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                emptyState: tSteps('empty'),
                resourceName: (plural: boolean) => (plural ? tSteps('resourcePlural') : tSteps('resource')),
                'data-testid': 'settings-type-review-steps-table',
            }}
        >
            {editing && (
                <StepEditorDialog projectId={null} initial={editing.mode === 'edit' ? defaultDraftOf(editing.step) : null} onClose={() => setEditing(null)} onSave={saveStep} />
            )}
        </EntityListPage>
    );
}
