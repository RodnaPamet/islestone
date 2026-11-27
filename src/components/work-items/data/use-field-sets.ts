'use client';

/**
 * Field sets in the views (sub-phase 2.4b-b): the rules come from the server
 * (the view configuration carries every type's built-in rules; a project's
 * custom-field rules are `GET /projects/:id/type-fields`) and are evaluated
 * with `src/lib/work-items/field-sets.ts`, the functions the usecases use.
 * A component asks these hooks, never restates a rule.
 *
 * Written fresh for Islestone.
 */
import { useCallback, useMemo } from 'react';

import { apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { resolveFieldSet, type FieldRequirementValue, type FieldSetEntry, type ResolvedFieldSet } from '@/lib/work-items/field-sets';

import { useWorkConfig } from './use-work-config';

/**
 * A project's custom-field rules for every type, and the write that sets one
 * (`PUT /projects/:id/type-fields`, `projects.edit`), followed by a fresh read.
 */
export function useProjectFieldSet(projectId: string | undefined) {
    const { data, mutate } = useTenantSWR<FieldSetEntry[]>(projectId ? `/projects/${projectId}/type-fields` : null);
    const apiUrl = useTenantApiUrl();
    const setRule = useCallback(
        async (typeId: string, customFieldId: string, requirement: FieldRequirementValue) => {
            if (!projectId) return;
            await apiSend('PUT', apiUrl(`/projects/${projectId}/type-fields`), { typeId, customFieldId, requirement });
            await mutate();
        },
        [apiUrl, mutate, projectId],
    );
    return { rules: data ?? [], setRule };
}

/**
 * The field set of `typeId` in `projectId`: the configuration's built-in
 * rules and the project's custom-field rules for its live fields.
 */
export function useFieldSet(typeId: string | undefined, projectId: string | undefined, liveCustomFieldIds: readonly string[]): ResolvedFieldSet {
    const config = useWorkConfig();
    const { rules } = useProjectFieldSet(projectId);
    const key = liveCustomFieldIds.join(',');
    // The project's team's estimate unit (3.4a): a team that does not estimate hides the estimate.
    const estimateUnit = config.estimateUnitOfProject(projectId);
    return useMemo(
        () =>
            resolveFieldSet([...config.fieldSetEntries, ...rules], typeId ?? '', {
                projectId: projectId ?? null,
                liveCustomFieldIds: key ? key.split(',') : [],
                ...(estimateUnit !== undefined ? { estimateUnit } : {}),
            }),
        [config.fieldSetEntries, rules, typeId, projectId, key, estimateUnit],
    );
}
