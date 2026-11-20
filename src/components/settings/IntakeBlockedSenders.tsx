'use client';

/**
 * Settings → Intake, blocked senders (sub-phase 2.6c; ADR 0006 "Blocked
 * sender"; owner decision 92): addresses a project, or the whole workspace,
 * takes no intake from. A block is kept only as the address's lookup hash,
 * so the list shows where, when and by whom an address was blocked, and a
 * manager finds an address's blocks by typing it (sent in a POST body, never
 * a URL). Unblocking goes through the undo toast (`use-undo-delete.ts`).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { formatDate } from '@inflect/ui/lib/format-date';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import type { IntakeBlockedSenderView, ProjectIntakeSettings } from '@/lib/intake/types';

import { INTAKE_PATHS, intakeRefusal, useBlockedSenders, useIntakeApi } from '@/components/intake/data/intake-data';
import { useUndoDelete } from './use-undo-delete';

const WORKSPACE = '__workspace__';

export function IntakeBlockedSenders({ projects, canManage }: { projects: ProjectIntakeSettings[]; canManage: boolean }) {
    const t = useTranslations('settings.intake.blocked');
    const toast = useToast();
    const { send } = useIntakeApi();
    const undoDelete = useUndoDelete();
    const { byId } = useMembers();
    const { data: rows } = useBlockedSenders(canManage);
    const [email, setEmail] = useState('');
    const [scope, setScope] = useState<string>(WORKSPACE);
    const [found, setFound] = useState<{ email: string; rows: IntakeBlockedSenderView[] } | null>(null);
    const projectName = new Map(projects.map((p) => [p.projectId, `${p.projectName} (${p.keyPrefix})`]));
    const scopeOptions = [{ value: WORKSPACE, label: t('workspace') }, ...projects.map((p) => ({ value: p.projectId, label: `${p.projectName} (${p.keyPrefix})` }))];
    const scopeLabel = (r: IntakeBlockedSenderView) => (r.projectId ? (projectName.get(r.projectId) ?? t('unknownProject')) : t('workspace'));

    if (!canManage) return null;

    const block = async () => {
        const address = email.trim();
        if (!address) return;
        try {
            await send('POST', INTAKE_PATHS.blockedSenders, { email: address, projectId: scope === WORKSPACE ? null : scope });
            setEmail('');
            setFound(null);
            toast.success(t('blockedToast'));
        } catch (err) {
            toast.error(intakeRefusal(err, t('failed')));
        }
    };
    const find = async () => {
        const address = email.trim();
        if (!address) return;
        try {
            setFound({ email: address, rows: await send<IntakeBlockedSenderView[]>('POST', `${INTAKE_PATHS.blockedSenders}/find`, { email: address }) });
        } catch (err) {
            toast.error(intakeRefusal(err, t('failed')));
        }
    };
    const unblock = (r: IntakeBlockedSenderView) => {
        setFound((f) => (f ? { ...f, rows: f.rows.filter((x) => x.id !== r.id) } : f));
        undoDelete<IntakeBlockedSenderView[]>({
            path: INTAKE_PATHS.blockedSenders,
            without: (current) => current?.filter((x) => x.id !== r.id),
            deletePath: `${INTAKE_PATHS.blockedSenders}/${encodeURIComponent(r.id)}`,
            message: t('unblockedToast', { scope: scopeLabel(r) }),
        });
    };

    const list = (items: IntakeBlockedSenderView[], label: string) => (
        <ul className="divide-y divide-border-subtle" aria-label={label}>
            {items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-tight py-tight text-sm">
                    <span>
                        <span className="text-content-emphasis">{scopeLabel(r)}</span>{' '}
                        <span className="text-xs text-content-muted">
                            {t('blockedOn', { date: formatDate(r.createdAt), who: memberLabel(byId.get(r.createdByUserId)) ?? t('formerMember') })}
                        </span>
                    </span>
                    <Button variant="ghost" size="sm" text={t('unblock')} aria-label={t('unblockNamed', { scope: scopeLabel(r) })} onClick={() => unblock(r)} />
                </li>
            ))}
        </ul>
    );

    return (
        <section aria-labelledby="intake-blocked-senders" className="space-y-default rounded-md border border-border-subtle p-default" data-testid="intake-blocked-senders">
            <div className="space-y-tight">
                <h2 id="intake-blocked-senders" className="text-lg font-semibold text-content-emphasis">
                    {t('title')}
                </h2>
                <p className="text-sm text-content-muted">{t('description')}</p>
            </div>
            <div className="flex flex-wrap items-end gap-tight">
                <FormField label={t('address')} className="min-w-64 flex-1">
                    <Input id="intake-blocked-address" type="email" autoComplete="off" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />
                </FormField>
                <FormField label={t('scope')} className="min-w-48">
                    <Combobox
                        id="intake-blocked-scope"
                        selected={scopeOptions.find((o) => o.value === scope) ?? null}
                        setSelected={(o) => o && setScope(o.value)}
                        options={scopeOptions}
                        caret
                    />
                </FormField>
                <Button variant="secondary" text={t('block')} onClick={() => void block()} disabled={!email.trim()} />
                <Button variant="ghost" text={t('find')} onClick={() => void find()} disabled={!email.trim()} />
            </div>
            {found && (
                <div className="space-y-tight" role="status">
                    <p className="text-sm text-content-default">{found.rows.length === 0 ? t('notBlocked', { email: found.email }) : t('foundCount', { email: found.email, count: found.rows.length })}</p>
                    {found.rows.length > 0 && list(found.rows, t('foundLabel'))}
                </div>
            )}
            {(rows ?? []).length === 0 ? <p className="text-sm text-content-muted">{t('none')}</p> : list(rows ?? [], t('listLabel'))}
        </section>
    );
}
