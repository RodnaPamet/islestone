'use client';

/**
 * The work-item views' badges: a state (its name, toned by its category), a
 * priority, and (2.8b) where the item's review stands. Written fresh for
 * Islestone (sub-phase 2.3).
 */
import { useTranslations } from 'next-intl';

import { StatusBadge } from '@/components/ui/status-badge';
import { PRIORITY_BADGE, STATE_CATEGORY_BADGE } from '@/lib/work-items/presentation';
import type { ReviewSummary, WorkflowStateCategory, WorkItemPriority } from '@/lib/work-items/types';

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

const REVIEW_VARIANT = { planned: 'neutral', open: 'info', signedOff: 'success', returned: 'warning', withdrawn: 'neutral' } as const;

/** Where an item's review stands, in words (2.8b): the list's review column and the card's mark. */
export function reviewSummaryText(review: ReviewSummary, t: (key: string, values?: Record<string, string | number>) => string): string {
    if (review.state !== 'open') return t(`review.summary.${review.state}`);
    if (!review.step) return t('review.summary.openNoStep');
    const open = t('review.summary.open', { step: review.step.name, count: review.step.pendingCount });
    return review.step.dueOn ? `${open} · ${t('review.summary.dueOn', { date: review.step.dueOn })}` : open;
}

/**
 * The review mark (2.8b, decision 148's words): "Signed off", "Returned", the
 * open step and how many reviewers it still waits on. Nothing when the item
 * has no review. `compact` is the board card's: the state's word only.
 */
export function ReviewBadge({ review, compact = false }: { review: ReviewSummary | null | undefined; compact?: boolean }) {
    const tReviewBadge = useTranslations('workItems');
    if (!review) return null;
    const text = compact && review.state === 'open' ? tReviewBadge('review.summary.openShort') : reviewSummaryText(review, tReviewBadge);
    return (
        <StatusBadge variant={REVIEW_VARIANT[review.state]} icon={null} size="sm" tone="subtle">
            {compact ? tReviewBadge('review.summary.cardMark', { state: text }) : text}
        </StatusBadge>
    );
}
