'use client';

/**
 * A project's custom fields, defined (sub-phase 2.4): create a field (name,
 * type, and the options of a select), rename, reorder, archive and
 * unarchive it; add, rename, archive and delete the options of a select
 * (a delete through the undo toast; one a value holds is refused and should
 * be archived). Offered to a viewer who may change the project
 * (`manageCustomFields`, asked on the server), from the project's page and
 * from Settings → Projects.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { CUSTOM_FIELD_TYPES, CUSTOM_FIELD_TYPE_SPECS, type CustomFieldType } from '@/lib/work-items/custom-fields';

import { useCustomFields, type ManagedField } from '../data/use-custom-fields';
import { useProjectFieldSet } from '../data/use-field-sets';
import { useWorkItemTypes } from '@/components/settings/settings-data';
import { useToast } from '@/components/ui/hooks';
import { ApiClientError } from '@/lib/data/api-client';
import { FIELD_REQUIREMENTS, type FieldRequirementValue } from '@/lib/work-items/field-sets';

/**
 * A field's rule per work item type in this project (2.4b-b, decision 108):
 * Required, Optional or Hidden, through `PUT /projects/:id/type-fields`.
 */
function FieldRules({ field, rules }: { field: ManagedField; rules: ReturnType<typeof useProjectFieldSet> }) {
    const tRules = useTranslations('workItems.fieldSet');
    const { data: types } = useWorkItemTypes();
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const options: ComboboxOption[] = FIELD_REQUIREMENTS.map((r) => ({ value: r, label: tRules(`requirement.${r}`) }));
    const current = (typeId: string): FieldRequirementValue =>
        rules.rules.find((r) => r.typeId === typeId && r.customFieldId === field.id)?.requirement ?? 'OPTIONAL';
    const change = async (typeId: string, requirement: FieldRequirementValue) => {
        if (requirement === current(typeId)) return;
        try {
            await rules.setRule(typeId, field.id, requirement);
        } catch (err) {
            toast.error(err instanceof ApiClientError && err.message ? err.message : tRules('failed'));
        }
    };
    return (
        <div className="space-y-tight pl-2">
            <Button
                variant="ghost"
                size="sm"
                text={tRules('rules')}
                aria-expanded={open}
                aria-label={tRules('rulesFor', { field: field.name })}
                onClick={() => setOpen((v) => !v)}
            />
            {open && (
                <div className="space-y-tight">
                    <p className="text-xs text-content-muted">{tRules('rulesHint')}</p>
                    <ul className="space-y-tight" aria-label={tRules('rulesFor', { field: field.name })}>
                        {(types ?? [])
                            .filter((ty) => !ty.archivedAt)
                            .map((ty) => (
                                <li key={ty.id} className="flex items-center gap-tight text-sm">
                                    <span className="min-w-[8rem]">{ty.name}</span>
                                    <Combobox
                                        id={`cf-rule-${field.id}-${ty.id}`}
                                        selected={options.find((o) => o.value === current(ty.id)) ?? null}
                                        setSelected={(o) => o && void change(ty.id, o.value as FieldRequirementValue)}
                                        options={options}
                                        hideSearch
                                        caret
                                        buttonProps={{ 'aria-label': tRules('ruleFor', { field: field.name, type: ty.name }) }}
                                    />
                                </li>
                            ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function FieldRow({
    field,
    fields,
    api,
    rules,
}: {
    field: ManagedField;
    fields: ManagedField[];
    api: ReturnType<typeof useCustomFields>;
    rules: ReturnType<typeof useProjectFieldSet>;
}) {
    const tRow = useTranslations('workItems.customFields');
    const [name, setName] = useState(field.name);
    const [option, setOption] = useState('');
    const live = fields.filter((f) => !f.archived);
    const liveIndex = live.findIndex((f) => f.id === field.id);
    return (
        <li className="space-y-tight rounded-md border border-border-subtle p-3" aria-label={field.name}>
            <div className="flex flex-wrap items-center gap-tight">
                <Input
                    aria-label={tRow('fieldName', { name: field.name })}
                    value={name}
                    maxLength={100}
                    className="max-w-xs"
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => name.trim() && name.trim() !== field.name && void api.updateField(field.id, { name: name.trim() })}
                />
                <span className="text-xs text-content-muted">{tRow(`type.${field.type}`)}</span>
                {field.archived && <span className="text-xs text-content-muted">{tRow('archived')}</span>}
                {!field.archived && liveIndex > 0 && (
                    <Button variant="ghost" size="sm" text={tRow('moveUp')} aria-label={tRow('moveUpField', { name: field.name })} onClick={() => void api.updateField(field.id, { position: { beforeId: live[liveIndex - 1]!.id } })} />
                )}
                {!field.archived && liveIndex >= 0 && liveIndex < live.length - 1 && (
                    <Button variant="ghost" size="sm" text={tRow('moveDown')} aria-label={tRow('moveDownField', { name: field.name })} onClick={() => void api.updateField(field.id, { position: { afterId: live[liveIndex + 1]!.id } })} />
                )}
                <Button
                    variant="secondary"
                    size="sm"
                    text={field.archived ? tRow('unarchive') : tRow('archive')}
                    aria-label={field.archived ? tRow('unarchiveField', { name: field.name }) : tRow('archiveField', { name: field.name })}
                    onClick={() => void api.updateField(field.id, { archived: !field.archived })}
                />
            </div>
            {!field.archived && <FieldRules field={field} rules={rules} />}
            {CUSTOM_FIELD_TYPE_SPECS[field.type].hasOptions && !field.archived && (
                <div className="space-y-tight pl-2">
                    <ul className="space-y-tight" aria-label={tRow('optionsOf', { name: field.name })}>
                        {field.options.map((o) => (
                            <li key={o.id} className="flex items-center gap-tight text-sm">
                                <span className={o.archived ? 'text-content-muted line-through' : 'text-content-default'}>{o.name}</span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    text={o.archived ? tRow('unarchive') : tRow('archive')}
                                    aria-label={o.archived ? tRow('unarchiveOption', { name: o.name }) : tRow('archiveOption', { name: o.name })}
                                    onClick={() => void api.updateOption(field.id, o.id, { archived: !o.archived })}
                                />
                                <Button variant="ghost" size="sm" text={tRow('remove')} aria-label={tRow('removeOption', { name: o.name })} onClick={() => api.removeOption(field, o)} />
                            </li>
                        ))}
                    </ul>
                    <form
                        className="flex items-center gap-tight"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const value = option.trim();
                            if (!value) return;
                            void api.addOption(field.id, value).then((ok) => ok && setOption(''));
                        }}
                    >
                        <Input aria-label={tRow('newOptionFor', { name: field.name })} value={option} maxLength={100} className="max-w-xs" onChange={(e) => setOption(e.target.value)} />
                        <Button type="submit" variant="secondary" size="sm" text={tRow('addOption')} />
                    </form>
                </div>
            )}
        </li>
    );
}

export function CustomFieldsManager({
    projectId,
    projectName,
    open,
    onOpenChange,
}: {
    projectId: string;
    projectName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const tManager = useTranslations('workItems.customFields');
    const api = useCustomFields(projectId, open);
    const rules = useProjectFieldSet(open ? projectId : undefined);
    const [name, setName] = useState('');
    const [type, setType] = useState<CustomFieldType>('TEXT');
    const [options, setOptions] = useState('');
    const typeOptions: ComboboxOption[] = CUSTOM_FIELD_TYPES.map((x) => ({ value: x, label: tManager(`type.${x}`) }));
    const hasOptions = CUSTOM_FIELD_TYPE_SPECS[type].hasOptions;
    const ordered = [...api.fields.filter((f) => !f.archived), ...api.fields.filter((f) => f.archived)];

    const create = async (e: FormEvent) => {
        e.preventDefault();
        const value = name.trim();
        if (!value) return;
        const list = hasOptions
            ? options
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((n) => ({ name: n }))
            : undefined;
        const created = await api.createField({ name: value, type, ...(list ? { options: list } : {}) });
        if (created) {
            setName('');
            setOptions('');
        }
    };

    return (
        <Modal
            showModal={open}
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(open) : v;
                if (!next) onOpenChange(false);
            }}
            title={tManager('title', { project: projectName })}
            onClose={() => onOpenChange(false)}
        >
            <Modal.Header title={tManager('title', { project: projectName })} description={tManager('description')} />
            <Modal.Body>
                <div className="space-y-section">
                    <section aria-labelledby="cf-list-heading" className="space-y-default">
                        <h2 id="cf-list-heading" className="text-sm font-semibold text-content-emphasis">
                            {tManager('listHeading')}
                        </h2>
                        {api.isLoading ? (
                            <p className="text-sm text-content-muted">{tManager('loading')}</p>
                        ) : ordered.length === 0 ? (
                            <p className="text-sm text-content-muted">{tManager('empty')}</p>
                        ) : (
                            <ul className="space-y-default">
                                {ordered.map((f) => (
                                    <FieldRow key={f.id} field={f} fields={api.fields} api={api} rules={rules} />
                                ))}
                            </ul>
                        )}
                    </section>
                    <form onSubmit={create} className="space-y-default" aria-labelledby="cf-create-heading">
                        <h2 id="cf-create-heading" className="text-sm font-semibold text-content-emphasis">
                            {tManager('createHeading')}
                        </h2>
                        <FormField label={tManager('name')} required>
                            <Input id="cf-new-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
                        </FormField>
                        <FormField label={tManager('typeLabel')}>
                            <Combobox
                                id="cf-new-type"
                                selected={typeOptions.find((o) => o.value === type) ?? null}
                                setSelected={(o) => o && setType(o.value as CustomFieldType)}
                                options={typeOptions}
                                hideSearch
                                caret
                            />
                        </FormField>
                        {hasOptions && (
                            <FormField label={tManager('optionsLabel')} hint={tManager('optionsHint')}>
                                <Textarea id="cf-new-options" value={options} rows={4} onChange={(e) => setOptions(e.target.value)} />
                            </FormField>
                        )}
                        {(type === 'TEXT' || type === 'URL') && <p className="text-xs text-content-muted">{tManager('notEncrypted')}</p>}
                        <Button id="cf-create-btn" type="submit" variant="primary" text={tManager('create')} />
                    </form>
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Modal.Actions>
                    <Button type="button" variant="secondary" text={tManager('done')} onClick={() => onOpenChange(false)} />
                </Modal.Actions>
            </Modal.Footer>
        </Modal>
    );
}
