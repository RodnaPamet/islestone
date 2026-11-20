/**
 * The in-app (bell) notification types a workspace may mute, for the
 * notification-settings API.
 *
 * A type is listed ONLY when its emitter asks `isInAppTypeEnabled` before it
 * writes (`assignment.ts`, `watcher.ts`, `work-item-due.ts`, `intake.ts`, `mention.ts`), so the API never offers a mute that
 * changes nothing. A new in-app emitter must do both — check the mute list and
 * add its type here — or its type is not listed;
 * `tests/unit/notifications/in-app-types.test.ts` holds the two together.
 *
 * Titles are the emitters' own stored English. A notification's title is
 * written at emit time and stored on the row, so it cannot be translated at
 * render; sub-phase 2.7 decides whether to store keys instead. Until then the
 * catalogue shows the same words the bell does, on purpose.
 *
 * Written for Islestone in place of inflect-compliance's
 * `listInAppNotificationTypes` in `src/app-layer/notifications/agentic.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (Phase 6), deriving from the
 * emitters' copy tables.
 */
import type { NotificationType } from '@prisma/client';

import { ASSIGNMENT_COPY } from './assignment';
import type { AssignmentNotificationKind } from './assignment';
import { WATCHER_NOTIFICATION_TITLE, WATCHER_NOTIFICATION_TYPE } from './watcher';
import { WORK_ITEM_DUE_NOTIFICATION_TITLE, WORK_ITEM_DUE_NOTIFICATION_TYPE } from './work-item-due';
import { INTAKE_NOTIFICATION_COPY, type IntakeNotificationType } from './intake';
import { MENTION_NOTIFICATION_TITLE, MENTION_NOTIFICATION_TYPE } from './mention';

export interface InAppNotificationTypeEntry {
    type: NotificationType;
    title: string;
}

export function listInAppNotificationTypes(): InAppNotificationTypeEntry[] {
    const assignment = (Object.keys(ASSIGNMENT_COPY) as AssignmentNotificationKind[]).map((type) => ({
        type,
        title: ASSIGNMENT_COPY[type].title,
    }));
    return [
        ...assignment,
        { type: WATCHER_NOTIFICATION_TYPE, title: WATCHER_NOTIFICATION_TITLE },
        { type: WORK_ITEM_DUE_NOTIFICATION_TYPE, title: WORK_ITEM_DUE_NOTIFICATION_TITLE },
        { type: MENTION_NOTIFICATION_TYPE, title: MENTION_NOTIFICATION_TITLE },
        ...(Object.keys(INTAKE_NOTIFICATION_COPY) as IntakeNotificationType[]).map((type) => ({
            type,
            title: INTAKE_NOTIFICATION_COPY[type].title,
        })),
    ];
}
