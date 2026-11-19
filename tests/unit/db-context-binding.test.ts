/**
 * The prior-state reader and the soft-delete writer are bound INSIDE the
 * transaction, and only where a write can happen.
 *
 * ═══ WHY THIS IS ITS OWN SUITE ═══
 *
 * The audit extension (sub-phase 1.5) can compute a correct diff and the trail
 * still be unimproved, because the diff only happens when a reader reaches the
 * extension; the soft-delete extension (2.1) likewise needs the writer bound
 * to the transaction. That delivery is plumbing, and plumbing is exactly what
 * a unit test of the extension cannot see. Both are inert in 1.3 and land
 * bound already.
 *
 * It also pins a SECURITY decision that would otherwise be invisible: the
 * read-replica context does not get a reader. It takes no writes, and handing
 * it one would mean an audit row's `before` came from a replica that may lag
 * the write it claims to describe.
 */
// `runInTenantReadContext` always uses `prismaRead` and ignores any injected
// client, so the replica needs a working `$transaction` of its own here.
const replicaTx = {
    $executeRaw: jest.fn(async () => 0),
    tenantMembership: { findFirst: jest.fn(async () => ({ role: 'ADMIN' })) },
};
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {},
    prisma: {},
    prismaRead: { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(replicaTx) },
}));

import { getAuditContext } from '@/lib/audit-context';
import { runInTenantContext, runInTenantReadContext, withTenantDb } from '@/lib/db-context';

import { makeRequestContext } from '../helpers/make-context';

const ctx = makeRequestContext('OWNER', { tenantId: 't1', userId: 'u1' });

/**
 * A client whose `$transaction` hands the callback a delegate-bearing `tx`,
 * so the reader the binding builds has something real to close over.
 */
function fakeClient(row: Record<string, unknown> | null) {
    const findFirst = jest.fn(async () => row);
    const update = jest.fn(async (a: unknown) => ({ updated: a }));
    const updateMany = jest.fn(async () => ({ count: 2 }));
    return {
        client: {
            $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
                fn({
                    $executeRaw: jest.fn(async () => 0),
                    tenantMembership: { findFirst, update, updateMany },
                }),
        },
        findFirst,
        update,
        updateMany,
    };
}

describe('runInTenantContext', () => {
    it('binds a reader that the audit extension can find', async () => {
        const { client } = fakeClient({ role: 'ADMIN' });

        const seen = await runInTenantContext(
            ctx,
            async () => getAuditContext()?.readPriorState !== undefined,
            { customPrisma: client as never },
        );

        expect(seen).toBe(true);
    });

    it('reads through the TRANSACTION’s delegate, not a module-scope client', async () => {
        // The property the whole design rests on. A reader closing over
        // anything else would run outside this transaction as the owning role,
        // which bypasses RLS — and the row it returned would be written into
        // this tenant's audit trail as `before`.
        const { client, findFirst } = fakeClient({ role: 'ADMIN' });

        const prior = await runInTenantContext(
            ctx,
            async () => getAuditContext()?.readPriorState?.('TenantMembership', { id: 'm1' }),
            { customPrisma: client as never },
        );

        expect(findFirst).toHaveBeenCalledWith({ where: { id: 'm1' } });
        expect(prior).toStrictEqual({ role: 'ADMIN' });
    });

    it('keeps the identifiers the outer binding carried', async () => {
        // The inner binding SHADOWS rather than merges, so a field left out
        // would silently disappear for everything inside the transaction.
        const { client } = fakeClient(null);

        const seen = await runInTenantContext(
            ctx,
            async () => ({ ...getAuditContext(), readPriorState: undefined }),
            { customPrisma: client as never },
        );

        expect(seen).toMatchObject({ tenantId: 't1', actorUserId: 'u1', source: 'api' });
    });

    it('resolves to null rather than throwing when the model has no delegate', async () => {
        // A prior-state read decorates an audit row; the write it describes has
        // to stand whether or not the read works.
        const { client } = fakeClient(null);

        const prior = await runInTenantContext(
            ctx,
            async () => getAuditContext()?.readPriorState?.('NoSuchModel', { id: 'x' }),
            { customPrisma: client as never },
        );

        expect(prior).toBeNull();
    });
});

describe('the soft-delete writer', () => {
    it('writes through the TRANSACTION’s delegate: update for one row, updateMany for many', async () => {
        const { client, update, updateMany } = fakeClient(null);

        const [one, many] = await runInTenantContext(
            ctx,
            async () => {
                const write = getAuditContext()?.softDeleteWrite;
                return [
                    await write?.('TenantMembership', { where: { id: 'm1' }, data: { deletedAt: 'now' } }, false),
                    await write?.('TenantMembership', { where: { tenantId: 't1' }, data: { deletedAt: 'now' } }, true),
                ];
            },
            { customPrisma: client as never },
        );

        expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { deletedAt: 'now' } });
        expect(updateMany).toHaveBeenCalledWith({ where: { tenantId: 't1' }, data: { deletedAt: 'now' } });
        expect(one).toEqual({ updated: { where: { id: 'm1' }, data: { deletedAt: 'now' } } });
        expect(many).toEqual({ count: 2 });
    });

    it('REFUSES, rather than writing elsewhere, when the transaction cannot reach the model', async () => {
        // Unlike the reader, this IS the write the caller asked for: a failure
        // must reach them.
        const { client } = fakeClient(null);

        await expect(
            runInTenantContext(ctx, async () => getAuditContext()?.softDeleteWrite?.('NoSuchModel', { data: {} }, false), {
                customPrisma: client as never,
            }),
        ).rejects.toThrow(/carries no update for NoSuchModel/);
    });
});

describe('withTenantDb', () => {
    it('binds a reader too — it takes writes', async () => {
        const { client } = fakeClient(null);

        const seen = await withTenantDb(
            't1',
            async () => getAuditContext()?.readPriorState !== undefined,
            client as never,
        );

        expect(seen).toBe(true);
    });
});

describe('the read-replica context', () => {
    it('is deliberately NOT given a reader or a soft-delete writer', async () => {
        // It takes no writes, and a `before` sourced from a replica could lag
        // the write it claims to describe. Asserted rather than left to the
        // absence of a line in db-context.
        // No client is injected: `runInTenantReadContext` takes no
        // `customPrisma` and always opens on `prismaRead`, which is why the
        // replica is mocked with its own `$transaction` at the top of this
        // file. Passing one here typechecked as `never` and did nothing.
        const seen = await runInTenantReadContext(ctx, async () => [
            getAuditContext()?.readPriorState,
            getAuditContext()?.softDeleteWrite,
        ]);

        expect(seen).toEqual([undefined, undefined]);
    });
});
