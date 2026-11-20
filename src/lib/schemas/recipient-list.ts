/**
 * Request schemas for recipient lists (sub-phase 2.7e; owner decisions 138 to
 * 142). The usecases sanitise and re-check every value; these bound the
 * request.
 */
import { z } from 'zod';

import { RECIPIENT_LIST_DESCRIPTION_MAX, RECIPIENT_LIST_MEMBERS_MAX, RECIPIENT_LIST_NAME_MAX } from '@/lib/recipient-lists/types';

const Id = z.string().min(1).max(64);
const Name = z.string().min(1).max(RECIPIENT_LIST_NAME_MAX);
const Description = z.string().max(RECIPIENT_LIST_DESCRIPTION_MAX);
const UserIds = z.array(Id).max(RECIPIENT_LIST_MEMBERS_MAX);

export const CreateRecipientListSchema = z
    .object({
        name: Name,
        description: Description.nullish(),
        /** The people on the list from the start; each an ACTIVE member. */
        userIds: UserIds.optional(),
    })
    .strict();

export const UpdateRecipientListSchema = z
    .object({
        name: Name.optional(),
        description: Description.nullable().optional(),
    })
    .strict()
    .refine((b) => b.name !== undefined || b.description !== undefined, 'Give a name or a description to change.');

/** PUT: the whole set of people. */
export const SetRecipientListMembersSchema = z.object({ userIds: UserIds }).strict();

/** PATCH: people to add and to remove, so two people editing one list never undo each other. */
export const ChangeRecipientListMembersSchema = z
    .object({ add: UserIds.optional(), remove: UserIds.optional() })
    .strict()
    .refine((b) => (b.add?.length ?? 0) + (b.remove?.length ?? 0) > 0, 'Name someone to add or to remove.');

/** `GET /recipient-lists`: the workspace's lists, or the lists usable on one project's items, or on any project's. */
export const ListRecipientListsQuerySchema = z
    .object({
        projectId: Id.optional(),
        usable: z.enum(['1']).optional(),
        includeArchived: z.enum(['1']).optional(),
    });

export const ListProjectRecipientListsQuerySchema = z.object({ includeArchived: z.enum(['1']).optional() });

/** `POST /work-items/:id/watchers/recipient-list`: copy a list's people onto the item's watchers. */
export const AddRecipientListWatchersSchema = z.object({ listId: Id }).strict();
