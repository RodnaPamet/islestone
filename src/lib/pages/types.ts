/**
 * Client-safe shapes and limits of pages (sub-phase 4.1a; docs/pages.md;
 * ADR 0015 §1). The routes answer these; the pages and the data hook read
 * them. Never a page's content: the body is 4.1b's, read through its own
 * projections.
 *
 * Written fresh for Islestone.
 */

/** A page title's length (decision 343; CHECK `Page_title_length`). */
export const PAGE_TITLE_MAX = 200;
/** The title a create gets when it names none. */
export const PAGE_DEFAULT_TITLE = 'Untitled';
/** Pages nest at most ten levels (decision 341); `MAX_PAGE_DEPTH` in the domain. */
export const PAGE_MAX_DEPTH = 10;
/** Children one tree read returns at once; the next page through `after`. */
export const PAGE_CHILDREN_PAGE = 200;

/** Which tree a page is in: a project's, or the workspace's (decision 341). */
export type PageScope = { kind: 'workspace' } | { kind: 'project'; projectId: string; keyPrefix: string; name: string; archived: boolean };

/** A page as the tree, the header and the routes show it. */
export interface PageData {
    id: string;
    /** NULL: a workspace page. */
    projectId: string | null;
    parentId: string | null;
    title: string;
    /** The row's title and placement; a rename names it (`If-Match`). */
    version: number;
    createdByUserId: string;
    createdAt: string;
    updatedAt: string;
    /** When the body was last stored (4.1b); null until then. */
    contentUpdatedAt: string | null;
}

/** A page in a tree read: its live subpages counted, so the tree knows whether to offer "Expand". */
export interface PageNode extends PageData {
    childCount: number;
}

/** One tree read: a parent's live children in order, and the next page's cursor. */
export interface PageChildren {
    pages: PageNode[];
    /** The id to pass as `after` for the next page; null when this was the last. */
    nextAfter: string | null;
}

/** An ancestor on the breadcrumb, root first. */
export interface PageCrumb {
    id: string;
    title: string;
}

/** What the server lets the caller do on a page or in a tree (`pageAffordances`, decision 339). */
export interface PageAffordances {
    view: boolean;
    /** Create a page in this tree (and a subpage, while it fits). */
    create: boolean;
    /** Rename, move and reorder. */
    edit: boolean;
    /** Delete, restore and read the Deleted list. */
    delete: boolean;
}

/** A page's own view: the row, its tree, its ancestors and its subpages. */
export interface PageDetail {
    page: PageData;
    scope: PageScope;
    ancestors: PageCrumb[];
    /** Its level in the tree: 1 for a top-level page. */
    level: number;
    /** Whether a subpage still fits under it (decision 341). */
    subpageFits: boolean;
    children: PageChildren;
    affordances: PageAffordances;
}

/** A deleted page in the Deleted list: only a group's root restores it. */
export interface DeletedPageData {
    id: string;
    projectId: string | null;
    parentId: string | null;
    title: string;
    deletedAt: string;
    deletedByUserId: string | null;
    deletionId: string;
    /** Pages deleted with it, itself included. */
    groupSize: number;
}

/** A tree, as the client names it: the workspace's, or a project's. */
export type PageTreeKey = { kind: 'workspace' } | { kind: 'project'; projectId: string };

/** A tree a page may move to, as the server offered it (the move dialog). */
export interface PageTreeOption {
    key: PageTreeKey;
    label: string;
}
