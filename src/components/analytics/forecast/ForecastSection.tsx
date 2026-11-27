'use client';

/**
 * The Forecast section of a scope's page and the list's Forecast action
 * (sub-phase 3.6c; owner decision 324): a milestone's, a project's, a
 * cycle's, a goal's and an initiative's page show the forecast of their open
 * items, with "Details" opening the sheet; the Work items page's and a
 * project page's toolbar open the sheet for the current filters ("any
 * scope"). The page offers either only to a caller it asked
 * `mayViewAnalytics` on the server; the components never ask a role or a
 * key. The person's choices (history, share, basis) live in the section, so
 * the summary and the sheet show one forecast.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import type { WorkItemListFilters } from '@/components/work-items/data/list-filters';

import type { ForecastChoices } from '../data/use-forecast';
import { ForecastPanel } from './ForecastPanel';

function ForecastSheet({ open, onClose, filters, choices, onChoices }: { open: boolean; onClose: () => void; filters: WorkItemListFilters; choices: ForecastChoices; onChoices: (c: ForecastChoices) => void }) {
    const tSheet = useTranslations('forecast');
    return (
        <Sheet
            open={open}
            onOpenChange={(next: boolean) => {
                if (!next) onClose();
            }}
            title={tSheet('title')}
            size="lg"
        >
            <Sheet.Header title={tSheet('title')} />
            <Sheet.Body>
                <div data-testid="forecast-sheet">{open && <ForecastPanel filters={filters} choices={choices} onChoices={onChoices} detailed />}</div>
            </Sheet.Body>
        </Sheet>
    );
}

/**
 * A scope page's Forecast section: the summary, and "Details" for the sheet.
 * `compact` keeps it to one line (the dates or the refusal), for a page whose
 * board or timeline needs the height.
 */
export function ForecastSection({ filters, compact = false }: { filters: WorkItemListFilters; compact?: boolean }) {
    const tSection = useTranslations('forecast');
    const [choices, setChoices] = useState<ForecastChoices>({});
    const [open, setOpen] = useState(false);
    return (
        <section
            aria-labelledby="forecast-section-title"
            className={compact ? 'flex flex-wrap items-center gap-default rounded-lg border border-border-default px-4 py-2' : 'space-y-tight rounded-lg border border-border-default p-4'}
            data-testid="forecast-section"
        >
            <div className={compact ? 'contents' : 'flex flex-wrap items-center justify-between gap-tight'}>
                <h2 id="forecast-section-title" className="text-sm font-semibold text-content-emphasis">
                    {tSection('title')}
                </h2>
                {!compact && <Button variant="ghost" size="sm" text={tSection('details')} onClick={() => setOpen(true)} />}
            </div>
            <ForecastPanel filters={filters} choices={choices} onChoices={setChoices} compact={compact} />
            {compact && <Button variant="ghost" size="sm" text={tSection('details')} onClick={() => setOpen(true)} />}
            <ForecastSheet open={open} onClose={() => setOpen(false)} filters={filters} choices={choices} onChoices={setChoices} />
        </section>
    );
}

/** The list's Forecast action: the sheet for the current filters. */
export function ForecastAction({ filters }: { filters: WorkItemListFilters }) {
    const tAction = useTranslations('forecast');
    const [choices, setChoices] = useState<ForecastChoices>({});
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button id="forecast-btn" variant="secondary" text={tAction('open')} onClick={() => setOpen(true)} />
            <ForecastSheet open={open} onClose={() => setOpen(false)} filters={filters} choices={choices} onChoices={setChoices} />
        </>
    );
}
