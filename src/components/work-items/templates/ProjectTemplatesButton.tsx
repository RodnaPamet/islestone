'use client';

/**
 * The project page's "Templates" button (sub-phase 2.5c), opening the
 * item-templates manager. Rendered only where the server offered
 * `manageItemTemplates`.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';

import { ItemTemplatesManager } from './ItemTemplatesManager';

export function ProjectTemplatesButton({ projectId, teamId, projectName }: { projectId: string; teamId: string; projectName: string }) {
    const tButton = useTranslations('workItems.templates');
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button id="item-templates-btn" variant="secondary" text={tButton('open')} onClick={() => setOpen(true)} />
            <ItemTemplatesManager open={open} onOpenChange={setOpen} projectId={projectId} teamId={teamId} projectName={projectName} />
        </>
    );
}
