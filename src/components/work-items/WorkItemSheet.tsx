'use client';

/**
 * The detail as a sheet: the list's row click and the board's card open it
 * beside the view, so the person keeps their place. It renders the same
 * `WorkItemDetail` the full page renders (`variant="sheet"`), over the same
 * SWR keys. Written fresh for Islestone (sub-phase 2.3), in place of
 * inflect-compliance's `AsidePanel` quick view (the map's choice: the
 * `Sheet` primitive is what `AsidePanel` falls back to, and it is already
 * Islestone's).
 */
import { useTranslations } from 'next-intl';

import { Sheet } from '@/components/ui/sheet';

import { WorkItemDetail } from './WorkItemDetail';

export function WorkItemSheet({
    workItemId,
    onClose,
    onOpenItem,
}: {
    workItemId: string | null;
    onClose: () => void;
    onOpenItem: (row: { id: string; key: string }) => void;
}) {
    const t = useTranslations('workItems');
    return (
        <Sheet
            open={workItemId !== null}
            onOpenChange={(open: boolean) => {
                if (!open) onClose();
            }}
            title={t('detail.sheetTitle')}
            size="lg"
        >
            <Sheet.Header title={t('detail.sheetTitle')} />
            <Sheet.Body>
                {workItemId && <WorkItemDetail key={workItemId} workItemId={workItemId} variant="sheet" onOpenItem={onOpenItem} onDeleted={onClose} />}
            </Sheet.Body>
        </Sheet>
    );
}
