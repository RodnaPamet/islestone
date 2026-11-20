'use client';

/**
 * The Intake page (sub-phase 2.6a; owner decisions 90 and 91), workspace-wide
 * or one project's: the requests of a view (New, Snoozed, Spam, Decided) on
 * the left and the selected request on the right, with the triage actions
 * the server offers (`IntakeAffordances`). The selection is in the URL
 * (`?request=<id>`, the bell's link) and moves to the next request after a
 * decision. "Intake" is not the notification Inbox (ADR 0006).
 *
 * The layout follows circle's intake split view (MIT; its study's §4.8),
 * pattern only. Written fresh for Islestone.
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useToast } from '@/components/ui/hooks';
import { memberLabel, useMembers, useWorkConfig } from '@/components/work-items/data/use-work-config';
import { INTAKE_VIEWS, type IntakeAffordances, type IntakeRequestDetail, type IntakeRequestRow, type IntakeView as View } from '@/lib/intake/types';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { workItemPath } from '@/lib/work-item-paths';

import { intakeRefusal, useIntakeApi, useIntakeRequest, useIntakeRequests } from './data/intake-data';
import { IntakeDialog, type IntakeDialogKind } from './IntakeDialogs';

function formatDate(iso: string): string {
    return iso.slice(0, 10);
}

function RequestDetail({
    request,
    affordances,
    openRequests,
    onDecided,
}: {
    request: IntakeRequestDetail;
    affordances: IntakeAffordances;
    openRequests: IntakeRequestRow[];
    onDecided: (next: IntakeRequestDetail) => void;
}) {
    const tDetail = useTranslations('intake');
    const config = useWorkConfig();
    const { byId } = useMembers();
    const tenantHref = useTenantHref();
    const toast = useToast();
    const { send } = useIntakeApi();
    const [dialog, setDialog] = useState<IntakeDialogKind | null>(null);
    const project = config.projectById.get(request.projectId);
    const open = request.status === 'PENDING' || request.status === 'SNOOZED';
    const reopenable = request.status === 'SNOOZED' || request.status === 'DECLINED' || request.status === 'MERGED';
    const requester = request.requesterUserId
        ? (memberLabel(byId.get(request.requesterUserId)) ?? tDetail('detail.unknownMember'))
        : (request.requesterName ?? request.requesterEmail ?? (request.channel === 'PUBLIC_FORM' ? tDetail('detail.outsider') : tDetail('detail.noRequester')));

    const reopen = async () => {
        try {
            onDecided(await send<IntakeRequestDetail>('POST', `/intake/requests/${encodeURIComponent(request.id)}/reopen`, undefined, request.version));
            toast.success(tDetail('toast.reopened'));
        } catch (err) {
            toast.error(intakeRefusal(err, tDetail('toast.failed')));
        }
    };

    return (
        <article aria-labelledby="intake-request-title" className="space-y-default" data-testid="intake-request-detail">
            <div className="space-y-tight">
                <h2 id="intake-request-title" className="text-lg font-semibold text-content-emphasis">
                    {request.title}
                </h2>
                <dl className="grid grid-cols-2 gap-x-default gap-y-tight text-sm sm:grid-cols-4">
                    <div>
                        <dt className="text-xs text-content-muted">{tDetail('detail.status')}</dt>
                        <dd className="text-content-emphasis">{tDetail(`status.${request.status}`)}</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-content-muted">{tDetail('detail.project')}</dt>
                        <dd className="text-content-emphasis">{project ? `${project.name} (${project.keyPrefix})` : '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-content-muted">{tDetail('detail.from')}</dt>
                        <dd className="text-content-emphasis">{requester}</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-content-muted">{tDetail('detail.channel')}</dt>
                        <dd className="text-content-emphasis">
                            {tDetail(`channel.${request.channel}`)}
                            {request.formName ? ` · ${request.formName}` : ''}
                        </dd>
                    </div>
                    {request.requesterEmail && (
                        <div className="col-span-2">
                            <dt className="text-xs text-content-muted">{tDetail('detail.email')}</dt>
                            <dd className="break-all text-content-emphasis">{request.requesterEmail}</dd>
                        </div>
                    )}
                    {request.channel === 'PUBLIC_FORM' && (
                        <div className="col-span-2">
                            <dt className="text-xs text-content-muted">{tDetail('detail.updates')}</dt>
                            <dd className="text-content-emphasis">{tDetail(`updates.${request.requesterUpdates}`)}</dd>
                        </div>
                    )}
                </dl>
            </div>
            {request.body && <p className="whitespace-pre-wrap text-sm text-content-default">{request.body}</p>}
            {request.answers.length > 0 && (
                <dl className="space-y-tight text-sm" aria-label={tDetail('detail.answers')}>
                    {request.answers.map((a) => (
                        <div key={a.fieldId}>
                            <dt className="text-xs text-content-muted">{a.label}</dt>
                            <dd className="whitespace-pre-wrap text-content-default">
                                {Array.isArray(a.value) ? a.value.join(', ') : typeof a.value === 'boolean' ? (a.value ? tDetail('detail.yes') : tDetail('detail.no')) : String(a.value)}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
            {request.status === 'SNOOZED' && request.snoozedUntil && <p className="text-sm text-content-muted">{tDetail('detail.snoozedUntil', { date: request.snoozedUntil })}</p>}
            {request.status === 'ACCEPTED' && request.workItemKey && request.workItemId && (
                <p className="text-sm">
                    {tDetail('detail.acceptedAs')}{' '}
                    <Link className="text-content-emphasis underline" href={tenantHref(workItemPath(request.workItemKey))}>
                        {request.workItemKey}
                    </Link>
                </p>
            )}
            {request.status === 'DECLINED' && request.declineReason && (
                <div className="space-y-tight text-sm">
                    <p>{tDetail('detail.declinedFor', { reason: tDetail(`reason.${request.declineReason}`) })}</p>
                    {request.declineExplanation && <p className="whitespace-pre-wrap text-content-default">{request.declineExplanation}</p>}
                </div>
            )}
            {request.status === 'MERGED' && (
                <p className="text-sm">
                    {request.mergedIntoWorkItemKey ? (
                        <>
                            {tDetail('detail.mergedIntoItem')}{' '}
                            <Link className="text-content-emphasis underline" href={tenantHref(workItemPath(request.mergedIntoWorkItemKey))}>
                                {request.mergedIntoWorkItemKey}
                            </Link>
                        </>
                    ) : (
                        tDetail('detail.mergedIntoRequest')
                    )}
                </p>
            )}
            {request.mergedRequestCount > 0 && <p className="text-sm text-content-muted">{tDetail('detail.mergedCount', { count: request.mergedRequestCount })}</p>}
            {request.internalRemark && (
                <p className="text-sm text-content-muted">
                    {tDetail('detail.remark')}: {request.internalRemark}
                </p>
            )}
            {affordances.triage && (
                <div className="flex flex-wrap gap-tight" role="group" aria-label={tDetail('detail.actions')}>
                    {open && affordances.createItems && <Button variant="primary" text={tDetail('actions.accept')} onClick={() => setDialog('accept')} />}
                    {open && <Button variant="secondary" text={tDetail('actions.decline')} onClick={() => setDialog('decline')} />}
                    {open && <Button variant="secondary" text={tDetail('actions.merge')} onClick={() => setDialog('merge')} />}
                    {open && <Button variant="secondary" text={tDetail('actions.snooze')} onClick={() => setDialog('snooze')} />}
                    {open && <Button variant="ghost" text={tDetail('actions.move')} onClick={() => setDialog('move')} />}
                    {reopenable && <Button variant="secondary" text={tDetail('actions.reopen')} onClick={() => void reopen()} />}
                </div>
            )}
            {dialog && (
                <IntakeDialog
                    kind={dialog}
                    request={request}
                    open
                    onOpenChange={(v) => !v && setDialog(null)}
                    openRequests={openRequests}
                    onDone={(next) => {
                        setDialog(null);
                        toast.success(tDetail(`toast.${dialog}`));
                        onDecided(next);
                    }}
                />
            )}
        </article>
    );
}

export function IntakeView({
    title,
    description,
    projectId,
    affordances,
    back = false,
}: {
    title: string;
    description?: string;
    /** One project's intake; absent is every visible project's. */
    projectId?: string;
    affordances: IntakeAffordances;
    back?: boolean;
}) {
    const t = useTranslations('intake');
    const router = useRouter();
    const pathname = usePathname();
    const search = useSearchParams();
    const tenantHref = useTenantHref();
    const config = useWorkConfig();
    const [view, setView] = useState<View>('new');
    const { data, isLoading, error } = useIntakeRequests(view, projectId);
    const rows = useMemo(() => data?.items ?? [], [data]);
    const selectedId = search.get('request') ?? rows[0]?.id ?? null;
    const selected = useIntakeRequest(selectedId);

    const select = useCallback(
        (id: string | null) => {
            const params = new URLSearchParams(search.toString());
            if (id) params.set('request', id);
            else params.delete('request');
            router.replace(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false });
        },
        [pathname, router, search],
    );

    const onDecided = (next: IntakeRequestDetail) => {
        // A decision leaves the New tab: select the next request there.
        if (next.status !== 'PENDING' && view === 'new') {
            const i = rows.findIndex((r) => r.id === next.id);
            const after = rows[i + 1] ?? rows[i - 1];
            select(after && after.id !== next.id ? after.id : null);
        }
    };

    return (
        <DashboardLayout
            header={{
                title,
                description: description ?? t('description'),
                ...(back ? { back: { smart: true } } : {}),
                actions: (
                    <Link className="text-sm text-content-emphasis underline" href={tenantHref('/forms')}>
                        {t('formsLink')}
                    </Link>
                ),
            }}
            data-testid="intake-page"
        >
            <div className="flex flex-wrap gap-tight" role="group" aria-label={t('views.label')}>
                {INTAKE_VIEWS.map((v) => (
                    <Button
                        key={v}
                        variant={v === view ? 'primary' : 'secondary'}
                        aria-pressed={v === view}
                        text={t(`views.${v}`)}
                        onClick={() => {
                            setView(v);
                            select(null);
                        }}
                    />
                ))}
            </div>
            <div className="grid grid-cols-1 gap-default md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <section aria-labelledby="intake-list-heading" className="min-w-0 space-y-tight">
                    <h2 id="intake-list-heading" className="sr-only">
                        {t(`views.${view}`)}
                    </h2>
                    {error && <p role="alert">{intakeRefusal(error, t('loadFailed'))}</p>}
                    {!error && !isLoading && rows.length === 0 && <p className="text-sm text-content-muted">{t(`empty.${view}`)}</p>}
                    <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle" data-testid="intake-list">
                        {rows.map((r) => {
                            const p = config.projectById.get(r.projectId);
                            const active = r.id === selectedId;
                            return (
                                <li key={r.id}>
                                    <button
                                        type="button"
                                        className={`w-full px-default py-tight text-left ${active ? 'bg-bg-muted' : ''}`}
                                        aria-current={active ? 'true' : undefined}
                                        onClick={() => select(r.id)}
                                    >
                                        <span className="block truncate text-sm font-medium text-content-emphasis">{r.title}</span>
                                        <span className="block text-xs text-content-muted">
                                            {[p?.keyPrefix, r.formName, formatDate(r.createdAt)].filter(Boolean).join(' · ')}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
                <section aria-label={t('detail.label')} className="min-w-0">
                    {selected.data ? (
                        <RequestDetail request={selected.data} affordances={affordances} openRequests={rows.filter((r) => r.status === 'PENDING' || r.status === 'SNOOZED')} onDecided={onDecided} />
                    ) : (
                        <p className="text-sm text-content-muted">{selectedId ? t('detail.loading') : t('detail.none')}</p>
                    )}
                </section>
            </div>
        </DashboardLayout>
    );
}
