'use client';

/**
 * Settings → Intake's form builder (sub-phase 2.6a; owner decision 93): a
 * form's name, whether it is published, its intro and confirmation text, and
 * its fields (kind, label, help, required, a select's options, the project
 * custom field it fills on accept), each moved up or down by a button. The
 * preview renders the same component as the form's page. The server
 * validates and sanitises the definition (`IntakeFormDefinitionSchema`);
 * its refusal is shown here with the person's work kept. An edit sends the
 * form's version in `If-Match`.
 *
 * Sub-phase 2.6b: who may send through it, members or anyone with the link
 * (offered only while public forms are open on the deployment, or to turn a
 * public form back into a members' one), and, for a public form, whether it
 * asks for the requester's name and address. The preview of a public form is
 * the public page's own form.
 *
 * Written fresh for Islestone, on react-hook-form (`useFieldArray`).
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';

import { Button } from '@inflect/ui/components/ui/button';
import { IntakeFormRenderer } from '@/components/intake/IntakeFormRenderer';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import {
    FIELD_KIND_FILLS,
    INTAKE_FIELD_KINDS,
    INTAKE_LIMITS,
    INTAKE_REQUESTER_ASKS,
    IntakeFormDefinitionSchema,
    nextFieldId,
    type IntakeFieldKind,
    type IntakeFormDefinition,
    type IntakeRequesterAsk,
} from '@/lib/intake/form-definition';
import type { IntakeFormData } from '@/lib/intake/types';

import { intakeRefusal, useIntakeApi } from '@/components/intake/data/intake-data';
import { SettingsFormModal } from './SettingsFormModal';

interface BuilderField {
    id: string;
    kind: IntakeFieldKind;
    label: string;
    help: string;
    required: boolean;
    optionsText: string;
    customFieldId: string;
}

interface BuilderValues {
    name: string;
    published: boolean;
    access: 'MEMBERS' | 'PUBLIC';
    requesterName: IntakeRequesterAsk;
    requesterEmail: IntakeRequesterAsk;
    intro: string;
    confirmation: string;
    fields: BuilderField[];
}

const isSelect = (k: IntakeFieldKind) => k === 'SELECT' || k === 'MULTI_SELECT';

function toValues(form: IntakeFormData | null): BuilderValues {
    const d = form?.definition;
    return {
        name: form?.name ?? '',
        published: form ? form.published : true,
        access: form?.access ?? 'MEMBERS',
        requesterName: d?.requester.name ?? 'OFF',
        requesterEmail: d?.requester.email ?? 'OFF',
        intro: d?.intro ?? '',
        confirmation: d?.confirmation ?? '',
        fields: (d?.fields ?? []).map((f) => ({
            id: f.id,
            kind: f.kind,
            label: f.label,
            help: f.help ?? '',
            required: f.required,
            optionsText: (f.options ?? []).join('\n'),
            customFieldId: f.customFieldId ?? '',
        })),
    };
}

/** The builder's values as a definition (unvalidated: the server is the judge). */
export function definitionOf(v: Pick<BuilderValues, 'intro' | 'confirmation' | 'fields'> & Partial<Pick<BuilderValues, 'requesterName' | 'requesterEmail'>>): IntakeFormDefinition {
    return {
        requester: { name: v.requesterName ?? 'OFF', email: v.requesterEmail ?? 'OFF' },
        intro: v.intro,
        confirmation: v.confirmation,
        fields: v.fields.map((f) => ({
            id: f.id,
            kind: f.kind,
            label: f.label.trim(),
            ...(f.help.trim() ? { help: f.help.trim() } : {}),
            required: f.required,
            ...(isSelect(f.kind)
                ? {
                      options: f.optionsText
                          .split('\n')
                          .map((o) => o.trim())
                          .filter(Boolean),
                  }
                : {}),
            customFieldId: f.customFieldId && FIELD_KIND_FILLS[f.kind] ? f.customFieldId : null,
        })),
    };
}

