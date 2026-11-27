/**
 * Request schemas for pages (sub-phase 4.1a; docs/pages.md). The usecases
 * sanitise and check what these let through (lengths after sanitising, the
 * tree's rules under the page-tree lock).
 *
 * Written fresh for Islestone.
 */
import { z } from 'zod';

import { PAGE_TITLE_MAX } from '@/lib/pages/types';

const id = z.string().min(1).max(64);

/** Where a page goes among its new siblings: after one, before one, or last. */
const placement = {
    afterId: id.nullish(),
    beforeId: id.nullish(),
};

/** Which tree a read names: `scope=workspace`, or a project. */
export const PageTreeQuerySchema = z
    .object({
        scope: z.enum(['workspace']).optional(),
        projectId: id.optional(),
        parentId: id.optional(),
        after: id.optional(),
    })
    .strict()
    .refine((q) => (q.scope === 'workspace') !== (q.projectId !== undefined), { message: 'Name the workspace or one project.' });

export const DeletedPagesQuerySchema = z
    .object({ scope: z.enum(['workspace']).optional(), projectId: id.optional() })
    .strict()
    .refine((q) => (q.scope === 'workspace') !== (q.projectId !== undefined), { message: 'Name the workspace or one project.' });

export const CreatePageSchema = z
    .object({
        /** null: a workspace page. */
        projectId: id.nullable(),
        parentId: id.nullish(),
        title: z.string().max(PAGE_TITLE_MAX * 2).optional(),
        ...placement,
    })
    .strict();

export const RenamePageSchema = z.object({ title: z.string().max(PAGE_TITLE_MAX * 2) }).strict();

export const MovePageSchema = z
    .object({
        /** The tree it goes to: null the workspace's, else a project's. */
        projectId: id.nullable(),
        /** The new parent in that tree; null: the top level. */
        parentId: id.nullable(),
        ...placement,
    })
    .strict();

export type CreatePageInput = z.infer<typeof CreatePageSchema>;
export type MovePageInput = z.infer<typeof MovePageSchema>;

export const PageSearchQuerySchema = z
    .object({ q: z.string().max(200), scope: z.enum(['workspace']).optional(), projectId: id.optional() })
    .strict()
    .refine((q) => !(q.scope === 'workspace' && q.projectId !== undefined), { message: 'Name the workspace or one project, not both.' });
