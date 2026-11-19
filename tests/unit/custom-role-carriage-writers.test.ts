/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles that stand
 * in for a Prisma client; the file-level disable is this repo's standard for
 * the shape. */
/**
 * Who can make a membership carry a custom role only an ADMIN may carry — the
 * CENSUS of the rule (owner decision, 2026-10-30; the rule itself is
 * `tests/unit/custom-role-carriage.test.ts`).
 *
 * A combination is made by whoever writes a membership's built-in ROLE, its
 * CUSTOM ROLE, or what a custom role GRANTS (its base and its blob). Two
 * halves:
 *
 *   STRUCTURE — every file whose code writes `TenantMembership.role`,
 *   `TenantMembership.customRoleId`, `TenantCustomRole.baseRole` or
 *   `TenantCustomRole.grantsJson` is listed in `WRITERS`, as either
 *   ASKING the rule (its code calls the predicate) or UNABLE to make the
 *   combination, with the reason. A new writer fails here until it is one or
 *   the other.
 *
 *   BEHAVIOUR — each asking writer refuses, with the 409 and its named reason,
 *   and lets every change through that adds nothing: a clear, a narrowing
 *   save, a legacy row moved among MEMBER, VIEWER and GUEST. Each unable
 *   writer is verified unable, not assumed.
 *
 * The real-database half (save and assignment, two tenants) is
 * `tests/integration/custom-role-carriage.test.ts`.
 *
 * Copied from inflect-compliance (5528464fc54a8681956f3b9ce23ca9c075f0420e).
 * The Entra group-sync writer leaves the census until 8.3 adds it back with
 * the file; the access-review, tenant-lifecycle, SCIM, SSO JIT, org-tenants
 * and staging-seed writers are not ported (8.3, or cut).
 */
import { strictMock } from '../helpers/strict-mock';

jest.mock('@/lib/db-context', () => ({ runInTenantContext: jest.fn() }));
jest.mock('@/app-layer/events/audit', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));
// `strictMock`: `@/lib/audit` is a guarded barrel (see partial-mock-of-a-guarded-barrel).
jest.mock('@/lib/audit', () =>
    strictMock('@/lib/audit', jest.requireActual('@/lib/audit'), {
        appendAuditEntry: jest.fn().mockResolvedValue({ id: 'a', entryHash: 'h', previousHash: null }),
        appendAuditEntryOrQueue: jest.fn().mockResolvedValue({ recorded: 'chain', auditId: 'a' }),
    }),
);
const prismaMock = {
    tenantInvite: { updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    tenantMembership: { findMany: jest.fn() },
    $transaction: jest.fn(),
};
// Getters, not values: @swc/jest hoists this factory above the `const`.
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    get prisma() {
        return prismaMock;
    },
    get default() {
        return prismaMock;
    },
}));

import { readFileSync } from 'fs';

import { repoFiles, repoRelative } from '../helpers/repo-files';
import { allCallExpressionsOf, codeOf } from '../helpers/source-blocks';
import { makeRequestContext } from '../helpers/make-context';
import { runInTenantContext } from '@/lib/db-context';
import { getPermissionsForRole, type PermissionSet } from '@/lib/permissions';
import { ADMIN_BASE_ONLY_PERMISSIONS, PERMISSION_NEEDS_ADMIN_BASE } from '@/lib/custom-role-admin-base-rule';
import {
    CUSTOM_ROLE_ADMIN_BASE_REFUSAL,
    CUSTOM_ROLE_ADMIN_KEYS_REFUSAL,
} from '@/lib/roles';
import { ConflictError } from '@/lib/errors/types';
import { assignCustomRole, updateCustomRole } from '@/app-layer/usecases/custom-roles';
import {
    updateTenantMemberRole,
    updateTenantMemberRoleAndCustomRole,
} from '@/app-layer/usecases/tenant-admin';
import {
    createInviteToken,
    redeemInvite,
    redeemPendingInvitesByEmail,
} from '@/app-layer/usecases/tenant-invites';

const mockRunInTx = runInTenantContext as jest.MockedFunction<any>;

// ─── STRUCTURE ─────────────────────────────────────────────────────

type Writer = { asks: string } | { unable: string };

/**
 * Every file that writes a membership's role or custom role, or what a custom
 * role grants — and how it holds the rule.
 */
