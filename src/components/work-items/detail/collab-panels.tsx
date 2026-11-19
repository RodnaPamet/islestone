'use client';

/**
 * The detail's collaboration sections: comments, activity, relations,
 * links and watchers. Each reads its own SWR key under the item (shared by
 * the full page and the sheet) and writes through `useWorkItemCollab`, so
 * every write is optimistic and every removal goes through the undo toast.
 *
 * Comments follow the owner's rule (decision 53): only the author edits; the
 * author or a workspace admin deletes. The buttons ask the SAME functions the
 * server asks (`mayEditComment`, `commentDeleteBasis` in
 * `src/app-layer/policies/comment.policies.ts`), so the page offers exactly
 * what the server allows.
 *
 * The comment and activity lists follow inflect-compliance's task detail
 * page (lines 1586–1678) and `PanelActivityFeed.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e; written fresh here.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { formatDateTime } from '@inflect/ui/lib/format-date';
import { commentDeleteBasis, mayEditComment } from '@/app-layer/policies/comment.policies';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useCurrentUserId, usePermissions, useTenantContext } from '@/lib/tenant-context-provider';
import type { ActivityEntryRow, RelationRow } from '@/lib/work-items/types';

import { memberLabel, useMembers, useWorkConfig } from '../data/use-work-config';
import {
    itemPaths,
    useWorkItemCollab,
    useWorkItemComments,
    useWorkItemLinks,
    useWorkItemRelations,
    useWorkItemWatchers,
} from '../data/use-work-item-collab';
import { AssigneePicker } from '../pickers';
import { WorkItemPicker } from '../WorkItemPicker';
import { activityPhraseKey } from './activity-phrases';

function useMemberName() {
    const tName = useTranslations('workItems');
    const { byId } = useMembers();
    return (userId: string | null) => (userId ? memberLabel(byId.get(userId)) ?? tName('detail.formerMember') : tName('detail.system'));
}

// ─── Comments ─────────────────────────────────────────────────────────────

export function CommentsPanel({ workItemId }: { workItemId: string }) {
    const tComments = useTranslations('workItems');
    const { data, error } = useWorkItemComments(workItemId);
    const collab = useWorkItemCollab(workItemId);
    const perms = usePermissions();
    const { userId, permissions } = useTenantContext();
    const nameOf = useMemberName();
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

    const canComment = perms.work_items.comment === true;

    const submit = async () => {
        const body = draft.trim();
        if (!body) return;
        // The text stays in the box until the server accepts it.
        const ok = await collab.addComment(body, userId);
        if (ok) setDraft('');
    };

    return (
        <section aria-labelledby={`comments-${workItemId}`} className="space-y-default">
            <h3 id={`comments-${workItemId}`} className="text-sm font-semibold text-content-emphasis">
                {tComments('detail.comments')}
            </h3>
            {canComment && (
                <div className="space-y-tight">
                    <Textarea aria-label={tComments('detail.newComment')} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
                    <Button variant="secondary" onClick={submit} disabled={!draft.trim()} text={tComments('detail.addComment')} />
                </div>
            )}
            {error && <p role="alert">{tComments('detail.loadFailed')}</p>}
            <ul className="space-y-default" aria-label={tComments('detail.comments')}>
                {(data?.items ?? []).map((c) => {
                    const mayEdit = mayEditComment({ userId }, c);
                    const deleteBasis = commentDeleteBasis({ userId, permissions }, c);
                    const isEditing = editing?.id === c.id;
                    return (
                        <li key={c.id} className="rounded-md border border-border-subtle p-3">
                            <p className="text-xs text-content-muted">
                                {nameOf(c.authorUserId)} · {formatDateTime(c.createdAt)}
                                {c.editedAt ? ` · ${tComments('detail.edited')}` : ''}
                            </p>
                            {isEditing ? (
                                <div className="mt-2 space-y-tight">
                                    <Textarea
                                        aria-label={tComments('detail.editComment')}
                                        value={editing.body}
                                        onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                                        rows={3}
                                    />
                                    <div className="flex gap-tight">
                                        <Button
                                            variant="secondary"
                                            text={tComments('detail.saveComment')}
                                            disabled={!editing.body.trim()}
                                            onClick={async () => {
                                                const ok = await collab.editComment(c.id, editing.body.trim());
                                                if (ok) setEditing(null);
                                            }}
                                        />
                                        <Button variant="ghost" text={tComments('detail.cancel')} onClick={() => setEditing(null)} />
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-1 whitespace-pre-wrap text-sm text-content-default">{c.body}</p>
                            )}
                            {!isEditing && (mayEdit || deleteBasis) && (
                                <div className="mt-2 flex gap-tight">
                                    {mayEdit && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            text={tComments('detail.edit')}
                                            aria-label={tComments('detail.editCommentBy', { name: nameOf(c.authorUserId) })}
                                            onClick={() => setEditing({ id: c.id, body: c.body })}
                                        />
                                    )}
                                    {deleteBasis && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            text={tComments('detail.delete')}
                                            aria-label={tComments('detail.deleteCommentBy', { name: nameOf(c.authorUserId) })}
                                            onClick={() => collab.deleteComment(c.id)}
                                        />
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
            {data && data.items.length === 0 && <p className="text-sm text-content-muted">{tComments('detail.noComments')}</p>}
        </section>
    );
}

// ─── Activity ─────────────────────────────────────────────────────────────

export function ActivityPanel({ workItemId }: { workItemId: string }) {
    const tActivity = useTranslations('workItems');
    const config = useWorkConfig();
    const nameOf = useMemberName();
    const { data, error } = useTenantSWR<{ items: ActivityEntryRow[] }>(itemPaths(workItemId).activity);
    const stateName = (id: unknown) => (typeof id === 'string' ? config.stateById.get(id)?.name : undefined);
    return (
        <section aria-labelledby={`activity-${workItemId}`} className="space-y-default">
            <h3 id={`activity-${workItemId}`} className="text-sm font-semibold text-content-emphasis">
                {tActivity('detail.activity')}
            </h3>
            {error && <p role="alert">{tActivity('detail.loadFailed')}</p>}
            <ol className="space-y-tight" aria-label={tActivity('detail.activity')}>
                {(data?.items ?? []).map((e) => {
                    const details = (e.detailsJson ?? {}) as { fromStateId?: unknown; toStateId?: unknown };
                    const from = stateName(details.fromStateId);
                    const to = stateName(details.toStateId);
                    const phrase =
                        e.kind === 'comment'
                            ? tActivity('activity.commented')
                            : e.action === 'WORK_ITEM_STATE_CHANGED' && from && to
                              ? tActivity('activity.stateChangedFromTo', { from, to })
                              : tActivity(activityPhraseKey(e.action));
                    return (
                        <li key={`${e.kind}-${e.id}`} className="text-sm text-content-default">
                            <span className="font-medium">{nameOf(e.actorUserId)}</span> {phrase}
                            <span className="text-content-muted"> · {formatDateTime(e.createdAt)}</span>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

// ─── Relations ────────────────────────────────────────────────────────────

const RELATION_CHOICES = ['BLOCKS', 'BLOCKED_BY', 'RELATES', 'DUPLICATES'] as const;
type RelationChoice = (typeof RELATION_CHOICES)[number];

export function relationLabelKey(row: RelationRow, direction: 'outgoing' | 'incoming'): string {
    if (row.type === 'RELATES') return 'relation.relatesTo';
    if (row.type === 'BLOCKS') return direction === 'outgoing' ? 'relation.blocks' : 'relation.blockedBy';
    return direction === 'outgoing' ? 'relation.duplicates' : 'relation.duplicatedBy';
}

export function RelationsPanel({ workItemId, canEdit }: { workItemId: string; canEdit: boolean }) {
    const tRelations = useTranslations('workItems');
    const { data } = useWorkItemRelations(workItemId);
    const collab = useWorkItemCollab(workItemId);
    const [choice, setChoice] = useState<RelationChoice>('BLOCKS');
    const [other, setOther] = useState<{ id: string; label: string } | null>(null);
    const choiceOptions: ComboboxOption[] = RELATION_CHOICES.map((c) => ({ value: c, label: tRelations(`relation.choice.${c}`) }));

    const rows = [
        ...(data?.outgoing ?? []).map((r) => ({ row: r, direction: 'outgoing' as const })),
        ...(data?.incoming ?? []).map((r) => ({ row: r, direction: 'incoming' as const })),
    ];

    const add = async () => {
        if (!other) return;
        // "Blocked by X" is X blocks this: the relation is written from X.
        // "Blocked by X" is stored as "X blocks this item".
        const ok = choice === 'BLOCKED_BY' ? await collab.addBlockedBy(other.id) : await collab.addRelation(choice, other.id);
        if (ok) setOther(null);
    };

    return (
        <section aria-labelledby={`relations-${workItemId}`} className="space-y-default">
            <h3 id={`relations-${workItemId}`} className="text-sm font-semibold text-content-emphasis">
                {tRelations('detail.relations')}
            </h3>
            <ul className="space-y-tight" aria-label={tRelations('detail.relations')}>
                {rows.map(({ row, direction }) => (
                    <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>
                            <span className="text-content-muted">{tRelations(relationLabelKey(row, direction))}</span>{' '}
                            {row.item.hidden ? tRelations('detail.hiddenItem') : `${row.item.key} ${row.item.title}`}
                        </span>
                        {canEdit && (
                            <Button
                                variant="ghost"
                                size="sm"
                                text={tRelations('detail.remove')}
                                aria-label={tRelations('detail.removeRelation', { key: row.item.key ?? '' })}
                                onClick={() => collab.removeRelation(row.id)}
                            />
                        )}
                    </li>
                ))}
            </ul>
            {data && rows.length === 0 && <p className="text-sm text-content-muted">{tRelations('detail.noRelations')}</p>}
            {canEdit && (
                <div className="flex flex-wrap items-center gap-tight">
                    <Combobox
                        selected={choiceOptions.find((o) => o.value === choice) ?? null}
                        setSelected={(o) => o && setChoice(o.value as RelationChoice)}
                        options={choiceOptions}
                        hideSearch
                        caret
                        buttonProps={{ 'aria-label': tRelations('detail.relationType') }}
                    />
                    <WorkItemPicker excludeId={workItemId} value={other} onChange={setOther} label={tRelations('detail.relatedItem')} />
                    <Button variant="secondary" text={tRelations('detail.addRelation')} disabled={!other} onClick={add} />
                </div>
            )}
        </section>
    );
}

// ─── Links ────────────────────────────────────────────────────────────────

export function LinksPanel({ workItemId, canEdit }: { workItemId: string; canEdit: boolean }) {
    const tLinks = useTranslations('workItems');
    const { data } = useWorkItemLinks(workItemId);
    const collab = useWorkItemCollab(workItemId);
    const [location, setLocation] = useState('');
    const [title, setTitle] = useState('');
    const add = async () => {
        const url = location.trim();
        if (!url) return;
        const ok = await collab.addLink(url, title.trim() || null);
        if (ok) {
            setLocation('');
            setTitle('');
        }
    };
    return (
        <section aria-labelledby={`links-${workItemId}`} className="space-y-default">
            <h3 id={`links-${workItemId}`} className="text-sm font-semibold text-content-emphasis">
                {tLinks('detail.links')}
            </h3>
            <ul className="space-y-tight" aria-label={tLinks('detail.links')}>
                {(data ?? []).map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                        <a href={l.location} target="_blank" rel="noopener noreferrer nofollow" className="text-content-info underline">
                            {l.title || l.location}
                        </a>
                        {canEdit && (
                            <Button
                                variant="ghost"
                                size="sm"
                                text={tLinks('detail.remove')}
                                aria-label={tLinks('detail.removeLink', { name: l.title || l.location })}
                                onClick={() => collab.removeLink(l.id)}
                            />
                        )}
                    </li>
                ))}
            </ul>
            {data && data.length === 0 && <p className="text-sm text-content-muted">{tLinks('detail.noLinks')}</p>}
            {canEdit && (
                <div className="flex flex-wrap items-center gap-tight">
                    <Input aria-label={tLinks('detail.linkUrl')} placeholder={tLinks('detail.linkUrlPlaceholder')} value={location} onChange={(e) => setLocation(e.target.value)} />
                    <Input aria-label={tLinks('detail.linkTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
                    <Button variant="secondary" text={tLinks('detail.addLink')} disabled={!location.trim()} onClick={add} />
                </div>
            )}
        </section>
    );
}

// ─── Watchers ─────────────────────────────────────────────────────────────

export function WatchersPanel({ workItemId }: { workItemId: string }) {
    const tWatchers = useTranslations('workItems');
    const me = useCurrentUserId();
    const perms = usePermissions();
    const nameOf = useMemberName();
    const { data } = useWorkItemWatchers(workItemId);
    const collab = useWorkItemCollab(workItemId);
    const watching = (data ?? []).some((w) => w.userId === me);
    // Adding or removing someone else is the assign key's (2.2's split route).
    const canManageOthers = perms.work_items.assign === true;
    return (
        <section aria-labelledby={`watchers-${workItemId}`} className="space-y-tight">
            <h3 id={`watchers-${workItemId}`} className="text-sm font-semibold text-content-emphasis">
                {tWatchers('detail.watchers')}
            </h3>
            <ul className="space-y-tight" aria-label={tWatchers('detail.watchers')}>
                {(data ?? []).map((w) => (
                    <li key={w.userId} className="flex items-center justify-between gap-2 text-sm">
                        <span>{nameOf(w.userId)}</span>
                        {(w.userId === me || canManageOthers) && (
                            <Button
                                variant="ghost"
                                size="sm"
                                text={tWatchers('detail.remove')}
                                aria-label={tWatchers('detail.removeWatcher', { name: nameOf(w.userId) })}
                                onClick={() => collab.removeWatcher(w.userId, w.userId === me)}
                            />
                        )}
                    </li>
                ))}
            </ul>
            <div className="flex flex-wrap items-center gap-tight">
                {!watching && <Button variant="secondary" size="sm" text={tWatchers('detail.watch')} onClick={() => collab.watch(me, true)} />}
                {canManageOthers && (
                    <AssigneePicker
                        label={tWatchers('detail.addWatcher')}
                        value={null}
                        onChange={(userId) => userId && collab.watch(userId, userId === me)}
                    />
                )}
            </div>
        </section>
    );
}
