'use client';

/**
 * The project page's "Time" action (sub-phase 3.4d): opens the project's
 * billable default and rates (`ProjectTimeDialog`). Rendered by the page only
 * for a rates holder (`time.rates`, asked on the server).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';

import { ProjectTimeDialog } from './ProjectTimeDialog';
import { useProjectForTime } from './data/use-time-totals';

export function ProjectTimeButton({ projectId, projectName }: { projectId: string; projectName: string }) {
    const t = useTranslations('time.projectTime');
    const [open, setOpen] = useState(false);
    const { data } = useProjectForTime(open ? projectId : null);
    return (
        <>
            <Button id="project-time" variant="secondary" size="sm" text={t('open')} aria-label={t('openNamed', { name: projectName })} onClick={() => setOpen(true)} />
            {open && data && <ProjectTimeDialog project={data} open onOpenChange={setOpen} />}
        </>
    );
}