const WRITERS: Readonly<Record<string, Writer>> = {
    'src/app-layer/usecases/custom-roles.ts': {
        asks:
            'updateCustomRole (a save, judged against every carrier’s built-in role) and assignCustomRole. ' +
            'createCustomRole has no carriers, and deleteCustomRole only clears',
    },
    'src/app-layer/usecases/tenant-admin.ts': {
        asks: 'updateTenantMemberRole and updateTenantMemberRoleAndCustomRole — the members page',
    },
    'src/app-layer/usecases/tenant-invites.ts': {
        asks: 'createInviteToken, and both redemptions, which reactivate a membership with its custom role kept',
    },
    'src/app-layer/usecases/org-provisioning.ts': { unable: 'creates new ADMIN rows, with no custom role' },
    'src/app/api/auth/register/route.ts': { unable: 'creates a new tenant’s OWNER row, with no custom role' },
};

const WRITE_VERBS = '(?:update|updateMany|upsert|create|createMany)';

/** `text` with the `{…}` object after each `key:` removed — a `where`, `select` or `include` is not a write. */
function withoutObjects(text: string, keys: readonly string[]): string {
    let out = text;
    for (const key of keys) {
        for (;;) {
            const m = new RegExp(`\\b${key}\\s*:\\s*\\{`).exec(out);
            if (!m) break;
            let depth = 0;
            let end = -1;
            for (let i = m.index + m[0].length - 1; i < out.length; i++) {
                if (out[i] === '{') depth++;
                else if (out[i] === '}' && --depth === 0) {
                    end = i;
                    break;
                }
            }
            if (end < 0) break;
            out = out.slice(0, m.index) + out.slice(end + 1);
        }
    }
    return out;
}

/** Whether `src` writes one of the four columns, in any of the shapes this repo uses. */
function writesTheRule(src: string): boolean {
    const membership = allCallExpressionsOf(src, `tenantMembership\\.${WRITE_VERBS}`).some((call) =>
        /\brole\b\s*[:,}]|\bcustomRoleId\b/.test(withoutObjects(call, ['where', 'select', 'include'])),
    );
    const customRole = allCallExpressionsOf(src, `tenantCustomRole\\.${WRITE_VERBS}`).some((call) =>
        /\bbaseRole\b|\bgrantsJson\b/.test(withoutObjects(call, ['where', 'select', 'include'])),
    );
    const sql = /UPDATE\s+"TenantMembership"[\s\S]{0,200}"(role|customRoleId)"|UPDATE\s+"TenantCustomRole"/i.test(src);
    return membership || customRole || sql;
}

const srcFiles = repoFiles({ under: 'src', extensions: ['.ts', '.tsx'] }).map((abs) => ({
    rel: repoRelative(abs),
    raw: readFileSync(abs, 'utf8'),
}));

