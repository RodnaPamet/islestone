'use client';

/**
 * Dependencies from the timeline (roadmap 3.1c; ADR 0010 §6; owner decisions
 * 195 and 203):
 *
 *   - `AddDependencyDialog`: a link drawn between two bars asks "ISL-1 blocks
 *     ISL-2?" first; confirming calls the relation route, whose graph lock
 *     refuses a cycle (409 `RELATION_WOULD_CYCLE`), and the refusal is shown
 *     here. The link appears only after the server accepts.
 *   - `DependenciesDialog`: the keyboard way (the schedule table's
 *     "Dependencies" on a row): the row's "blocked by" and "blocks" relations
 *     on the timeline, each removable through the undo toast, and an add form
 *     that names the relation it will create before it is confirmed.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import type { TimelineEdge, TimelineResponse, TimelineRow } from '@/lib/work-items/timeline';

const label = (r: Pick<TimelineRow, 'key' | 'title'>) => `${r.key} ${r.title}`;

export function AddDependencyDialog({
    from,
    to,
    onAdd,
    onClose,
}: {
    from: TimelineRow;
    to: TimelineRow;
    /** Resolves `null` when the server accepted, else the refusal to show. */
    onAdd: (fromId: string, toId: string) => Promise<string | null>;
    onClose: () => void;
}) {
    const tAdd = useTranslations('workItems.timeline.dependency');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        const failure = await onAdd(from.id, to.id);
        setBusy(false);
        if (failure) setError(failure);
        else onClose();
    };
    return (
        <Modal
            showModal
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(true) : v;
                if (!next) onClose();
            }}
            title={tAdd('addTitle')}
            onClose={onClose}
        >
            <Modal.Header title={tAdd('addTitle')} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <p className="text-sm" data-testid="add-dependency-question">
                        {tAdd('question', { from: from.key, to: to.key })}
                    </p>
                    <p className="mt-tight text-xs text-content-muted">{tAdd('explain', { from: label(from), to: label(to) })}</p>
                    {error && (
                        <p role="alert" className="mt-default text-sm text-content-error">
                            {error}
                        </p>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tAdd('cancel')} onClick={onClose} />
                        <Button id="add-dependency-confirm" type="submit" variant="primary" text={tAdd('confirm')} disabled={busy} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}

type Direction = 'blockedBy' | 'blocks';

export function DependenciesDialog({
    data,
    row,
    linkable,
    onAdd,
    onRemove,
    onClose,
}: {
    data: TimelineResponse;
    row: TimelineRow;
    /** The items a dependency may join (`editableRows().dependencies`). */
    linkable: ReadonlySet<string>;
    onAdd: (fromId: string, toId: string) => Promise<string | null>;
    onRemove: (edge: TimelineEdge, label: string) => void;
    onClose: () => void;
}) {
    const tDeps = useTranslations('workItems.timeline.dependency');
    const rows = useMemo(() => new Map(data.rows.map((r) => [r.id, r])), [data.rows]);
    const blockedBy = data.edges.filter((e) => e.toId === row.id && rows.has(e.fromId));
    const blocks = data.edges.filter((e) => e.fromId === row.id && rows.has(e.toId));
    const [direction, setDirection] = useState<Direction>('blockedBy');
    const [otherId, setOtherId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const linked = new Set([...blockedBy.map((e) => e.fromId), ...blocks.map((e) => e.toId)]);
    const otherOptions: ComboboxOption[] = data.rows
        .filter((r) => r.id !== row.id && linkable.has(r.id) && !linked.has(r.id))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((r) => ({ value: r.id, label: label(r) }));
    const directionOptions: ComboboxOption[] = (['blockedBy', 'blocks'] as const).map((d) => ({ value: d, label: tDeps(`direction.${d}`, { key: row.key }) }));
    const other = otherId ? rows.get(otherId) : undefined;
    const pair = other ? (direction === 'blockedBy' ? { from: other, to: row } : { from: row, to: other }) : null;

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!pair) return;
        setBusy(true);
        const failure = await onAdd(pair.from.id, pair.to.id);
        setBusy(false);
        setError(failure);
        if (!failure) setOtherId(null);
    };
    const edgeLabel = (e: TimelineEdge) => tDeps('question', { from: rows.get(e.fromId)!.key, to: rows.get(e.toId)!.key }).replace(/\?$/, '');
    const list = (heading: string, id: string, edges: TimelineEdge[], otherOf: (e: TimelineEdge) => TimelineRow) => (
        <section aria-labelledby={id} className="space-y-tight">
            <h3 id={id} className="text-sm font-semibold text-content-emphasis">
                {heading}
            </h3>
            {edges.length === 0 ? (
                <p className="text-sm text-content-muted">{tDeps('none')}</p>
            ) : (
                <ul className="space-y-tight text-sm">
                    {edges.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-default">
                            <span>
                                <span className="font-mono text-xs">{otherOf(e).key}</span> {otherOf(e).title}
                            </span>
                            <Button type="button" variant="secondary" size="sm" text={tDeps('remove')} aria-label={tDeps('removeLabel', { relation: edgeLabel(e) })} onClick={() => onRemove(e, edgeLabel(e))} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );

    return (
        <Modal
            showModal
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(true) : v;
                if (!next) onClose();
            }}
            title={tDeps('manageTitle', { key: row.key })}
            onClose={onClose}
        >
            <Modal.Header title={tDeps('manageTitle', { key: row.key })} description={row.title} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-section" data-testid="dependencies-dialog">
                        {list(tDeps('blockedByHeading'), 'dependencies-blocked-by', blockedBy, (e) => rows.get(e.fromId)!)}
                        {list(tDeps('blocksHeading'), 'dependencies-blocks', blocks, (e) => rows.get(e.toId)!)}
                        <section aria-labelledby="dependencies-add" className="space-y-default">
                            <h3 id="dependencies-add" className="text-sm font-semibold text-content-emphasis">
                                {tDeps('addHeading')}
                            </h3>
                            <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                                <FormField label={tDeps('directionLabel')}>
                                    <Combobox
                                        id="dependencies-direction"
                                        selected={directionOptions.find((o) => o.value === direction) ?? null}
                                        setSelected={(o) => o && setDirection(o.value as Direction)}
                                        options={directionOptions}
                                        caret
                                        hideSearch
                                        buttonProps={{ 'aria-label': tDeps('directionLabel') }}
                                    />
                                </FormField>
                                <FormField label={tDeps('otherLabel')}>
                                    <Combobox
                                        id="dependencies-other"
                                        selected={otherOptions.find((o) => o.value === otherId) ?? null}
                                        setSelected={(o) => setOtherId(o ? o.value : null)}
                                        options={otherOptions}
                                        caret
                                        placeholder={tDeps('otherPlaceholder')}
                                        buttonProps={{ 'aria-label': tDeps('otherLabel') }}
                                    />
                                </FormField>
                            </div>
                            {pair && (
                                <p className="text-sm" data-testid="dependencies-question">
                                    {tDeps('question', { from: pair.from.key, to: pair.to.key })}
                                </p>
                            )}
                            {error && (
                                <p role="alert" className="text-sm text-content-error">
                                    {error}
                                </p>
                            )}
                        </section>
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tDeps('close')} onClick={onClose} />
                        <Button id="dependencies-add-confirm" type="submit" variant="primary" text={tDeps('confirm')} disabled={!pair || busy} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}
