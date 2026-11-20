'use client';

/**
 * Settings → a work item type's fields (sub-phase 2.4b-b; ADR 0002 §1; owner
 * decisions 108 to 112): every built-in field the field set configures, with
 * Required, Optional or Hidden (the answer: Shown or Hidden). The rules
 * belong to the type across the workspace; a project's custom fields are
 * ruled in its field manager. The server lists each field's allowed
 * requirements and its refusals are shown as it words them; the change is
 * offered only with `manageWorkConfig`, the predicate the usecase asserts.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { EntityListPage } from '@/components/layout/EntityListPage';
import { Combobox } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/hooks';
import { createColumns } from '@/components/ui/table';
import type { BuiltInField, FieldRequirementValue } from '@/lib/work-items/field-sets';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { refusalText, typeFieldsPath, useSettingsApi, useTypeFields, useWorkItemTypes } from './settings-data';

interface FieldRow {
    field: BuiltInField;
    requirement: FieldRequirementValue;
    allowed: FieldRequirementValue[];
}


export function WorkItemTypeFieldsSettings({ typeId, affordances }: { typeId: string; affordances: WorkConfigAffordances }) {
    const t = useTranslations('settings');
    const tField = useTranslations('workItems.fieldSet');
    const toast = useToast();
    const { data: types } = useWorkItemTypes();
    const { data, error, isLoading } = useTypeFields(typeId);
    const { send, revalidate } = useSettingsApi();
    const canManage = affordances.manageWorkConfig;
    const typeName = types?.find((ty) => ty.id === typeId)?.name ?? '';

    const columns = useMemo(() => {
        const label = (row: FieldRow, r: FieldRequirementValue) =>
            row.field === 'answer' ? tField(`answerRequirement.${r as 'OPTIONAL' | 'HIDDEN'}`) : tField(`requirement.${r}`);
        const change = async (row: FieldRow, requirement: FieldRequirementValue) => {
            if (requirement === row.requirement) return;
            try {
                await send('PUT', typeFieldsPath(typeId), { field: row.field, requirement });
                await revalidate(typeFieldsPath(typeId));
                toast.success(tField('saved'));
            } catch (err) {
                toast.error(refusalText(err, t('common.failed')));
            }
        };
        return createColumns<FieldRow>([
            { id: 'field', header: t('typeFields.col.field'), cell: ({ row }) => <span className="text-content-emphasis">{tField(`field.${row.original.field}`)}</span> },
            {
                id: 'requirement',
                header: t('typeFields.col.requirement'),
                cell: ({ row }) => {
                    const r = row.original;
                    if (!canManage) return label(r, r.requirement);
                    const options = r.allowed.map((a) => ({ value: a, label: label(r, a) }));
                    return (
                        <Combobox
                            id={`type-field-${r.field}`}
                            selected={options.find((o) => o.value === r.requirement) ?? null}
                            setSelected={(o) => o && void change(r, o.value as FieldRequirementValue)}
                            options={options}
                            caret
                            hideSearch
                            buttonProps={{ 'aria-label': tField('ruleFor', { field: tField(`field.${r.field}`), type: typeName }) }}
                        />
                    );
                },
            },
        ]);
    }, [t, tField, canManage, send, revalidate, toast, typeId, typeName]);

    return (
        <EntityListPage<FieldRow>
            header={{
                title: t('typeFields.title', { type: typeName }),
                description: t('typeFields.description'),
                back: { smart: true },
            }}
            table={{
                data: data?.fields ?? [],
                columns,
                loading: isLoading,
                error: error ? t('common.loadFailed') : undefined,
                getRowId: (r) => r.field,
                selectionEnabled: false,
                emptyState: t('typeFields.empty'),
                resourceName: (plural: boolean) => (plural ? t('typeFields.resourcePlural') : t('typeFields.resource')),
                'data-testid': 'settings-type-fields-table',
            }}
        />
    );
}
