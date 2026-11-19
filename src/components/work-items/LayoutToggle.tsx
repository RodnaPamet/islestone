'use client';

/**
 * List or board, remembered per view in the browser (`useLocalStorage`, keyed
 * through `uiStorageKey`) until 2.4's saved views store a layout. Written
 * fresh for Islestone (sub-phase 2.3) on the shared `ToggleGroup`; the
 * mirrored `use-view-mode.ts` is typed table/cards and is not widened.
 */
import { useTranslations } from 'next-intl';

import { ToggleGroup } from '@/components/ui/toggle-group';

export type WorkItemLayout = 'list' | 'board';

export function LayoutToggle({ value, onChange }: { value: WorkItemLayout; onChange: (layout: WorkItemLayout) => void }) {
    const t = useTranslations('workItems');
    return (
        <ToggleGroup
            ariaLabel={t('layout.label')}
            options={[
                { value: 'list', label: t('layout.list') },
                { value: 'board', label: t('layout.board') },
            ]}
            selected={value}
            selectAction={(v) => onChange(v === 'board' ? 'board' : 'list')}
        />
    );
}
