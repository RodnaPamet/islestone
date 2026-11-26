/**
 * Who does what with calendar sync (roadmap 3.3b; ADR 0011 §5; owner
 * decisions 234 and 235). Pages ask these on the server; a component never
 * checks a role or a key.
 *
 *   - the workspace's switch and Microsoft 365's admin consent:
 *     `integrations.manage` (Owners and Admins, decision 234);
 *   - connecting, listing and disconnecting one's own calendar:
 *     `work_items.view` (decision 235; Viewers included, as a read-only feed);
 *     a GUEST holds neither until 8.4 (decision 204).
 *
 * Written fresh for Islestone.
 */
import { forbidden } from '@/lib/errors/types';
import { hasPermission } from '@/lib/security/permission-key';

import type { RequestContext } from '../types';

type PermCtx = Pick<RequestContext, 'appPermissions'>;

export function mayManageCalendarSync(ctx: PermCtx): boolean {
    return hasPermission(ctx.appPermissions, 'integrations.manage');
}

export function mayConnectCalendar(ctx: PermCtx): boolean {
    return hasPermission(ctx.appPermissions, 'work_items.view');
}

/** A connection is a read-only feed for a member who may not edit work items (decision 235; read back in 3.3c). */
export function calendarFeedIsReadOnly(ctx: PermCtx): boolean {
    return !hasPermission(ctx.appPermissions, 'work_items.edit');
}

export function assertMayManageCalendarSync(ctx: PermCtx): void {
    if (!mayManageCalendarSync(ctx)) throw forbidden('Managing calendar sync needs the permission to manage integrations.');
}

export function assertMayConnectCalendar(ctx: PermCtx): void {
    if (!mayConnectCalendar(ctx)) throw forbidden('Connecting a calendar needs the permission to see work items.');
}
