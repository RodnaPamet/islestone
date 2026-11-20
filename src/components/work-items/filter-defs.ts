/**
 * The work-item list's filter definitions (sub-phase 2.3), for the shared
 * filter system (`FilterProvider`, `FilterToolbar`).
 *
 * Copied from inflect-compliance
 * `src/app/t/[tenantSlug]/(app)/tasks/filter-defs.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e and edited per the 2.3 map: the
 * factory shape (`workItemFilterDefsInput` → `createFilterDefs`), the `due`
 * def and its labels and the key export (`WORK_ITEM_FILTER_KEYS`, renamed
 * from `TASK_FILTER_KEYS`) kept; the status, type, severity, source,
 * reviewer and control defs cut; state, category, type, priority, label and
 * project added. EVERY option comes from the server page's configuration or
 * the member roster, never from the loaded rows: with cursor pages the
 * loaded rows are a subset, and an option list built from them would shrink
 * as pages load (the map's risk 5).
 */
import { CalendarDays, CircleDotted, Cube, Flag, Folder, BulletList, Tag, UserCheck } from '@inflect/ui/components/ui/icons/nucleo';
import { createFilterDefs, type FilterDefInput } from '@/components/ui/filter';
import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';
import { PRIORITY_ORDER } from '@/lib/work-items/presentation';
import { NO_VALUE, customFieldFilterKey } from '@/lib/work-items/custom-fields';
import type { Member } from '@/lib/work-items/types';

import type { WorkConfigIndex } from './data/use-work-config';

/** Every key the list reads from the URL (3.6's next-best-action reads `due=overdue`). */
export const WORK_ITEM_FILTER_KEYS = ['stateCategory', 'stateId', 'priority', 'typeId', 'labelId', 'assigneeId', 'projectId', 'cycleId', 'due'] as const;
export type WorkItemFilterKey = (typeof WORK_ITEM_FILTER_KEYS)[number];

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface FilterScope {
    /** The view's own project, when it shows one (no project facet then). */
    projectId?: string;
    /** The one team the view's states belong to (a project's), else none. */
    teamId?: string;
    /** The view fixes the assignee (My Work): no assignee facet. */
    fixedAssignee?: boolean;
    /** The view is one cycle's (2.5a): no cycle facet. */
    fixedCycle?: boolean;
}

export function assigneeOptionsFromMembers(members: readonly Member[], t: Translate) {
    return [
        { value: 'none', label: t('filters.unassigned') },
        ...members.map((m) => ({ value: m.id, label: m.name?.trim() || m.email })),
    ];
}

export function workItemFilterDefsInput(config: WorkConfigIndex, members: readonly Member[], scope: FilterScope, t: Translate): Record<string, FilterDefInput> {
    const defs: Record<string, FilterDefInput> = {
        stateCategory: {
            label: t('filters.category'),
            icon: CircleDotted,
            multiple: true,
            options: WORKFLOW_STATE_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) })),
        },
    };
    if (scope.teamId) {
        defs.stateId = {
            label: t('filters.state'),
            icon: CircleDotted,
            multiple: true,
            options: config.statesOfTeam(scope.teamId).map((s) => ({ value: s.id, label: s.name })),
        };
    }
    defs.priority = {
        label: t('filters.priority'),
        icon: Flag,
        multiple: true,
        options: PRIORITY_ORDER.map((p) => ({ value: p, label: t(`priority.${p}`) })),
    };
    defs.typeId = {
        label: t('filters.type'),
        icon: Cube,
        multiple: true,
        options: config.types.map((ty) => ({ value: ty.id, label: ty.name })),
    };
    defs.labelId = {
        label: t('filters.label'),
        icon: Tag,
        multiple: true,
        options: config.labels.filter((l) => !scope.teamId || l.teamId === null || l.teamId === scope.teamId).map((l) => ({ value: l.id, label: l.name })),
    };
    if (!scope.fixedAssignee) {
        defs.assigneeId = {
            label: t('filters.assignee'),
            icon: UserCheck,
            multiple: true,
            options: assigneeOptionsFromMembers(members, t),
        };
    }
    if (!scope.projectId) {
        defs.projectId = {
            label: t('filters.project'),
            icon: Folder,
            multiple: true,
            options: config.projects.map((p) => ({ value: p.id, label: p.name })),
        };
    }
    // Sub-phase 2.5a: the current cycle, no cycle, or the scope's cycles that
    // take items (every team's on a workspace-wide page), from the config.
    if (!scope.fixedCycle && (config.cycles ?? []).length > 0) {
        const teamName = new Map(config.teams.map((x) => [x.id, x.name]));
        const cycles = (config.cycles ?? []).filter((c) => c.status !== 'completed' && (!scope.teamId || c.teamId === scope.teamId));
        defs.cycleId = {
            label: t('filters.cycle'),
            icon: CalendarDays,
            multiple: true,
            options: [
                { value: 'current', label: t('filters.currentCycle') },
                { value: 'none', label: t('filters.noCycle') },
                ...cycles.map((c) => {
                    const name = c.name?.trim() || t('cycle.numbered', { number: c.number });
                    return { value: c.id, label: scope.teamId ? name : `${name} · ${teamName.get(c.teamId) ?? ''}` };
                }),
            ],
        };
    }
    defs.due = {
        label: t('filters.due'),
        icon: CalendarDays,
        singleSelect: true,
        options: [
            { value: 'overdue', label: t('filters.overdue') },
            { value: 'next7d', label: t('filters.next7d') },
        ],
    };
    // Sub-phase 2.4: one filter per live custom field of the page's project
    // (the config carries fields only on a project's page). Keys `cf.<id>`;
    // `customFieldFilterParam` turns the values into the list query.
    for (const field of config.customFields ?? []) {
        if (field.archived) continue;
        const key = customFieldFilterKey(field.id);
        const noValue = { value: NO_VALUE, label: t('customFields.noValue') };
        if (field.type === 'SELECT' || field.type === 'MULTI_SELECT') {
            defs[key] = { label: field.name, icon: BulletList, multiple: true, options: [...field.options.map((o) => ({ value: o.id, label: o.name })), noValue] };
        } else if (field.type === 'PERSON') {
            defs[key] = { label: field.name, icon: UserCheck, multiple: true, options: [...members.map((m) => ({ value: m.id, label: m.name?.trim() || m.email })), noValue] };
        } else if (field.type === 'CHECKBOX') {
            defs[key] = {
                label: field.name,
                icon: BulletList,
                singleSelect: true,
                options: [
                    { value: 'checked', label: t('customFields.checked') },
                    { value: 'unchecked', label: t('customFields.unchecked') },
                ],
            };
        } else {
            defs[key] = {
                label: field.name,
                icon: BulletList,
                singleSelect: true,
                options: [
                    { value: 'set', label: t('customFields.hasValue') },
                    { value: 'empty', label: t('customFields.noValue') },
                ],
            };
        }
    }
    return defs;
}

export function buildWorkItemFilterDefs(config: WorkConfigIndex, members: readonly Member[], scope: FilterScope, t: Translate) {
    return createFilterDefs(workItemFilterDefsInput(config, members, scope, t));
}
