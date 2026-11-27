/**
 * The workload gates (sub-phase 3.5a; decisions 287, 288 and 298): who views,
 * records their own time off, manages, and reads a time-off type.
 */
import { actsOnWorkloadAsPerson, mayManageWorkload, mayReadTimeOffType, mayRecordOwnTimeOff, mayViewWorkload, workloadAffordances } from '@/app-layer/policies/workload.policies';
import type { RequestContext } from '@/app-layer/types';
import { getPermissionsForRole } from '@/lib/permissions';

import { makeRequestContext } from '../../helpers/make-context';

const ctx = (role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST', extra: Partial<RequestContext> = {}) =>
    ({ ...makeRequestContext(role, { userId: 'me', tenantId: 't' }), ...extra }) as RequestContext;

describe('the workload gates', () => {
    it.each([
        ['OWNER', true, true, true],
        ['ADMIN', true, true, true],
        ['MEMBER', true, true, false],
        ['VIEWER', true, true, false],
        ['GUEST', false, false, false],
    ] as const)('%s: view %s, own time off %s, manage %s', (role, view, own, manage) => {
        expect(mayViewWorkload(ctx(role))).toBe(view);
        expect(mayRecordOwnTimeOff(ctx(role))).toBe(own);
        expect(mayManageWorkload(ctx(role))).toBe(manage);
    });

    it('reads the granular key, so a custom role may grant manage to a Viewer', () => {
        const grants = getPermissionsForRole('VIEWER');
        grants.workload.manage = true;
        expect(mayManageWorkload(ctx('VIEWER', { appPermissions: grants }))).toBe(true);
    });

    it('shows a type only to the person and to workload.manage, signed in', () => {
        expect(mayReadTimeOffType(ctx('VIEWER'), 'me')).toBe(true);
        expect(mayReadTimeOffType(ctx('VIEWER'), 'ann')).toBe(false);
        expect(mayReadTimeOffType(ctx('ADMIN'), 'ann')).toBe(true);
        expect(mayReadTimeOffType(ctx('ADMIN', { apiKeyId: 'k' }), 'ann')).toBe(false);
        expect(mayReadTimeOffType(ctx('MEMBER', { apiKeyId: 'k' }), 'me')).toBe(false);
        expect(mayReadTimeOffType(ctx('OWNER', { actorType: 'JOB' } as Partial<RequestContext>), 'ann')).toBe(false);
    });

    it('offers no write to a key, a job or the system user', () => {
        expect(actsOnWorkloadAsPerson(ctx('OWNER', { apiKeyId: 'k' }))).toBe(false);
        expect(actsOnWorkloadAsPerson(ctx('OWNER', { actorType: 'JOB' } as Partial<RequestContext>))).toBe(false);
        expect(workloadAffordances(ctx('OWNER', { apiKeyId: 'k' }))).toEqual({ view: true, recordOwnTimeOff: false, manage: false });
        expect(workloadAffordances(ctx('MEMBER'))).toEqual({ view: true, recordOwnTimeOff: true, manage: false });
    });
});
