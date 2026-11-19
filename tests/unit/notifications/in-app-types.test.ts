/**
 * The in-app type catalogue offers only mutes that do something.
 *
 * `listInAppNotificationTypes()` is what the notification-settings API lists,
 * and a workspace can mute any type it lists. A listed type whose emitter
 * never asks `isInAppTypeEnabled` would be a mute that changes nothing — a
 * setting that reads as working while every bell still rings. So:
 *
 *   1. the catalogue is exactly the emitters' copy tables (assignment's kinds
 *      and the watcher's type), each a real `NotificationType`;
 *   2. every emitter that writes a listed type asks `isInAppTypeEnabled`
 *      BEFORE its `createMany` (behaviourally, in assignment.test.ts and
 *      watcher.test.ts; structurally here, so a new emitter is held to it);
 *   3. the structural check flags a planted emitter that writes first.
 *
 * Written for Islestone (sub-phase 1.6); `in-app-types.ts` replaces
 * inflect-compliance's `agentic.ts` catalogue.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { NotificationType } from '@prisma/client';

import { ASSIGNMENT_COPY } from '@/app-layer/notifications/assignment';
import { listInAppNotificationTypes } from '@/app-layer/notifications/in-app-types';
import { WATCHER_NOTIFICATION_TITLE, WATCHER_NOTIFICATION_TYPE } from '@/app-layer/notifications/watcher';

import { codeOf } from '../../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => codeOf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/** Whether the mute check comes before the first insert in this source. */
function checksMuteBeforeWrite(code: string): boolean {
    const check = code.search(/\bisInAppTypeEnabled\s*\(/);
    const write = code.search(/\.notification\.createMany\s*\(/);
    return check !== -1 && write !== -1 && check < write;
}

describe('the in-app type catalogue', () => {
    it('lists exactly the emitters\' copy, with their stored titles', () => {
        expect(listInAppNotificationTypes()).toEqual([
            ...Object.entries(ASSIGNMENT_COPY).map(([type, copy]) => ({ type, title: copy.title })),
            { type: WATCHER_NOTIFICATION_TYPE, title: WATCHER_NOTIFICATION_TITLE },
        ]);
    });

    it('lists only real NotificationType values, once each, and never GENERAL', () => {
        const types = listInAppNotificationTypes().map((t) => t.type);
        expect(new Set(types).size).toBe(types.length);
        for (const t of types) expect(Object.values(NotificationType)).toContain(t);
        expect(types).not.toContain('GENERAL');
    });

    it('every emitter of a listed type asks isInAppTypeEnabled before it writes', () => {
        for (const file of ['src/app-layer/notifications/assignment.ts', 'src/app-layer/notifications/watcher.ts']) {
            expect({ file, mutesFirst: checksMuteBeforeWrite(read(file)) }).toEqual({ file, mutesFirst: true });
        }
    });

    it('the structural check flags a planted emitter that writes before it checks', () => {
        const planted = codeOf(`
            // isInAppTypeEnabled( is only mentioned here
            await db.notification.createMany({ data: rows });
            await isInAppTypeEnabled(db, tenantId, type);
        `);
        expect(checksMuteBeforeWrite(planted)).toBe(false);
        expect(checksMuteBeforeWrite(codeOf('await db.notification.createMany({ data });'))).toBe(false);
    });
});