export function IntakeFormBuilder({
    open,
    onOpenChange,
    projectId,
    form,
    publicForms = false,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    /** The form to edit; `null` creates one. */
    form: IntakeFormData | null;
    /** Whether public forms are open on this deployment (asked on the server, 2.6b). */
    publicForms?: boolean;
}) {
    const t = useTranslations('settings.intake.builder');
    const tKind = useTranslations('settings.intake.kind');
    const { send } = useIntakeApi();
    const { data: customFields } = useTenantSWR<Array<{ id: string; name: string; type: string }>>(`/projects/${encodeURIComponent(projectId)}/custom-fields`);
    const { register, control, handleSubmit, getValues } = useForm<BuilderValues>({ defaultValues: toValues(form) });
    const { fields, append, remove, move } = useFieldArray({ control, name: 'fields', keyName: 'key' });
    const [preview, setPreview] = useState<IntakeFormDefinition | null>(null);
    const kindOptions = INTAKE_FIELD_KINDS.map((k) => ({ value: k, label: tKind(k) }));
    const watched = useWatch({ control, name: 'fields' });
    const access = useWatch({ control, name: 'access' });
    const accessOptions = [
        { value: 'MEMBERS' as const, label: t('accessMembers') },
        { value: 'PUBLIC' as const, label: t('accessPublic') },
    ];
    const askOptions = INTAKE_REQUESTER_ASKS.map((a) => ({ value: a, label: t(`ask.${a}`) }));
    // A members' form may be made public only while public forms are open; a public one may always go back.
    const offerAccess = publicForms || form?.access === 'PUBLIC';

    const fieldOptionsFor = useMemo(
        () => (kind: IntakeFieldKind) => [
            { value: '', label: t('noCustomField') },
            ...(customFields ?? []).filter((c) => FIELD_KIND_FILLS[kind] === c.type).map((c) => ({ value: c.id, label: c.name })),
        ],
        [customFields, t],
    );

    const submit = async (): Promise<string | null> => {
        let refusal: string | null = null;
        await handleSubmit(async (v) => {
            const definition = definitionOf(v);
            try {
                const access = offerAccess ? { access: v.access } : {};
                if (form) {
                    await send('PATCH', `/intake/forms/${encodeURIComponent(form.id)}`, { name: v.name, definition, published: v.published, ...access }, form.version);
                } else {
                    await send('POST', '/intake/forms', { projectId, name: v.name, definition, published: v.published, ...access });
                }
            } catch (err) {
                refusal = intakeRefusal(err, t('failed'));
            }
        })();
        return refusal;
    };

    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={form ? t('editTitle', { name: form.name }) : t('createTitle')}
            submitLabel={form ? t('save') : t('create')}
            onSubmit={submit}
        >
            <FormField label={t('name')} required>
                <Input id="intake-form-name" maxLength={INTAKE_LIMITS.formName} {...register('name', { required: true })} />
            </FormField>
            <div className="flex items-center gap-tight">
                <Controller
                    control={control}
                    name="published"
                    render={({ field }) => <Switch id="intake-form-published" checked={field.value} onCheckedChange={field.onChange} />}
                />
                <label htmlFor="intake-form-published" className="text-sm text-content-default">
                    {t('published')}
                </label>
            </div>
            {offerAccess && (
                <FormField label={t('access')} description={access === 'PUBLIC' ? t('accessPublicHint') : t('accessMembersHint')}>
                    <Controller
                        control={control}
                        name="access"
                        render={({ field }) => (
                            <Combobox
                                id="intake-form-access"
                                selected={accessOptions.find((o) => o.value === field.value) ?? accessOptions[0]!}
                                setSelected={(o) => o && field.onChange(o.value)}
                                options={accessOptions.filter((o) => o.value === 'MEMBERS' || publicForms || field.value === 'PUBLIC')}
                                caret
                                buttonProps={{ 'aria-label': t('access') }}
                            />
                        )}
                    />
                </FormField>
            )}
            {access === 'PUBLIC' && (
                <div className="grid grid-cols-1 gap-tight sm:grid-cols-2">
                    {(['requesterName', 'requesterEmail'] as const).map((key) => (
                        <FormField key={key} label={t(key === 'requesterName' ? 'askName' : 'askEmail')}>
                            <Controller
                                control={control}
                                name={key}
                                render={({ field }) => (
                                    <Combobox
                                        id={`intake-form-${key}`}
                                        selected={askOptions.find((o) => o.value === field.value) ?? askOptions[0]!}
                                        setSelected={(o) => o && field.onChange(o.value)}
                                        options={askOptions}
                                        caret
                                        buttonProps={{ 'aria-label': t(key === 'requesterName' ? 'askName' : 'askEmail') }}
                                    />
                                )}
                            />
                        </FormField>
                    ))}
                </div>
            )}
            <FormField label={t('intro')}>
                <Textarea id="intake-form-intro" rows={2} maxLength={INTAKE_LIMITS.intro} {...register('intro')} />
            </FormField>
            <FormField label={t('confirmation')} description={t('confirmationHint')}>
                <Textarea id="intake-form-confirmation" rows={2} maxLength={INTAKE_LIMITS.confirmation} {...register('confirmation')} />
            </FormField>
            <fieldset className="space-y-default">
                <legend className="text-sm font-medium text-content-emphasis">{t('fields')}</legend>
                <p className="text-xs text-content-muted">{t('fieldsHint')}</p>
                {fields.map((f, i) => {
                    const kind = watched?.[i]?.kind ?? f.kind;
                    const label = watched?.[i]?.label || t('untitled', { n: i + 1 });
                    return (
                        <div key={f.key} className="space-y-tight rounded-md border border-border-subtle p-default" data-testid="intake-builder-field">
                            <div className="grid grid-cols-1 gap-tight sm:grid-cols-2">
                                <FormField label={t('label')} required>
                                    <Input id={`intake-field-${f.id}-label`} maxLength={INTAKE_LIMITS.label} {...register(`fields.${i}.label`)} />
                                </FormField>
                                <FormField label={t('kind')}>
                                    <Controller
                                        control={control}
                                        name={`fields.${i}.kind`}
                                        render={({ field }) => (
                                            <Combobox
                                                id={`intake-field-${f.id}-kind`}
                                                selected={kindOptions.find((o) => o.value === field.value) ?? null}
                                                setSelected={(o) => o && field.onChange(o.value)}
                                                options={kindOptions}
                                                caret
                                                buttonProps={{ 'aria-label': t('kindOf', { label }) }}
                                            />
                                        )}
                                    />
                                </FormField>
                            </div>
                            <FormField label={t('help')}>
                                <Input id={`intake-field-${f.id}-help`} maxLength={INTAKE_LIMITS.help} {...register(`fields.${i}.help`)} />
                            </FormField>
                            {isSelect(kind) && (
                                <FormField label={t('options')} description={t('optionsHint')}>
                                    <Textarea id={`intake-field-${f.id}-options`} rows={3} {...register(`fields.${i}.optionsText`)} />
                                </FormField>
                            )}
                            {FIELD_KIND_FILLS[kind] && (
                                <FormField label={t('customField')} description={t('customFieldHint')}>
                                    <Controller
                                        control={control}
                                        name={`fields.${i}.customFieldId`}
                                        render={({ field }) => {
                                            const options = fieldOptionsFor(kind);
                                            return (
                                                <Combobox
                                                    id={`intake-field-${f.id}-custom`}
                                                    selected={options.find((o) => o.value === field.value) ?? options[0]!}
                                                    setSelected={(o) => field.onChange(o?.value ?? '')}
                                                    options={options}
                                                    caret
                                                    buttonProps={{ 'aria-label': t('customFieldOf', { label }) }}
                                                />
                                            );
                                        }}
                                    />
                                </FormField>
                            )}
                            <div className="flex flex-wrap items-center gap-tight">
                                <Controller
                                    control={control}
                                    name={`fields.${i}.required`}
                                    render={({ field }) => (
                                        <Checkbox id={`intake-field-${f.id}-required`} checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                                    )}
                                />
                                <label htmlFor={`intake-field-${f.id}-required`} className="text-sm text-content-default">
                                    {t('required')}
                                </label>
                                <Button type="button" variant="ghost" size="sm" text={t('up')} aria-label={t('upNamed', { label })} disabled={i === 0} onClick={() => move(i, i - 1)} />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    text={t('down')}
                                    aria-label={t('downNamed', { label })}
                                    disabled={i === fields.length - 1}
                                    onClick={() => move(i, i + 1)}
                                />
                                <Button type="button" variant="ghost" size="sm" text={t('remove')} aria-label={t('removeNamed', { label })} onClick={() => remove(i)} />
                            </div>
                        </div>
                    );
                })}
                <Button
                    type="button"
                    variant="secondary"
                    text={t('addField')}
                    disabled={fields.length >= INTAKE_LIMITS.fields}
                    onClick={() =>
                        append({ id: nextFieldId(getValues('fields')), kind: 'SHORT_TEXT', label: '', help: '', required: false, optionsText: '', customFieldId: '' })
                    }
                />
            </fieldset>
            <div className="space-y-tight">
                <Button
                    type="button"
                    variant="secondary"
                    text={preview ? t('hidePreview') : t('preview')}
                    onClick={() => {
                        if (preview) return setPreview(null);
                        const parsed = IntakeFormDefinitionSchema.safeParse(definitionOf(getValues()));
                        setPreview(parsed.success ? parsed.data : definitionOf(getValues()));
                    }}
                />
                {preview && (
                    <div className="rounded-md border border-border-subtle p-default" aria-label={t('previewLabel')} role="region">
                        <IntakeFormRenderer
                            definition={preview}
                            formKey="preview"
                            preview
                            requester={getValues('access') === 'PUBLIC' ? preview.requester : undefined}
                        />
                    </div>
                )}
            </div>
        </SettingsFormModal>
    );
}
