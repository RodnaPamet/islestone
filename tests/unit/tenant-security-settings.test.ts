/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks mirroring
 * runtime contracts; the file-level disable is the codebase's standard pattern
 * for Prisma/context shims. */

/**
 * Unit coverage for the TenantSecuritySettings WRITE path.
 *
 * The invariants worth pinning here are the ones whose failure modes are
 * silent:
 *
 *   1. PATCH SEMANTICS — an absent key must not be written. This is what keeps
 *      this writer from clobbering `updateTenantMfaPolicy`, which upserts the
 *      SAME ROW and unconditionally writes `sessionMaxAgeMinutes`.
 *   2. mfaPolicy is never authored by this path.
 *   3. A stored 0 would read as UNLIMITED in the session tracker, so the
 *      write refuses it.
 *
 * Islestone keeps two of the parent's fields (sub-phase 1.4); the audit
 * stream, residency, recertification, key-rotation and turn-cap suites of the
 * inflect-compliance file left with their fields.
 */

const mockDb = {
    tenantSecuritySettings: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
    },
};

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: any, fn: (db: any) => any) => fn(mockDb)),
}));

const mockLogEvent = jest.fn().mockResolvedValue(undefined);
jest.mock('@/app-layer/events/audit', () => ({
    logEvent: (...a: unknown[]) => mockLogEvent(...a),
}));

import {
    getTenantSecurityConfig,
    updateTenantSecurityConfig,
} from '@/app-layer/usecases/tenant-security-settings';
import { getPermissionsForRole } from '@/lib/permissions';
import { UpdateTenantSecuritySettingsInput } from '@/app-layer/schemas/tenant-security-settings.schemas';

function ctxFor(role: 'ADMIN' | 'MEMBER' | 'VIEWER'): any {
    return {
        requestId: 'r-1',
        userId: 'u-1',
        tenantId: 'tenant-1',
        role,
        permissions: {},
        appPermissions: getPermissionsForRole(role),
    };
}

const adminCtx = ctxFor('ADMIN');

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.tenantSecuritySettings.findUnique.mockReset();
    mockDb.tenantSecuritySettings.upsert.mockReset();
    mockLogEvent.mockClear();
    mockDb.tenantSecuritySettings.findUnique.mockResolvedValue(null);
    mockDb.tenantSecuritySettings.upsert.mockResolvedValue({});
});

// ─── Authorization ──────────────────────────────────────────────────

describe('authorization', () => {
    it.each(['MEMBER', 'VIEWER'] as const)('denies %s on read', async (role) => {
        await expect(getTenantSecurityConfig(ctxFor(role))).rejects.toThrow(/ADMIN|OWNER/);
    });

    it.each(['MEMBER', 'VIEWER'] as const)('denies %s on write', async (role) => {
        await expect(
            updateTenantSecurityConfig(ctxFor(role), { mfaFailClosed: true }),
        ).rejects.toThrow(/ADMIN|OWNER/);
        expect(mockDb.tenantSecuritySettings.upsert).not.toHaveBeenCalled();
    });
});

// ─── Patch semantics (the clobber guard) ────────────────────────────

describe('patch semantics', () => {
    it('writes ONLY the keys present in the patch', async () => {
        await updateTenantSecurityConfig(adminCtx, { maxConcurrentSessions: 5 });

        const args = mockDb.tenantSecuritySettings.upsert.mock.calls[0][0];
        expect(Object.keys(args.update)).toEqual(['maxConcurrentSessions']);
        expect(args.update.maxConcurrentSessions).toBe(5);
    });

    it('never authors mfaPolicy or sessionMaxAgeMinutes — the MFA route owns those', async () => {
        await updateTenantSecurityConfig(adminCtx, {
            maxConcurrentSessions: 3,
            mfaFailClosed: true,
        });

        const args = mockDb.tenantSecuritySettings.upsert.mock.calls[0][0];
        for (const shape of [args.update, args.create]) {
            expect(shape).not.toHaveProperty('mfaPolicy');
            expect(shape).not.toHaveProperty('sessionMaxAgeMinutes');
        }
    });

    it('an explicit null CLEARS, and is distinguishable from an absent key', async () => {
        await updateTenantSecurityConfig(adminCtx, { maxConcurrentSessions: null });
        const args = mockDb.tenantSecuritySettings.upsert.mock.calls[0][0];
        expect(args.update).toHaveProperty('maxConcurrentSessions', null);
        expect(args.update).not.toHaveProperty('mfaFailClosed');
    });

    it('rejects an empty patch rather than writing nothing and reporting success', async () => {
        await expect(updateTenantSecurityConfig(adminCtx, {})).rejects.toThrow(/No settings/);
        expect(mockDb.tenantSecuritySettings.upsert).not.toHaveBeenCalled();
    });
});

