'use client';

/**
 * The work-item views' badges: a state (its name, toned by its category) and
 * a priority. Written fresh for Islestone (sub-phase 2.3).
 */
import { useTranslations } from 'next-intl';

import { StatusBadge } from '@/components/ui/status-badge';
import { PRIORITY_BADGE, STATE_CATEGORY_BADGE } from '@/lib/work-items/presentation';
import type { WorkflowStateCategory, WorkItemPriority } from '@/lib/work-items/types';

export function StateBadge({ name, category }: { name: string | null | undefined; category: WorkflowStateCategory }) {
    const tState = useTranslations('workItems');
    const badge = STATE_CATEGORY_BADGE[category];
    return (
        <StatusBadge variant={badge.variant} icon={null} size="sm">
            {name ?? tState(badge.labelKey)}
        </StatusBadge>
    );
}

export function PriorityBadge({ priority }: { priority: WorkItemPriority }) {
    const tPriority = useTranslations('workItems');
    if (priority === 'NONE') return null;
    const badge = PRIORITY_BADGE[priority];
    return (
        <StatusBadge variant={badge.variant} icon={null} size="sm" tone="subtle">
            {tPriority(badge.labelKey)}
        </StatusBadge>
    );
}
