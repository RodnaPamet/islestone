'use client';

/**
 * A project's due date on its page's header (roadmap 3.1a; owner decision
 * 188; ADR 0002 §16): "Due 2027-03-14", and for a viewer who may change the
 * project (`mayEditProject`, asked on the server) "Change due date", a small
 * form over the project route (`PATCH /projects/:id { dueDate }`). A
 * deadline for the schedule and nothing else: changing it moves no date.
 *
 * Written fresh for Islestone.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { refusalText, useSettingsApi } from '@/components/settings/settings-data';
import { SettingsFormModal } from '@/components/settings/SettingsFormModal';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';

export function ProjectDueDate({ projectId, projectName, dueDate, canEdit }: { projectId: string; projectName: string; dueDate: string | null; canEdit: boolean }) {
    const tDue = useTranslations('workItems.projects.dueDate');
    const toast = useToast();
    const router = useRouter();
    const { send } = useSettingsApi();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState<string | null>(dueDate);
    const [shown, setShown] = useState<string | null>(dueDate);

    const submit = async (): Promise<string | null> => {
        try {
            await send('PATCH', `/projects/${encodeURIComponent(projectId)}`, { dueDate: value });
            setShown(value);
            toast.success(tDue('saved'));
            router.refresh();
            return null;
        } catch (err) {
            return refusalText(err, tDue('failed'));
        }
    };

    return (
        <span className="inline-flex items-center gap-tight text-sm" data-testid="project-due-date">
            <span className={shown ? 'tabular-nums' : 'text-content-muted'}>{shown ? tDue('label', { date: shown }) : tDue('none')}</span>
            {canEdit && (
                <Button
                    id="project-due-date-change"
                    variant="ghost"
                    size="sm"
                    text={tDue('change')}
                    onClick={() => {
                        setValue(shown);
                        setOpen(true);
                    }}
                />
            )}
            <SettingsFormModal open={open} onOpenChange={setOpen} title={tDue('title', { name: projectName })} submitLabel={tDue('save')} onSubmit={submit}>
                <FormField label={tDue('field')} description={tDue('hint')}>
                    <DatePicker id="project-due-date-input" value={parseYMD(value)} onChange={(d) => setValue(toYMD(d))} clearable />
                </FormField>
            </SettingsFormModal>
        </span>
    );
}
