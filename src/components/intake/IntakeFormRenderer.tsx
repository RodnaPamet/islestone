'use client';

/**
 * An intake form, rendered from its definition (sub-phase 2.6a): the title,
 * the description, then each form field in its kind's control. The schema is
 * the one the server validates with (`compileIntakeRequestSchema`), given to
 * react-hook-form through `zodResolver`, so a field is refused at its own
 * input for the reason the server would refuse it. The builder's preview
 * renders the same component with `preview` (no send).
 *
 * Given `requester` (sub-phase 2.6b), it is a PUBLIC form: the schema is
 * `compilePublicIntakeRequestSchema`, it asks for the requester's name and
 * address as the rules say, offers "Email me about this request" beside an
 * address, and carries the trap field a person never sees or fills (off
 * screen, out of the tab order, labelled "Leave this field empty" for a
 * screen reader). The trap's value goes to `onSubmit` beside the request.
 *
 * Written fresh for Islestone, in the react-hook-form pattern of
 * inflect-compliance's `NewIncidentModal.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (pattern only).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';

import { Button } from '@inflect/ui/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    compileIntakeRequestSchema,
    compilePublicIntakeRequestSchema,
    INTAKE_LIMITS,
    type IntakeFormDefinition,
    type IntakeFormField,
    type IntakeRequesterRules,
    type PublicIntakeRequestInput,
} from '@/lib/intake/form-definition';

type Values = { title: string; body: string; answers: Record<string, unknown>; requesterName?: string; requesterEmail?: string; wantsUpdates?: boolean };

function emptyAnswer(f: IntakeFormField): unknown {
    if (f.kind === 'MULTI_SELECT') return [];
    if (f.kind === 'CHECKBOX') return false;
    return '';
}

export function IntakeFormRenderer({
    definition,
    formKey,
    onSubmit,
    preview = false,
    requester,
}: {
    definition: IntakeFormDefinition;
    /** A stable prefix for the controls' ids (the form's id). */
    formKey: string;
    /** Answers the server's refusal, or `null` when the request was sent. `website` is the public form's trap. */
    onSubmit?: (input: PublicIntakeRequestInput, extra: { website: string }) => Promise<string | null>;
    preview?: boolean;
    /** A public form's requester rules (2.6b): makes this the public form. */
    requester?: IntakeRequesterRules;
}) {
    const t = useTranslations('intake.form');
    const isPublic = requester !== undefined;
    const schema = useMemo(
        () => (isPublic ? compilePublicIntakeRequestSchema({ ...definition, requester }) : compileIntakeRequestSchema(definition)),
        [definition, isPublic, requester],
    );
    const defaults = useMemo<Values>(
        () => ({
            title: '',
            body: '',
            answers: Object.fromEntries(definition.fields.map((f) => [f.id, emptyAnswer(f)])),
            ...(requester && requester.name !== 'OFF' ? { requesterName: '' } : {}),
            ...(requester && requester.email !== 'OFF' ? { requesterEmail: '', wantsUpdates: false } : {}),
        }),
        [definition, requester],
    );

    const {
        register,
        handleSubmit,
        control,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<Values>({ resolver: zodResolver(schema) as unknown as Resolver<Values>, defaultValues: defaults });
    const [refusal, setRefusal] = useState<string | null>(null);

    const submit = (event: FormEvent<HTMLElement>) => {
        // The trap is outside react-hook-form (the schema is strict): read it from the submitted form.
        const form = event.currentTarget;
        const trap = form instanceof HTMLFormElement ? form.elements.namedItem('website') : null;
        const website = trap instanceof HTMLInputElement ? trap.value : '';
        return handleSubmit(async (values) => {
            if (preview || !onSubmit) return;
            setRefusal(null);
            const result = await onSubmit(values as unknown as PublicIntakeRequestInput, { website });
            if (result) setRefusal(result);
            else reset(defaults);
        })(event);
    };

    const id = (suffix: string) => `intake-${formKey}-${suffix}`;
    const answerError = (fieldId: string) => (errors.answers as Record<string, { message?: string }> | undefined)?.[fieldId]?.message;

    // The preview sits inside the builder's own form: a nested <form> is invalid.
    const Wrapper = preview ? 'div' : 'form';
    return (
        <Wrapper {...(preview ? {} : { onSubmit: submit, noValidate: true })} className="space-y-default" aria-label={t('aria')}>
            {definition.intro && <p className="whitespace-pre-wrap text-sm text-content-default">{definition.intro}</p>}
            <FormField label={t('title')} required error={errors.title?.message}>
                <Input id={id('title')} maxLength={INTAKE_LIMITS.title} {...register('title')} />
            </FormField>
            <FormField label={t('body')} error={errors.body?.message}>
                <Textarea id={id('body')} rows={4} maxLength={INTAKE_LIMITS.body} {...register('body')} />
            </FormField>
            {definition.fields.map((f) => {
                const name = `answers.${f.id}` as const;
                const common = { label: f.label, description: f.help || undefined, required: f.required, error: answerError(f.id) };
                switch (f.kind) {
                    case 'SHORT_TEXT':
                        return (
                            <FormField key={f.id} {...common}>
                                <Input id={id(f.id)} maxLength={INTAKE_LIMITS.shortText} {...register(name)} />
                            </FormField>
                        );
                    case 'LONG_TEXT':
                        return (
                            <FormField key={f.id} {...common}>
                                <Textarea id={id(f.id)} rows={3} maxLength={INTAKE_LIMITS.longText} {...register(name)} />
                            </FormField>
                        );
                    case 'NUMBER':
                        return (
                            <FormField key={f.id} {...common}>
                                <Input id={id(f.id)} inputMode="decimal" {...register(name)} />
                            </FormField>
                        );
                    case 'URL':
                        return (
                            <FormField key={f.id} {...common}>
                                <Input id={id(f.id)} type="url" maxLength={INTAKE_LIMITS.url} {...register(name)} />
                            </FormField>
                        );
                    case 'SELECT':
                        return (
                            <FormField key={f.id} {...common}>
                                <Controller
                                    control={control}
                                    name={name}
                                    render={({ field }) => {
                                        const options = (f.options ?? []).map((o) => ({ value: o, label: o }));
                                        return (
                                            <Combobox
                                                id={id(f.id)}
                                                selected={options.find((o) => o.value === field.value) ?? null}
                                                setSelected={(o) => field.onChange(o?.value ?? '')}
                                                options={options}
                                                placeholder={t('choose')}
                                                caret
                                                matchTriggerWidth
                                                buttonProps={{ 'aria-label': f.label }}
                                            />
                                        );
                                    }}
                                />
                            </FormField>
                        );
                    case 'DATE':
                        return (
                            <FormField key={f.id} {...common}>
                                <Controller
                                    control={control}
                                    name={name}
                                    render={({ field }) => (
                                        <DatePicker
                                            id={id(f.id)}
                                            value={parseYMD(typeof field.value === 'string' ? field.value : '')}
                                            onChange={(d) => field.onChange(toYMD(d) ?? '')}
                                            clearable
                                        />
                                    )}
                                />
                            </FormField>
                        );
                    case 'CHECKBOX':
                        return (
                            <div key={f.id} className="flex items-center gap-tight">
                                <Controller
                                    control={control}
                                    name={name}
                                    render={({ field }) => (
                                        <Checkbox id={id(f.id)} checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
                                    )}
                                />
                                <label htmlFor={id(f.id)} className="text-sm text-content-default">
                                    {f.label}
                                    {f.required ? ' *' : ''}
                                </label>
                                {answerError(f.id) && (
                                    <span role="alert" className="text-sm text-content-error">
                                        {answerError(f.id)}
                                    </span>
                                )}
                            </div>
                        );
                    case 'MULTI_SELECT':
                        return (
                            <fieldset key={f.id} className="space-y-tight">
                                <legend className="text-sm font-medium text-content-emphasis">
                                    {f.label}
                                    {f.required ? ' *' : ''}
                                </legend>
                                {f.help && <p className="text-xs text-content-muted">{f.help}</p>}
                                <Controller
                                    control={control}
                                    name={name}
                                    render={({ field }) => {
                                        const chosen = Array.isArray(field.value) ? (field.value as string[]) : [];
                                        return (
                                            <div className="space-y-tight">
                                                {(f.options ?? []).map((o, i) => (
                                                    <div key={o} className="flex items-center gap-tight">
                                                        <Checkbox
                                                            id={id(`${f.id}-${i}`)}
                                                            checked={chosen.includes(o)}
                                                            onCheckedChange={(v) => field.onChange(v === true ? [...chosen, o] : chosen.filter((x) => x !== o))}
                                                        />
                                                        <label htmlFor={id(`${f.id}-${i}`)} className="text-sm text-content-default">
                                                            {o}
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    }}
                                />
                                {answerError(f.id) && (
                                    <p role="alert" className="text-sm text-content-error">
                                        {answerError(f.id)}
                                    </p>
                                )}
                            </fieldset>
                        );
                }
            })}
            {requester && requester.name !== 'OFF' && (
                <FormField label={t('requesterName')} required={requester.name === 'REQUIRED'} error={errors.requesterName?.message}>
                    <Input id={id('requester-name')} autoComplete="name" maxLength={INTAKE_LIMITS.requesterName} {...register('requesterName')} />
                </FormField>
            )}
            {requester && requester.email !== 'OFF' && (
                <>
                    <FormField label={t('requesterEmail')} required={requester.email === 'REQUIRED'} error={errors.requesterEmail?.message}>
                        <Input id={id('requester-email')} type="email" autoComplete="email" maxLength={INTAKE_LIMITS.requesterEmail} {...register('requesterEmail')} />
                    </FormField>
                    <div className="flex items-center gap-tight">
                        <Controller
                            control={control}
                            name="wantsUpdates"
                            render={({ field }) => (
                                <Checkbox id={id('wants-updates')} checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
                            )}
                        />
                        <label htmlFor={id('wants-updates')} className="text-sm text-content-default">
                            {t('wantsUpdates')}
                        </label>
                    </div>
                    <p className="text-xs text-content-muted">{t('wantsUpdatesHint')}</p>
                </>
            )}
            {isPublic && !preview && (
                // The trap: off screen and out of the tab order, so a person never fills it.
                <div style={{ position: 'absolute', left: '-10000px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
                    <label htmlFor={id('website')}>{t('trap')}</label>
                    <input id={id('website')} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
                </div>
            )}
            {refusal && (
                <p role="alert" className="text-sm text-content-error">
                    {refusal}
                </p>
            )}
            {!preview && <Button type="submit" variant="primary" loading={isSubmitting} text={t('send')} />}
        </Wrapper>
    );
}
