'use client';

/**
 * A milestone's form (sub-phase 2.5b): create one, or rename it and change or
 * clear its due date. Posts through `useMilestoneWrites`; the server's
 * refusal (a name taken in the project) is shown in the dialog. Opened only
 * where the server offered `manageMilestones`.
 *
 * Written fresh for Islestone; built on the Settings form modal so every
 * small form reads alike.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SettingsFormModal } from '@/components/settings/SettingsFormModal';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import type { MilestoneData } from '@/lib/work-items/types';

import { milestoneRefusal, useMilestoneWrites } from './use-milestones';

export function MilestoneDialog({
    open,
    onOpenChange,
    projectId,
    milestone,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    milestone?: Pick<MilestoneData, 'id' | 'name' | 'dueDate'>;
}) {
    const tForm = useTranslations('milestones');
    const toast = useToast();
    const writes = useMilestoneWrites(projectId);
    const [name, setName] = useState('');
    const [dueDate, setDueDate] = useState<string | null>(null);

    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setName(milestone?.name ?? '');
            setDueDate(milestone?.dueDate ?? null);
        }
    }

    const submit = async (): Promise<string | null> => {
        if (!name.trim()) return tForm('form.nameRequired');
        try {
            if (milestone) {
                await writes.update(milestone.id, { name: name.trim(), dueDate });
                toast.success(tForm('form.saved'));
            } else {
                await writes.create({ name: name.trim(), dueDate });
                toast.success(tForm('form.created'));
            }
            return null;
        } catch (err) {
            return milestoneRefusal(err, tForm('failed'));
        }
    };

    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={milestone ? tForm('form.editTitle') : tForm('form.createTitle')}
            submitLabel={milestone ? tForm('form.save') : tForm('form.create')}
            onSubmit={submit}
        >
            <FormField label={tForm('form.name')} required>
                <Input id="milestone-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </FormField>
            <FormField label={tForm('form.dueDate')} description={tForm('form.dueDateHint')}>
                <DatePicker id="milestone-due-input" value={parseYMD(dueDate)} onChange={(d) => setDueDate(toYMD(d))} clearable />
            </FormField>
        </SettingsFormModal>
    );
}
