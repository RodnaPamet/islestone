'use client';

/**
 * Pick another work item by key or title: a typeahead over the list API
 * (`GET /work-items?q=…`), showing each item's key and title. Used for
 * relations. Written fresh for Islestone (sub-phase 2.3) in place of
 * inflect-compliance's compliance-entity `entity-picker.tsx`.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import type { WorkItemPage } from '@/lib/work-items/types';

import { listQueryString } from './data/list-filters';

export function WorkItemPicker({
    id,
    excludeId,
    projectId,
    value,
    onChange,
    label,
}: {
    id?: string;
    excludeId?: string;
    projectId?: string;
    value: { id: string; label: string } | null;
    onChange: (item: { id: string; label: string } | null) => void;
    label?: string;
}) {
    const t = useTranslations('workItems');
    const [search, setSearch] = useState('');
    const query = listQueryString({ q: search, projectId }, { limit: '20' });
    const { data, isLoading } = useTenantSWR<WorkItemPage>(`/work-items?${query}`);
    const options = useMemo<ComboboxOption[] | undefined>(
        () =>
            data?.items
                .filter((i) => i.id !== excludeId)
                .map((i) => ({ value: i.id, label: `${i.key} ${i.title}` })),
        [data, excludeId],
    );
    return (
        <Combobox
            id={id}
            selected={value ? { value: value.id, label: value.label } : null}
            setSelected={(o) => onChange(o ? { id: o.value, label: String(o.label) } : null)}
            options={isLoading && !data ? undefined : options}
            onSearchChange={setSearch}
            shouldFilter={false}
            placeholder={t('detail.pickWorkItem')}
            searchPlaceholder={t('detail.searchWorkItems')}
            caret
            buttonProps={label ? { 'aria-label': label } : undefined}
        />
    );
}
