/**
 * Who may see and change the workspace's notification settings (sub-phase
 * 1.6's API, given a page by 2.7c, owner decision 136): the route asks
 * `admin.manage` and the usecase `assertCanAdmin`, so the page offers the
 * settings exactly to a caller holding both. Pages ask this on the server;
 * a component never checks a role or a key.
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';

export function mayManageNotificationSettings(ctx: Pick<RequestContext, 'permissions' | 'appPermissions'>): boolean {
    return ctx.permissions.canAdmin && ctx.appPermissions?.admin?.manage === true;
}
