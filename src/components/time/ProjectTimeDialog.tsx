'use client';

/**
 * A project's time settings (sub-phase 3.4d; owner decisions 271 to 273):
 * whether its new time entries are billable by default, and its billable
 * rates and their history. Opened from Settings → Projects and the project
 * page, only for a rates holder (`time.rates`, asked on the server by the
 * page that offers it).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Modal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/switch';

import { RateHistory } from './RateHistory';
import { useBillableRates, useTimeTotalsActions } from './data/use-time-totals';

export function ProjectTimeDialog({
    project,
    open,
    onOpenChange,
}: {
    project: { id: string; name: string; keyPrefix: string; version?: number; timeBillableByDefault?: boolean };
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useTranslations('time.projectTime');
    const rates = useBillableRates(open);
    const actions = useTimeTotalsActions();
    const [billable, setBillable] = useState(project.timeBillableByDefault === true);
    const [version, setVersion] = useState(project.version ?? 0);
    const [error, setError] = useState<string | null>(null);

    const toggle = async (next: boolean) => {
        setBillable(next);
        const out = await actions.setBillableDefault({ id: project.id, version }, next);
        if (out instanceof Error) {
            setBillable(!next);
            setError((out as { reason?: string }).reason ?? t('failed'));
            return;
        }
        setError(null);
        setVersion(out.version);
    };

    const title = t('title', { name: `${project.keyPrefix} ${project.name}` });
    return (
        <Modal
            showModal={open}
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(open) : v;
                if (!next) onOpenChange(false);
            }}
            title={title}
            onClose={() => onOpenChange(false)}
        >
            <Modal.Header title={title} description={t('description')} />
            <Modal.Body>
                <div className="space-y-default">
                    <div className="flex items-start justify-between gap-default">
                        <div>
                            <p className="text-sm font-medium text-content-emphasis">{t('billableByDefault')}</p>
                            <p className="text-xs text-content-muted">{t('billableByDefaultHint')}</p>
                        </div>
                        <Switch id="project-billable-default" checked={billable} onCheckedChange={(v) => void toggle(v)} aria-label={t('billableByDefault')} />
                    </div>
                    {error && (
                        <p role="alert" className="text-sm text-content-error">
                            {error}
                        </p>
                    )}
                    <p className="text-sm font-medium text-content-emphasis">{t('rates')}</p>
                    <p className="text-xs text-content-muted">{t('ratesHint')}</p>
                    {rates.data && (
                        <RateHistory
                            idPrefix={`project-${project.id}`}
                            scope={{ level: 'PROJECT', projectId: project.id }}
                            rates={rates.data.rates}
                            currency={rates.data.currency}
                            today={rates.data.today}
                            label={project.name}
                        />
                    )}
                </div>
            </Modal.Body>
        </Modal>
    );
}
