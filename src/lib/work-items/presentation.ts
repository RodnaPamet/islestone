/**
 * How the work-item views show a state's category and an item's priority:
 * the badge variant and the catalogue key of each label. A `Record` over the
 * enum, so `tsc` fails when a category or a priority is added without a
 * presentation (this replaces inflect-compliance's `task-status-vocabulary`
 * guard). Client-safe: no server imports.
 *
 * Written fresh for Islestone (sub-phase 2.3), after inflect-compliance's
 * `src/lib/task-status-badge.ts` (the category-to-variant table) at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import type { WorkflowStateCategory, WorkItemPriority } from '@prisma/client';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export const STATE_CATEGORY_BADGE: Record<WorkflowStateCategory, { variant: BadgeVariant; labelKey: string }> = {
    BACKLOG: { variant: 'neutral', labelKey: 'category.BACKLOG' },
    UNSTARTED: { variant: 'neutral', labelKey: 'category.UNSTARTED' },
    STARTED: { variant: 'info', labelKey: 'category.STARTED' },
    DONE: { variant: 'success', labelKey: 'category.DONE' },
    CANCELLED: { variant: 'warning', labelKey: 'category.CANCELLED' },
};

export const PRIORITY_ORDER: readonly WorkItemPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];

export const PRIORITY_BADGE: Record<WorkItemPriority, { variant: BadgeVariant; labelKey: string }> = {
    URGENT: { variant: 'error', labelKey: 'priority.URGENT' },
    HIGH: { variant: 'warning', labelKey: 'priority.HIGH' },
    MEDIUM: { variant: 'info', labelKey: 'priority.MEDIUM' },
    LOW: { variant: 'neutral', labelKey: 'priority.LOW' },
    NONE: { variant: 'neutral', labelKey: 'priority.NONE' },
};

/** Closed categories end an item's life cycle (ADR 0002 §3). */
export function isClosed(category: WorkflowStateCategory): boolean {
    return category === 'DONE' || category === 'CANCELLED';
}

/** Today as `YYYY-MM-DD` in the viewer's zone; call it in an effect, never in render. */
export function localToday(now: Date = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** A date-only due date is overdue when it is before today and the item is open. */
export function isOverdue(dueDate: string | null, category: WorkflowStateCategory, today: string | null): boolean {
    return !!dueDate && !!today && !isClosed(category) && dueDate < today;
}
