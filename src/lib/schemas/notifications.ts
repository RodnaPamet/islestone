/**
 * Zod schemas for the Inbox's and the preferences' routes (sub-phase 2.7c).
 *
 * Written fresh for Islestone.
 */
import { EmailDelivery, NotificationType } from '@prisma/client';
import { z } from 'zod';

import { INBOX_VIEWS } from '@/lib/notifications/inbox';
import { PREFERENCE_TYPES } from '@/lib/notifications/preferences';

/** `GET /notifications?view=&type=&cursor=&limit=`. Without `view` the route answers the bell's list. */
export const InboxQuerySchema = z
    .object({
        view: z.enum(INBOX_VIEWS),
        type: z.enum(NotificationType).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().max(1000).optional(),
    })
    .strict();
export type InboxQuery = z.infer<typeof InboxQuerySchema>;

/** `PATCH /notifications/:id`. */
export const NotificationChangeSchema = z
    .object({ read: z.boolean().optional(), done: z.boolean().optional() })
    .strict()
    .refine((v) => v.read !== undefined || v.done !== undefined, { message: 'Name read or done.' });
export type NotificationChange = z.infer<typeof NotificationChangeSchema>;

/** `POST /notifications/bulk`: mark every unread row read, or change named rows. */
export const NotificationBulkSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('mark-all-read') }).strict(),
    z
        .object({
            action: z.literal('update'),
            ids: z.array(z.string().min(1).max(64)).min(1).max(200),
            read: z.boolean().optional(),
            done: z.boolean().optional(),
        })
        .strict()
        .refine((v) => v.read !== undefined || v.done !== undefined, { message: 'Name read or done.' }),
]);
export type NotificationBulk = z.infer<typeof NotificationBulkSchema>;

/** `PUT /notification-preferences`: the rows to change; `reset` returns a type to its default. */
export const UpdatePreferencesSchema = z
    .object({
        rows: z
            .array(
                z.union([
                    z.object({ type: z.enum(PREFERENCE_TYPES), inApp: z.boolean(), email: z.enum(EmailDelivery) }).strict(),
                    z.object({ type: z.enum(PREFERENCE_TYPES), reset: z.literal(true) }).strict(),
                ]),
            )
            .min(1)
            .max(PREFERENCE_TYPES.length),
    })
    .strict();
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesSchema>;
