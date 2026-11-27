/**
 * The `time` domain's gates (decisions 265 and 278; `time.policies.ts`): the
 * key decides, a custom role may grant each, and only a person records.
 */
import type { Role } from '@prisma/client';

import { mayApproveTime, mayTrackTime, mayViewTime, recordsTimeAsPerson, timeAffordances } from '@/app-layer/policies/time.policies';
import { getPermissionsForRole } from '@/lib/permissions';

import { makeRequestContext } from '../../helpers/make-context';

const ctxOf = (role: Role) => makeRequestContext(role, { tenantId: 't1', userId: 'u1' });

describe('time.policies', () => {
    it.each([
        ['OWNER', { view: true, track: true, approve: true, record: true }],
        ['ADMIN', { view: true, track: true, approve: true, record: true }],
        ['MEMBER', { view: true, track: true, approve: false, record: true }],
        ['VIEWER', { view: true, track: false, approve: false, record: false }],
        ['GUEST', { view: false, track: false, approve: false, record: false }],
    ] as const)('%s', (role, expected) => {
        expect(timeAffordances(ctxOf(role))).toEqual(expected);
    });

    it('lets a custom role built on VIEWER record time, and one built on MEMBER lose it (decision 265)', () => {
        const widened = ctxOf('VIEWER');
        widened.appPermissions = getPermissionsForRole('VIEWER');
        widened.appPermissions.time.track = true;
        expect(mayTrackTime(widened)).toBe(true);
        const narrowed = ctxOf('MEMBER');
        narrowed.appPermissions = getPermissionsForRole('MEMBER');
        narrowed.appPermissions.time.view = false;
        expect(mayViewTime(narrowed)).toBe(false);
        expect(mayTrackTime(narrowed)).toBe(true);
        expect(mayApproveTime(narrowed)).toBe(false);
    });

    it('refuses an API key, a job and the system user as a recorder (decision 278)', () => {
        const member = ctxOf('MEMBER');
        expect(recordsTimeAsPerson(member)).toBe(true);
        expect(recordsTimeAsPerson({ ...member, apiKeyId: 'k' })).toBe(false);
        expect(recordsTimeAsPerson({ ...member, actorType: 'JOB' })).toBe(false);
        expect(recordsTimeAsPerson({ ...member, userId: 'sys_t1' })).toBe(false);
        expect(timeAffordances({ ...member, apiKeyId: 'k' })).toMatchObject({ track: true, record: false });
    });
});
