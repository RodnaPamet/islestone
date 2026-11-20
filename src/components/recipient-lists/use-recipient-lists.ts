'use client';

/**
 * Recipient lists' reads and writes (sub-phase 2.7e). Reads go through the
 * tenant SWR cache at the routes' own paths, so a write revalidates exactly
 * the list it changed; writes go through `apiSend`. Removing a person from a
 * list goes through the undo toast (`tests/guards/undo-toast-coverage.test.ts`
 * lists this file): the person leaves the list at once and the change is sent
 * when the window closes. Archiving is not a delete (decision 141) and is
 * sent at once; restore brings the list back.
 *
 * Nothing here decides who may write: the pages receive the affordances,
 * asked on the server.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { useSWRConfig } from 'swr';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { projectListsPath, recipientListPath, workspaceListsPath, type RecipientListData } from '@/lib/recipient-lists/types';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

/** Whose lists a page shows. */
export type RecipientListOwner = { kind: 'workspace' } | { kind: 'project'; projectId: string };

/** The tenant-relative path a scope's lists (archived included) are read from. */
export function ownerListsPath(owner: RecipientListOwner): string {
    return `${owner.kind === 'workspace' ? workspaceListsPath() : projectListsPath(owner.projectId)}?includeArchived=1`;
}

/** The lists of one scope, archived included. */
export function useRecipientLists(owner: RecipientListOwner) {
    return useTenantSWR<RecipientListData[]>(ownerListsPath(owner));
}

/** The live lists usable on a project's items (the workspace's and the project's): the watchers panel's picker. */
export function useUsableRecipientLists(projectId: string | null) {
    return useTenantSWR<RecipientListData[]>(projectId ? `${workspaceListsPath()}?projectId=${encodeURIComponent(projectId)}` : null);
}

/** The workspace's live lists (a type's default review steps name only these, 2.8c). */
export function useWorkspaceRecipientLists(enabled = true) {
    return useTenantSWR<RecipientListData[]>(enabled ? workspaceListsPath() : null);
}

/** The live lists usable on any visible project's items: Settings → Intake's pickers. */
export function useAllUsableRecipientLists(enabled = true) {
    return useTenantSWR<RecipientListData[]>(enabled ? `${workspaceListsPath()}?usable=1` : null);
}

/** The refusal a person reads: the server's sentence, or `fallback`. */
export function listRefusal(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

export function useRecipientListWrites(owner: RecipientListOwner) {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('recipientLists');
    const listsPath = ownerListsPath(owner);
    const base = owner.kind === 'workspace' ? workspaceListsPath() : projectListsPath(owner.projectId);

    const revalidate = useCallback(() => mutate(apiUrl(listsPath)), [mutate, apiUrl, listsPath]);
    const setLists = useCallback(
        (update: (lists: RecipientListData[] | undefined) => RecipientListData[] | undefined) =>
            mutate<RecipientListData[]>(apiUrl(listsPath), (current) => update(current), { revalidate: false }),
        [mutate, apiUrl, listsPath],
    );

    const removeMember = useCallback(
        (list: RecipientListData, userId: string, name: string) => {
            let before: RecipientListData[] | undefined;
            void setLists((lists) => {
                before = lists;
                return lists?.map((l) => (l.id === list.id ? { ...l, memberUserIds: l.memberUserIds.filter((id) => id !== userId) } : l));
            });
            triggerUndo({
                message: t('memberRemoved', { name, list: list.name }),
                undoMessage: t('undo'),
                action: () => apiSend('PATCH', apiUrl(`${recipientListPath(list)}/members`), { remove: [userId] }),
                undoAction: () => {
                    void setLists(() => before);
                },
                onCommit: () => {
                    void revalidate();
                },
                onError: (err) => {
                    void setLists(() => before).then(() => revalidate());
                    toast.error(listRefusal(err, t('failed')));
                },
            });
        },
        [setLists, triggerUndo, t, apiUrl, revalidate, toast],
    );

    return useMemo(
        () => ({
            /** Create a list; answers the refusal to show, or `null`. */
            async create(input: { name: string; description: string | null }): Promise<string | null> {
                try {
                    await apiSend('POST', apiUrl(base), input);
                    await revalidate();
                    return null;
                } catch (err) {
                    return listRefusal(err, t('failed'));
                }
            },
            async update(list: RecipientListData, input: { name: string; description: string | null }): Promise<string | null> {
                try {
                    await apiSend('PATCH', apiUrl(recipientListPath(list)), input);
                    await revalidate();
                    return null;
                } catch (err) {
                    return listRefusal(err, t('failed'));
                }
            },
            async addMembers(list: RecipientListData, userIds: string[]) {
                try {
                    await apiSend('PATCH', apiUrl(`${recipientListPath(list)}/members`), { add: userIds });
                } catch (err) {
                    toast.error(listRefusal(err, t('failed')));
                }
                await revalidate();
            },
            removeMember,
            async setArchived(list: RecipientListData, archived: boolean) {
                try {
                    await apiSend('POST', apiUrl(`${recipientListPath(list)}/${archived ? 'archive' : 'restore'}`));
                    toast.success(archived ? t('archived', { name: list.name }) : t('restored', { name: list.name }));
                } catch (err) {
                    toast.error(listRefusal(err, t('failed')));
                }
                await revalidate();
            },
        }),
        [apiUrl, base, revalidate, t, toast, removeMember],
    );
}
