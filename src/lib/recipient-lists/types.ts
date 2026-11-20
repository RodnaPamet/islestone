/**
 * Recipient lists' client-safe shapes and limits (sub-phase 2.7e;
 * docs/porting/maps/2.7.md, part 6; owner decisions 138 to 142). A recipient
 * list is a named set of people to notify (ADR 0006 "Recipient list"): a
 * workspace list (`projectId` null) or one project's.
 *
 * Written fresh for Islestone.
 */

/** A list name's longest length, after sanitising (CHECKed in the migration). */
export const RECIPIENT_LIST_NAME_MAX = 80;
/** A list description's longest length (CHECKed in the migration). */
export const RECIPIENT_LIST_DESCRIPTION_MAX = 500;
/** The most people one list holds (as a notify list, 2.6a). */
export const RECIPIENT_LIST_MEMBERS_MAX = 500;

export interface RecipientListData {
    id: string;
    /** `null`: a workspace list. */
    projectId: string | null;
    name: string;
    description: string | null;
    archived: boolean;
    /** The people on the list, as stored (an ACTIVE member when added). */
    memberUserIds: string[];
    createdAt: string;
    updatedAt: string;
}

/** What the server offers a viewer, asked from the same predicates the usecases assert. */
export interface RecipientListAffordances {
    /** Create, rename, change, archive and restore workspace lists (`admin.manage`). */
    manageWorkspaceLists: boolean;
    /** Create, rename, change, archive and restore a project's lists (`projects.edit`). */
    manageProjectLists: boolean;
}

/** The outcome of adding a list to an item's watchers (decision 139: a copy). */
export interface RecipientListWatchersResult {
    listId: string;
    /** The people who now watch the item and did not before. */
    added: string[];
    /** The list's people who already watched it. */
    alreadyWatching: string[];
    /** How many of the list's people were left out: not active, or unable to see the item. */
    skipped: number;
}

/** A workspace list's API path (tenant-relative). */
export function workspaceListsPath(): string {
    return '/recipient-lists';
}

/** A project's lists' API path (tenant-relative). */
export function projectListsPath(projectId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/recipient-lists`;
}

/** The API path of one list, under its own scope. */
export function recipientListPath(list: Pick<RecipientListData, 'id' | 'projectId'>): string {
    const base = list.projectId ? projectListsPath(list.projectId) : workspaceListsPath();
    return `${base}/${encodeURIComponent(list.id)}`;
}