describe('STRUCTURE — every writer of the combination asks the rule, or cannot make it', () => {
    it('the population is real', () => {
        expect(srcFiles.length).toBeGreaterThan(100);
    });

    it('exactly the listed files write a membership’s role or custom role, or what a custom role grants', () => {
        const writers = srcFiles.filter((f) => writesTheRule(f.raw)).map((f) => f.rel).sort();
        expect(writers).toEqual(Object.keys(WRITERS).sort());
    });

    it('every asking writer calls the predicate; every unable one does not need to', () => {
        for (const [file, how] of Object.entries(WRITERS)) {
            const code = codeOf(srcFiles.find((f) => f.rel === file)!.raw);
            const asks = /\bassertCustomRoleCarriageInTx\s*\(|\bcustomRoleCarriageRefusal\s*\(/.test(code);
            expect({ file, asks }).toEqual({ file, asks: 'asks' in how });
        }
    });

    it('the write detector is not blind (each shape is caught; a read is not)', () => {
        for (const sample of [
            'db.tenantMembership.update({ where: { id }, data: { role: input.role } })',
            'tx.tenantMembership.upsert({ where: { x }, create: { role }, update: { role, status } })',
            'db.tenantMembership.update({ where: { id }, data: { customRoleId } })',
            'db.tenantMembership.createMany({ data: rows.map((r) => ({ userId: r, role: Role.ADMIN })) })',
            'db.tenantCustomRole.update({ where: { id }, data: { baseRole: x } })',
            'db.tenantCustomRole.create({ data: { name, grantsJson: p } })',
            `UPDATE "TenantMembership" SET "role" = 'MEMBER'`,
        ]) {
            expect({ sample, caught: writesTheRule(sample) }).toEqual({ sample, caught: true });
        }
        for (const sample of [
            "db.tenantMembership.updateMany({ where: { role: 'OWNER' }, data: { status: 'DEACTIVATED' } })",
            'db.tenantMembership.update({ where: { id }, data: { lineOfDefence }, select: { role: true } })',
        ]) {
            expect({ sample, caught: writesTheRule(sample) }).toEqual({ sample, caught: false });
        }
    });
});

describe('STRUCTURE — the unable writers, verified', () => {
    const code = (file: string) => srcFiles.find((f) => f.rel === file)!.raw;

    it('no unable writer writes a custom role at all', () => {
        for (const [file, how] of Object.entries(WRITERS)) {
            if (!('unable' in how)) continue;
            const calls = allCallExpressionsOf(code(file), `tenantMembership\\.${WRITE_VERBS}`);
            expect({ file, writesCustomRole: calls.some((c) => /\bcustomRoleId\b/.test(c)) }).toEqual({
                file,
                writesCustomRole: false,
            });
        }
    });
});

// ─── BEHAVIOUR ─────────────────────────────────────────────────────

/** A full blob: `base`'s defaults with `admin` keys switched as given. */
function blob(base: string, admin: Partial<PermissionSet['admin']> = {}) {
    const d = getPermissionsForRole(base as never);
    return { ...d, admin: { ...d.admin, ...admin } };
}

/** `blob` with every Admin-base-only permission off (#4536, #4581 A), so its base can be lowered. */
function withoutAdminBaseOnly(p: PermissionSet): PermissionSet {
    const out = JSON.parse(JSON.stringify(p)) as Record<string, Record<string, boolean>>;
    for (const key of ADMIN_BASE_ONLY_PERMISSIONS) {
        const [domain, action] = key.split('.');
        out[domain][action] = false;
    }
    return out as unknown as PermissionSet;
}

/** Custom roles by id: an ADMIN-built one, one granting a listed key, and a harmless one. */
const ROLES: Record<string, { id: string; tenantId: string; baseRole: string; grantsJson: unknown; isActive: boolean }> = {
    'cr-admin-built': { id: 'cr-admin-built', tenantId: 't-1', baseRole: 'ADMIN', grantsJson: blob('ADMIN'), isActive: true },
    'cr-card': {
        id: 'cr-card',
        tenantId: 't-1',
        baseRole: 'VIEWER',
        grantsJson: blob('VIEWER', { scim: true }),
        isActive: true,
    },
    'cr-plain': { id: 'cr-plain', tenantId: 't-1', baseRole: 'VIEWER', grantsJson: blob('VIEWER'), isActive: true },
};

const customRoleTable = () => ({
    findFirst: jest.fn(async (a: any): Promise<(typeof ROLES)[string] | null> => ROLES[a.where.id] ?? null),
    findMany: jest.fn(async (a: any) => (a.where.id.in as string[]).map((id) => ROLES[id]).filter(Boolean)),
    update: jest.fn(async (a: any) => ({ id: a.where.id, name: 'R', ...a.data })),
});

/** An OWNER may grant every key, so the grant check never decides these cases. */
const owner = () => makeRequestContext('OWNER', { tenantId: 't-1', userId: 'owner-1' });

function membershipDb(membership: { role: string; customRoleId: string | null }) {
    const row = {
        id: 'm-1',
        userId: 'u-1',
        tenantId: 't-1',
        status: 'ACTIVE',
        user: { id: 'u-1', name: 'U', email: 'u@example.com' },
        ...membership,
    };
    const db = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(0),
        tenantMembership: {
            findFirst: jest.fn().mockResolvedValue(row),
            count: jest.fn().mockResolvedValue(2),
            update: jest.fn(async (a: any) => ({ ...row, ...a.data, customRole: null })),
        },
        tenantCustomRole: customRoleTable(),
    };
    mockRunInTx.mockImplementation(async (_c: unknown, fn: (tx: unknown) => unknown) => fn(db));
    return db;
}

const refusalOf = async (p: Promise<unknown>) => {
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    return err as ConflictError & { details: Record<string, unknown> };
};

beforeEach(() => {
    jest.clearAllMocks();
    mockRunInTx.mockImplementation(async () => {
        throw new Error('the database was reached');
    });
});

describe('BEHAVIOUR — assignCustomRole', () => {
    it('refuses a role granting a listed key to a MEMBER — 409, the reason and the key, nothing written', async () => {
        const db = membershipDb({ role: 'MEMBER', customRoleId: null });
        const err = await refusalOf(assignCustomRole(owner(), 'm-1', 'cr-card'));
        expect(err.details).toEqual({ reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: ['admin.scim'] });
        expect(err.message).toMatch(/can only be carried by an ADMIN membership/);
        expect(db.tenantMembership.update).not.toHaveBeenCalled();
    });

    it('refuses an ADMIN-built role to a VIEWER for its base', async () => {
        const db = membershipDb({ role: 'VIEWER', customRoleId: null });
        const err = await refusalOf(assignCustomRole(owner(), 'm-1', 'cr-admin-built'));
        expect(err.details).toEqual({ reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL, baseRole: 'ADMIN' });
        expect(db.tenantMembership.update).not.toHaveBeenCalled();
    });

    it('assigns both to an ADMIN', async () => {
        const db = membershipDb({ role: 'ADMIN', customRoleId: null });
        await assignCustomRole(owner(), 'm-1', 'cr-admin-built');
        await assignCustomRole(owner(), 'm-1', 'cr-card');
        expect(db.tenantMembership.update).toHaveBeenCalledTimes(2);
    });

    it('a legacy carrier is not trapped: clearing, replacing with a harmless role and re-saving the same role all pass', async () => {
        const db = membershipDb({ role: 'MEMBER', customRoleId: 'cr-admin-built' });
        await assignCustomRole(owner(), 'm-1', null);
        await assignCustomRole(owner(), 'm-1', 'cr-plain');
        await assignCustomRole(owner(), 'm-1', 'cr-admin-built');
        expect(db.tenantMembership.update.mock.calls.map((c: any[]) => c[0].data)).toEqual([
            { customRoleId: null },
            { customRoleId: 'cr-plain' },
            { customRoleId: 'cr-admin-built' },
        ]);
    });
});

describe('BEHAVIOUR — the members-page role change', () => {
    it('moving an ADMIN who carries an ADMIN-built role to MEMBER is refused until the custom role changes', async () => {
        const db = membershipDb({ role: 'ADMIN', customRoleId: 'cr-admin-built' });
        const err = await refusalOf(updateTenantMemberRole(owner(), { membershipId: 'm-1', role: 'MEMBER' }));
        expect(err.details).toEqual({ reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL, baseRole: 'ADMIN' });
        expect(err.message).toMatch(/Remove or change this member's custom role first/);
        expect(db.tenantMembership.update).not.toHaveBeenCalled();
    });

    it('…and the same move saved WITH a harmless custom role passes, all at once', async () => {
        const db = membershipDb({ role: 'ADMIN', customRoleId: 'cr-admin-built' });
        await updateTenantMemberRoleAndCustomRole(owner(), { membershipId: 'm-1', role: 'MEMBER', customRoleId: 'cr-plain' });
        expect(db.tenantMembership.update.mock.calls.map((c: any[]) => c[0].data)).toEqual([
            { role: 'MEMBER' },
            { customRoleId: 'cr-plain' },
        ]);
    });

    it('…while saved with a role granting a listed key it is refused, with nothing written', async () => {
        const db = membershipDb({ role: 'ADMIN', customRoleId: null });
        const err = await refusalOf(
            updateTenantMemberRoleAndCustomRole(owner(), { membershipId: 'm-1', role: 'VIEWER', customRoleId: 'cr-card' }),
        );
        expect(err.details).toEqual({ reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: ['admin.scim'] });
        expect(db.tenantMembership.update).not.toHaveBeenCalled();
    });

    it('a legacy MEMBER carrier moves to VIEWER — the offence is not new', async () => {
        const db = membershipDb({ role: 'MEMBER', customRoleId: 'cr-card' });
        await updateTenantMemberRole(owner(), { membershipId: 'm-1', role: 'VIEWER' });
        expect(db.tenantMembership.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'VIEWER' } }));
    });
});

