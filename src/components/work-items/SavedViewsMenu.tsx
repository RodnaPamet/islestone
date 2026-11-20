'use client';

/**
 * The views menu on the Work items page and a project's page (sub-phase
 * 2.4): pick a saved view to apply it (filters, search, sort, layout,
 * swimlanes, visible columns), save the current state as a new view
 * (personal, or shared when the viewer may share), update or rename the
 * applied view, and delete it with the undo toast. What it offers comes from
 * the server (`savedViewAffordances`) and each view's own `mine`; the server
 * decides again on every write.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import type { SavedViewAffordances, SavedViewData } from '@/lib/work-items/types';

import { useSavedViews, type SavedViewInput } from './data/use-saved-views';

export interface SavedViewsMenuProps {
    /** The page's scope: a project, or `null` for the workspace's Work items page. */
    projectId: string | null;
    affordances: SavedViewAffordances;
    /** The current state, as a view would store it. */
    snapshot: () => Pick<SavedViewInput, 'layout' | 'config'>;
    onApply: (view: SavedViewData) => void;
    activeViewId: string | null;
    onActiveChange: (id: string | null) => void;
}

type Dialog = { mode: 'create' } | { mode: 'rename'; view: SavedViewData } | null;

export function SavedViewsMenu({ projectId, affordances, snapshot, onApply, activeViewId, onActiveChange }: SavedViewsMenuProps) {
    const tViews = useTranslations('views');
    const saved = useSavedViews(projectId);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [name, setName] = useState('');
    const [shared, setShared] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const active = saved.views.find((v) => v.id === activeViewId) ?? null;
    const canSave = affordances.savePersonal || affordances.saveShared;
    const canChange = !!active && active.mine && (active.visibility === 'PERSONAL' || affordances.saveShared);
    const canDelete = !!active && (canChange || (active.visibility === 'SHARED' && affordances.moderate));

    const options: ComboboxOption[] = saved.views.map((v) => ({
        value: v.id,
        label: v.visibility === 'SHARED' ? tViews('sharedName', { name: v.name }) : v.name,
    }));

    const close = () => {
        setDialog(null);
        setError(null);
    };

    const submit = async () => {
        const value = name.trim();
        if (!value) {
            setError(tViews('nameRequired'));
            return;
        }
        if (dialog?.mode === 'rename') {
            const ok = await saved.update(dialog.view.id, { name: value, visibility: shared ? 'SHARED' : 'PERSONAL' });
            if (ok) close();
            return;
        }
        const created = await saved.create({ name: value, visibility: shared && affordances.saveShared ? 'SHARED' : 'PERSONAL', ...snapshot() });
        if (created) {
            onActiveChange(created.id);
            close();
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-tight">
            <Combobox
                id="saved-views-menu"
                selected={options.find((o) => o.value === activeViewId) ?? null}
                setSelected={(o) => {
                    if (!o) return;
                    const view = saved.views.find((v) => v.id === o.value);
                    if (!view) return;
                    onActiveChange(view.id);
                    onApply(view);
                }}
                options={options}
                caret
                placeholder={tViews('menu')}
                emptyState={tViews('none')}
                buttonProps={{ 'aria-label': tViews('menu') }}
            />
            {canSave && (
                <Button
                    id="save-view-btn"
                    variant="secondary"
                    text={tViews('save')}
                    onClick={() => {
                        setName('');
                        setShared(false);
                        setDialog({ mode: 'create' });
                    }}
                />
            )}
            {canChange && active && (
                <>
                    <Button variant="ghost" text={tViews('update')} onClick={() => void saved.update(active.id, snapshot())} />
                    <Button
                        variant="ghost"
                        text={tViews('rename')}
                        onClick={() => {
                            setName(active.name);
                            setShared(active.visibility === 'SHARED');
                            setDialog({ mode: 'rename', view: active });
                        }}
                    />
                </>
            )}
            {canDelete && active && (
                <Button
                    variant="ghost"
                    text={tViews('delete')}
                    aria-label={tViews('deleteView', { name: active.name })}
                    onClick={() => {
                        onActiveChange(null);
                        saved.remove(active);
                    }}
                />
            )}
            <Modal
                showModal={dialog !== null}
                setShowModal={(v) => {
                    const next = typeof v === 'function' ? v(dialog !== null) : v;
                    if (!next) close();
                }}
                title={dialog?.mode === 'rename' ? tViews('renameTitle') : tViews('saveTitle')}
                onClose={close}
            >
                <Modal.Header title={dialog?.mode === 'rename' ? tViews('renameTitle') : tViews('saveTitle')} />
                <Modal.Form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                    }}
                >
                    <Modal.Body>
                        <div className="space-y-default">
                            <FormField label={tViews('name')} required>
                                <Input id="saved-view-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} autoFocus />
                            </FormField>
                            {affordances.saveShared && (
                                <label className="flex items-center gap-tight text-sm">
                                    <Checkbox id="saved-view-shared" checked={shared} onCheckedChange={(c) => setShared(c === true)} />
                                    {tViews('shareWithEveryone')}
                                </label>
                            )}
                            {error && (
                                <p role="alert" className="text-sm text-content-error">
                                    {error}
                                </p>
                            )}
                        </div>
                    </Modal.Body>
                    <Modal.Footer>
                        <Modal.Actions>
                            <Button type="button" variant="secondary" text={tViews('cancel')} onClick={close} />
                            <Button type="submit" variant="primary" text={dialog?.mode === 'rename' ? tViews('saveChanges') : tViews('saveSubmit')} />
                        </Modal.Actions>
                    </Modal.Footer>
                </Modal.Form>
            </Modal>
        </div>
    );
}