// ─── Validation ─────────────────────────────────────────────────────

describe('validation', () => {
    it.each([0, -1, 101, 1.5])('rejects maxConcurrentSessions=%s', async (v) => {
        await expect(
            updateTenantSecurityConfig(adminCtx, { maxConcurrentSessions: v as number }),
        ).rejects.toThrow(/between 1 and 100/);
    });

    it('accepts null maxConcurrentSessions as "unlimited"', async () => {
        await expect(
            updateTenantSecurityConfig(adminCtx, { maxConcurrentSessions: null }),
        ).resolves.toBeDefined();
    });

});

// ─── The schema ─────────────────────────────────────────────────────

describe('UpdateTenantSecuritySettingsInput', () => {
    it('holds the same range as the usecase, and admits null', () => {
        expect(UpdateTenantSecuritySettingsInput.safeParse({ maxConcurrentSessions: 1 }).success).toBe(true);
        expect(UpdateTenantSecuritySettingsInput.safeParse({ maxConcurrentSessions: 100 }).success).toBe(true);
        expect(UpdateTenantSecuritySettingsInput.safeParse({ maxConcurrentSessions: null }).success).toBe(true);
        for (const bad of [0, 101, 2.5]) {
            expect(UpdateTenantSecuritySettingsInput.safeParse({ maxConcurrentSessions: bad }).success).toBe(false);
        }
    });

    it('is strict: an unknown key, or a field the MFA route owns, is refused', () => {
        expect(UpdateTenantSecuritySettingsInput.safeParse({ maxConcurentSessions: 3 }).success).toBe(false);
        expect(UpdateTenantSecuritySettingsInput.safeParse({ mfaPolicy: 'REQUIRED' }).success).toBe(false);
        expect(UpdateTenantSecuritySettingsInput.safeParse({ sessionMaxAgeMinutes: 60 }).success).toBe(false);
    });
});

// ─── Audit ──────────────────────────────────────────────────────────

describe('audit', () => {
    it('writes one SECURITY_SETTINGS_UPDATED event naming the changed fields', async () => {
        await updateTenantSecurityConfig(adminCtx, { maxConcurrentSessions: 4, mfaFailClosed: true });

        expect(mockLogEvent).toHaveBeenCalledTimes(1);
        const [, , entry] = mockLogEvent.mock.calls[0];
        expect(entry.action).toBe('SECURITY_SETTINGS_UPDATED');
        expect(entry.detailsJson.changedFields).toEqual(['maxConcurrentSessions', 'mfaFailClosed']);
    });

    it('writes no event when the patch is refused', async () => {
        await expect(updateTenantSecurityConfig(adminCtx, { maxConcurrentSessions: 0 })).rejects.toThrow();
        expect(mockLogEvent).not.toHaveBeenCalled();
    });
});

// ─── Read ───────────────────────────────────────────────────────────

describe('read', () => {
    it('an absent row reads as unlimited sessions and fail-open MFA', async () => {
        await expect(getTenantSecurityConfig(adminCtx)).resolves.toEqual({
            maxConcurrentSessions: null,
            mfaFailClosed: false,
        });
    });

    it('reports the stored values', async () => {
        mockDb.tenantSecuritySettings.findUnique.mockResolvedValue({ maxConcurrentSessions: 2, mfaFailClosed: true });
        await expect(getTenantSecurityConfig(adminCtx)).resolves.toEqual({
            maxConcurrentSessions: 2,
            mfaFailClosed: true,
        });
    });
});