describe('BEHAVIOUR — updateCustomRole, judged against every carrier', () => {
    function saveDb(existing: string, carriers: Array<{ role: string; n: number }>) {
        const db = {
            $executeRawUnsafe: jest.fn().mockResolvedValue(0),
            tenantCustomRole: customRoleTable(),
            tenantMembership: {
                groupBy: jest.fn(async () => carriers.map((c) => ({ role: c.role, _count: { _all: c.n } }))),
            },
        };
        db.tenantCustomRole.findFirst.mockResolvedValueOnce(ROLES[existing]);
        mockRunInTx.mockImplementation(async (_c: unknown, fn: (tx: unknown) => unknown) => fn(db));
        return db;
    }

    it('adding a listed key while non-ADMIN members carry it is refused, counting every one of them', async () => {
        const db = saveDb('cr-plain', [
            { role: 'MEMBER', n: 2 },
            { role: 'VIEWER', n: 1 },
            { role: 'ADMIN', n: 4 },
        ]);
        const err = await refusalOf(
            updateCustomRole(owner(), 'cr-plain', { grantsJson: blob('VIEWER', { scim: true }) }),
        );
        expect(err.details).toEqual({
            reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL,
            keys: ['admin.scim'],
            blockingMemberships: 3,
        });
        expect(err.message).toMatch(/3 member\(s\) carrying this role hold another role/);
        expect(db.tenantCustomRole.update).not.toHaveBeenCalled();
        expect(db.tenantMembership.groupBy).toHaveBeenCalledWith(
            expect.objectContaining({ by: ['role'], where: { tenantId: 't-1', customRoleId: 'cr-plain' } }),
        );
    });

    it('raising the base to ADMIN is refused for its base', async () => {
        saveDb('cr-plain', [{ role: 'VIEWER', n: 1 }]);
        const err = await refusalOf(updateCustomRole(owner(), 'cr-plain', { baseRole: 'ADMIN' }));
        expect(err.details).toMatchObject({ reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL, blockingMemberships: 1 });
    });

    it('when a save breaks the Admin-base rule (#4536, #4581 A) too, the content refusal comes first and nothing is read', async () => {
        // admin.manage on a VIEWER base AND a new
        // admin-only key, with MEMBER carriers: both rules are broken. The
        // Admin-base rule reads the role alone and runs first; the carriage
        // rule reads the carriers.
        const both = blob('VIEWER', { manage: true, scim: true });
        const db = saveDb('cr-plain', [{ role: 'MEMBER', n: 2 }]);
        const first = await updateCustomRole(owner(), 'cr-plain', { grantsJson: both }).catch((e) => e);
        expect(first).toMatchObject({
            status: 400,
            details: { reason: PERMISSION_NEEDS_ADMIN_BASE, permissions: ['admin.manage'] },
        });
        expect(db.tenantMembership.groupBy).not.toHaveBeenCalled();

        // With those switched off, the carriage refusal is next.
        saveDb('cr-plain', [{ role: 'MEMBER', n: 2 }]);
        const second = await refusalOf(
            updateCustomRole(owner(), 'cr-plain', { grantsJson: blob('VIEWER', { scim: true }) }),
        );
        expect(second.details).toMatchObject({ reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, blockingMemberships: 2 });
        expect(db.tenantCustomRole.update).not.toHaveBeenCalled();
    });

    it('the same save carried only by ADMINs passes', async () => {
        const db = saveDb('cr-plain', [{ role: 'ADMIN', n: 4 }]);
        await updateCustomRole(owner(), 'cr-plain', { baseRole: 'ADMIN' });
        expect(db.tenantCustomRole.update).toHaveBeenCalledTimes(1);
    });

    it('a legacy role is not trapped: removing keys, lowering the base and renaming all pass', async () => {
        for (const input of [
            { grantsJson: blob('ADMIN', { scim: false }) },
            // Lowered with the Admin-base-only permissions switched off in the
            // same save, as the roles page does (#4536, #4581 A).
            { baseRole: 'MEMBER' as const, grantsJson: withoutAdminBaseOnly(blob('ADMIN')) },
            { name: 'Renamed' },
        ]) {
            const db = saveDb('cr-admin-built', [{ role: 'MEMBER', n: 5 }]);
            db.tenantCustomRole.findFirst.mockResolvedValueOnce(null); // the rename's duplicate check
            await updateCustomRole(owner(), 'cr-admin-built', input);
            expect(db.tenantCustomRole.update).toHaveBeenCalledTimes(1);
        }
    });
});

