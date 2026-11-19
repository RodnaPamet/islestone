'use client';

import { Button } from '@inflect/ui/components/ui/button';
import { Card } from '@inflect/ui/components/ui/card';
import { EmptyState } from '@inflect/ui/components/ui/empty-state';
import { SkeletonCard } from '@inflect/ui/components/ui/skeleton';
import { Tooltip } from '@inflect/ui/components/ui/tooltip';
import { Heading } from '@inflect/ui/components/ui/typography';
import { useState } from 'react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { FormField } from '@/components/ui/form-field';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { StatusBadge } from '@/components/ui/status-badge';
import { Switch } from '@/components/ui/switch';
import { createColumns, DataTable } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup } from '@/components/ui/toggle-group';

type Theme = 'light' | 'dark';

interface SampleRow {
    id: string;
    title: string;
    status: 'success' | 'warning' | 'info';
}

const ROWS: SampleRow[] = [
    { id: 'w-1', title: 'Draft the release plan', status: 'info' },
    { id: 'w-2', title: 'Review the onboarding flow', status: 'warning' },
    { id: 'w-3', title: 'Ship the gallery', status: 'success' },
];

const STATUS_LABEL: Record<SampleRow['status'], string> = { success: 'Done', warning: 'At risk', info: 'In progress' };

const COLUMNS = createColumns<SampleRow>([
    { id: 'title', header: 'Title', accessorFn: (r) => r.title },
    {
        id: 'status',
        header: 'Status',
        accessorFn: (r) => r.status,
        cell: ({ row }) => <StatusBadge variant={row.original.status}>{STATUS_LABEL[row.original.status]}</StatusBadge>,
    },
]);

const OWNERS: ComboboxOption[] = [
    { value: 'ada', label: 'Ada' },
    { value: 'grace', label: 'Grace' },
    { value: 'linus', label: 'Linus' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-default">
            <Heading level={3}>{title}</Heading>
            <div className="flex flex-wrap items-start gap-compact">{children}</div>
        </section>
    );
}

/** One full set of primitives, painted in the theme its wrapper pins. */
function Panel({ theme }: { theme: Theme }) {
    const [view, setView] = useState('list');
    const [owner, setOwner] = useState<ComboboxOption | null>(null);
    const [due, setDue] = useState<Date | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const id = (name: string) => `${theme}-${name}`;

    return (
        <div
            data-theme={theme}
            aria-labelledby={id('heading')}
            role="region"
            className="space-y-section rounded-lg border border-border-subtle bg-bg-page p-section text-content-default"
        >
            <Heading level={2} id={id('heading')}>
                {theme === 'light' ? 'Light theme' : 'Dark theme'}
            </Heading>

            <Breadcrumbs items={[{ label: 'Workspace', href: '/gallery' }, { label: 'Gallery' }]} />

            <Section title="Buttons">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Delete item</Button>
                <Button variant="secondary" loading>
                    Saving
                </Button>
                <Tooltip content="Explains the control">
                    <Button variant="secondary">With tooltip</Button>
                </Tooltip>
            </Section>

            <Section title="Status">
                <StatusBadge variant="neutral">Neutral</StatusBadge>
                <StatusBadge variant="info">Info</StatusBadge>
                <StatusBadge variant="success">Success</StatusBadge>
                <StatusBadge variant="warning">Warning</StatusBadge>
                <StatusBadge variant="error">Error</StatusBadge>
            </Section>

            <InlineNotice variant="info" title="Inline notice">
                Notices sit inside a page, next to what they describe.
            </InlineNotice>

            <Section title="Form controls">
                <div className="grid w-full gap-default sm:grid-cols-2">
                    <FormField label="Title" description="A short name for the item.">
                        <Input placeholder="Untitled" />
                    </FormField>
                    <FormField label="Estimate" error="Enter a number of days.">
                        <Input placeholder="3" />
                    </FormField>
                    <FormField label="Notes">
                        <Textarea placeholder="Anything the assignee should know" />
                    </FormField>
                    <div className="space-y-default">
                        <label className="flex items-center gap-tight text-sm">
                            <Checkbox defaultChecked /> Notify the assignee
                        </label>
                        <label className="flex items-center gap-tight text-sm">
                            <Switch defaultChecked /> Visible to guests
                        </label>
                        <RadioGroup defaultValue="normal" aria-label="Priority" className="flex gap-default">
                            {['low', 'normal', 'high'].map((p) => (
                                <label key={p} className="flex items-center gap-tight text-sm capitalize">
                                    <RadioGroupItem value={p} /> {p}
                                </label>
                            ))}
                        </RadioGroup>
                    </div>
                </div>
            </Section>

            <Section title="Pickers">
                <Combobox
                    options={OWNERS}
                    selected={owner}
                    setSelected={setOwner}
                    placeholder="Choose an owner"
                    searchPlaceholder="Search people…"
                />
                <DatePicker value={due} onChange={setDue} placeholder="Due date" />
                <ToggleGroup
                    ariaLabel="View"
                    options={[
                        { value: 'list', label: 'List' },
                        { value: 'board', label: 'Board' },
                        { value: 'timeline', label: 'Timeline' },
                    ]}
                    selected={view}
                    selectAction={setView}
                />
            </Section>

            <Section title="Overlays">
                <Button variant="secondary" onClick={() => setModalOpen(true)}>
                    Open modal
                </Button>
                <Modal showModal={modalOpen} setShowModal={setModalOpen} title="A modal" description="Quick create and confirm flows.">
                    <Modal.Body>
                        <p className="text-sm">Modal content.</p>
                    </Modal.Body>
                </Modal>
            </Section>

            <Section title="Card, table and states">
                <Card className="w-full">
                    <DataTable<SampleRow> data={ROWS} columns={COLUMNS} getRowId={(r) => r.id} data-testid={id('table')} />
                </Card>
                <Card className="w-full sm:w-72">
                    <EmptyState title="No items yet" description="Items you create appear here." />
                </Card>
                <div className="w-full sm:w-72">
                    <SkeletonCard />
                </div>
            </Section>

            <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="about">
                    <AccordionTrigger>About this gallery</AccordionTrigger>
                    <AccordionContent>
                        Every primitive here is the shared UI copied from inflect-compliance, painted by Islestone&apos;s tokens.
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    );
}

export function Gallery() {
    return (
        <div className="grid gap-section xl:grid-cols-2">
            <Panel theme="light" />
            <Panel theme="dark" />
        </div>
    );
}