describe('BEHAVIOUR — invites', () => {
    function inviteDb(existing: { status: string; role: string; customRoleId: string | null }) {
        const db = {
            $executeRawUnsafe: jest.fn().mockResolvedValue(0),
            user: { findUnique: jest.fn().mockResolvedValue({ id: 'u-1' }) },
            tenantMembership: { findUnique: jest.fn().mockResolvedValue(existing) },
            tenantCustomRole: customRoleTable(),
            tenantInvite: { upsert: jest.fn(async (a: any) => ({ id: 'inv-1', token: 't', ...a.create })) },
        };
        mockRunInTx.mockImplementation(async (_c: unknown, fn: (tx: unknown) => unknown) => fn(db));
        return db;
    }

    it('createInviteToken refuses to bring back an ADMIN carrying an ADMIN-built role as a MEMBER', async () => {
        const db = inviteDb({ status: 'DEACTIVATED', role: 'ADMIN', customRoleId: 'cr-admin-built' });
        const err = await refusalOf(createInviteToken(owner(), { email: 'x@example.com', role: 'MEMBER' }));
        expect(err.details).toEqual({ reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL, baseRole: 'ADMIN' });
        expect(err.message).toMatch(/Invite them as ADMIN/);
        expect(db.tenantInvite.upsert).not.toHaveBeenCalled();
    });

    it('…and invites them back as ADMIN', async () => {
        const db = inviteDb({ status: 'DEACTIVATED', role: 'ADMIN', customRoleId: 'cr-admin-built' });
        await createInviteToken(owner(), { email: 'x@example.com', role: 'ADMIN' });
        expect(db.tenantInvite.upsert).toHaveBeenCalledTimes(1);
    });

    function claimed(role: string) {
        prismaMock.tenantInvite.updateMany.mockResolvedValue({ count: 1 });
        prismaMock.tenantInvite.findUnique.mockResolvedValue({
            id: 'inv-1',
            tenantId: 't-1',
            email: 'x@example.com',
            role,
            invitedById: 'owner-1',
            createdAt: new Date(),
        });
    }
    function redemptionTx(existing: { role: string; customRoleId: string | null }) {
        const tx = {
            tenantMembership: {
                findUnique: jest.fn().mockResolvedValue(existing),
                upsert: jest.fn().mockResolvedValue({ id: 'm-1' }),
            },
            tenantCustomRole: customRoleTable(),
            tenant: { findUnique: jest.fn().mockResolvedValue({ slug: 'acme' }) },
        };
        prismaMock.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
        return tx;
    }

    it('redeemInvite refuses (the backstop) a role-granting-a-key carrier coming back as a VIEWER — no upsert', async () => {
        claimed('VIEWER');
        const tx = redemptionTx({ role: 'ADMIN', customRoleId: 'cr-card' });
        const err = await refusalOf(redeemInvite({ token: 't', userId: 'u-1', userEmail: 'x@example.com' }));
        expect(err.details).toEqual({ reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: ['admin.scim'] });
        expect(tx.tenantMembership.upsert).not.toHaveBeenCalled();
    });

    it('redeemInvite lets a legacy MEMBER carrier back as a VIEWER — nothing new', async () => {
        claimed('VIEWER');
        const tx = redemptionTx({ role: 'MEMBER', customRoleId: 'cr-card' });
        await redeemInvite({ token: 't', userId: 'u-1', userEmail: 'x@example.com' });
        expect(tx.tenantMembership.upsert).toHaveBeenCalledTimes(1);
    });

    it('redeemPendingInvitesByEmail skips such an invite WITHOUT claiming it, and redeems the others', async () => {
        prismaMock.tenantInvite.findMany.mockResolvedValue([
            { id: 'inv-editor', tenantId: 't-1', role: 'MEMBER', invitedById: 'o', createdAt: new Date() },
            { id: 'inv-other', tenantId: 't-2', role: 'VIEWER', invitedById: 'o', createdAt: new Date() },
        ]);
        prismaMock.tenantMembership.findMany.mockResolvedValue([
            { tenantId: 't-1', role: 'ADMIN', customRole: { baseRole: 'ADMIN', grantsJson: blob('ADMIN') } },
        ]);
        prismaMock.tenantInvite.updateMany.mockResolvedValue({ count: 1 });
        redemptionTx({ role: 'VIEWER', customRoleId: null });
        const redeemed = await redeemPendingInvitesByEmail({ userId: 'u-1', userEmail: 'x@example.com' });
        expect(prismaMock.tenantInvite.updateMany).toHaveBeenCalledTimes(1);
        expect(prismaMock.tenantInvite.updateMany.mock.calls[0][0].where.id).toBe('inv-other');
        expect(redeemed.map((r) => r.role)).toEqual(['VIEWER']);
    });
});
