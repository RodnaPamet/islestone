/**
 * Unit Test: Epic B.3 key-rotation job.
 *
 * Mocks Prisma + audit-writer + runJob so the test exercises the
 * job's control flow without hitting the DB:
 *
 *   - DEK re-wrap: unwrap + re-wrap + update Tenant.encryptedDek,
 *     clear the tenant key-manager cache, handle missing/invalid
 *     state cleanly.
 *   - v1 re-encrypt: iterate batches per (model, field), decrypt
 *     via dual-KEK, encrypt under primary, update row.
 *   - Idempotency gate: SELECT uses `LIKE 'v1:%'` so a second run
 *     finds nothing to do.
 *   - Per-row error isolation: one failed decrypt/update doesn't
 *     abort the batch.
 *   - Audit-log entries at start + complete.
 *   - Invalid identifier (typo'd model) fails loud.
 *
 * Copied from inflect-compliance `tests/unit/key-rotation-job.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.5b). Islestone's one
 * manifest model, `TenantSecuritySettings`, replaces `Risk`; the
 * ownership-chained case reads a planted manifest model, because Islestone's
 * manifest has none; the tenant-scoped PII case names the outbox recipient
 * (`NotificationOutbox.toEmail`, sub-phase 1.6), Islestone's one tenant-scoped
 * PII column; and the API-key re-check cases are cut with the check, until
 * API keys arrive (5.2).
 */

jest.mock('@/lib/observability/job-runner', () => ({
    runJob: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}));

// The real manifest plus one planted model that has no `tenantId` column,
// so the "ownership-chained models are skipped" case has a subject: every
// model in Islestone's manifest carries its own tenantId. The fixture's
// probe answers "column exists" in every other test, and its v1 SELECT
// finds nothing, so it adds an empty per-field row and nothing else.
const OWNERSHIP_CHAINED_FIXTURE = 'OwnershipChainedFixture';
jest.mock('@/lib/security/encrypted-fields', () => {
    const actual = jest.requireActual('@/lib/security/encrypted-fields') as {
        ENCRYPTED_FIELDS: Record<string, readonly string[]>;
    };
    return {
        ...actual,
        ENCRYPTED_FIELDS: { ...actual.ENCRYPTED_FIELDS, OwnershipChainedFixture: ['body'] },
    };
});

jest.mock('@/lib/observability/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

// Audit writer — capture calls for assertion; never hit DB.
// Typed signature so mock.calls[0][0] infers correctly.
const appendAuditEntryMock = jest.fn(
    async (_entry: {
        tenantId: string;
        userId: string;
        actorType: string;
        entity: string;
        entityId: string;
        action: string;
        details: string | null;
        metadataJson?: Record<string, unknown>;
        requestId?: string | null;
    }) => undefined,
);
jest.mock('@/lib/audit/audit-writer', () => ({
    appendAuditEntry: (entry: Parameters<typeof appendAuditEntryMock>[0]) => appendAuditEntryMock(entry),
}));

// Tenant-key-manager cache — verify it's invalidated on re-wrap.
const clearTenantDekCacheMock = jest.fn();
jest.mock('@/lib/security/tenant-key-manager', () => ({
    clearTenantDekCache: (id?: string) => clearTenantDekCacheMock(id),
}));

// Prisma mock — scripted per-call responses.
const tenantFindUnique = jest.fn();
const tenantUpdate = jest.fn();
const queryRawUnsafe = jest.fn();
const executeRawUnsafe = jest.fn();
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        tenant: {
            findUnique: (...args: unknown[]) => tenantFindUnique(...args),
            update: (...args: unknown[]) => tenantUpdate(...args),
        },
        $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
        $executeRawUnsafe: (...args: unknown[]) => executeRawUnsafe(...args),
    },
    prisma: {
        tenant: {
            findUnique: (...args: unknown[]) => tenantFindUnique(...args),
            update: (...args: unknown[]) => tenantUpdate(...args),
        },
        $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
        $executeRawUnsafe: (...args: unknown[]) => executeRawUnsafe(...args),
    },
}));

import {
    runKeyRotation,
    _resetKeyRotationForTests,
    rotateGlobalPiiColumns,
} from '@/app-layer/jobs/key-rotation';
import { keyRotationOutcome } from '@/app-layer/jobs/executor-registry';
import {
    encryptField,
    isEncryptedValue,
} from '@/lib/security/encryption';
import {
    generateDek,
    wrapDek,
    unwrapDek,
} from '@/lib/security/tenant-keys';

beforeEach(() => {
    jest.clearAllMocks();
    _resetKeyRotationForTests();

    // Default: model probe succeeds for any model on the first call.
    // Individual tests override.
    queryRawUnsafe.mockImplementation(async (sql: string) => {
        if (sql.includes('LIMIT 0')) return [];
        return [];
    });
    executeRawUnsafe.mockResolvedValue(1);
    tenantUpdate.mockResolvedValue({ id: 'tenant-A' });
});

describe('runKeyRotation — DEK re-wrap', () => {
    test('unwraps + re-wraps + writes; clears cache; audit entries present', async () => {
        const originalDek = generateDek();
        const originalWrapped = wrapDek(originalDek);
        tenantFindUnique.mockResolvedValueOnce({ encryptedDek: originalWrapped });

        // No v1 ciphertexts anywhere.
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('LIMIT 0')) return [];
            if (sql.includes("LIKE 'v1:%'")) return [];
            return [];
        });

        const result = await runKeyRotation({
            tenantId: 'tenant-A',
            initiatedByUserId: 'user-admin',
        });

        expect(result.dekRewrapped).toBe(true);
        expect(result.dekRewrapError).toBeUndefined();
        expect(result.totalErrors).toBe(0);
        // Exactly one tenant.update call.
        expect(tenantUpdate).toHaveBeenCalledTimes(1);
        const updateArgs = tenantUpdate.mock.calls[0]?.[0] as {
            where: unknown;
            data: { encryptedDek: string };
        };
        expect(updateArgs.where).toEqual({ id: 'tenant-A' });
        const newWrapped = updateArgs.data.encryptedDek;
        // New wrapping is still a valid wrapped DEK.
        expect(isEncryptedValue(newWrapped)).toBe(true);
        // Re-wrap produces DIFFERENT ciphertext (new IV) but the same
        // underlying DEK bytes.
        expect(newWrapped).not.toBe(originalWrapped);
        expect(unwrapDek(newWrapped).equals(originalDek)).toBe(true);

        // Tenant-key cache was invalidated.
        expect(clearTenantDekCacheMock).toHaveBeenCalledWith('tenant-A');

        // Audit entries at start + complete.
        expect(appendAuditEntryMock).toHaveBeenCalledTimes(2);
        const actions = appendAuditEntryMock.mock.calls.map(
            (c) => (c[0] as { action: string }).action,
        );
        expect(actions).toEqual([
            'KEY_ROTATION_STARTED',
            'KEY_ROTATION_COMPLETED',
        ]);
    });

    test('NULL encryptedDek → no-op re-wrap (lazy init handles it elsewhere)', async () => {
        tenantFindUnique.mockResolvedValueOnce({ encryptedDek: null });
        const r = await runKeyRotation({
            tenantId: 'tenant-B',
            initiatedByUserId: 'admin',
        });
        expect(r.dekRewrapped).toBe(true);
        expect(tenantUpdate).not.toHaveBeenCalled();
    });

    test('missing tenant → error counted, no crash', async () => {
        tenantFindUnique.mockResolvedValueOnce(null);
        const r = await runKeyRotation({
            tenantId: 'nope',
            initiatedByUserId: 'admin',
        });
        expect(r.dekRewrapped).toBe(false);
        expect(r.dekRewrapError).toBe('tenant not found');
        expect(r.totalErrors).toBeGreaterThanOrEqual(1);
    });

    test('encryptedDek not in v1/v2 envelope → flagged as error', async () => {
        tenantFindUnique.mockResolvedValueOnce({
            encryptedDek: 'garbage-not-encrypted',
        });
        const r = await runKeyRotation({
            tenantId: 'tenant-bad',
            initiatedByUserId: 'admin',
        });
        expect(r.dekRewrapped).toBe(false);
        expect(r.dekRewrapError).toMatch(/not a valid wrapped DEK/);
    });
});

describe('runKeyRotation — v1 ciphertext re-encrypt', () => {
    test('re-encrypts each v1 row: decrypt via primary KEK, encrypt under primary KEK', async () => {
        const dek = generateDek();
        tenantFindUnique.mockResolvedValueOnce({ encryptedDek: wrapDek(dek) });

        // Every probe succeeds (each model has a tenantId column).
        queryRawUnsafe.mockImplementation(async (sql: string, ...args: unknown[]) => {
            if (sql.includes('LIMIT 0')) {
                // Probe — return empty (column exists).
                return [];
            }
            // SELECT of v1 ciphertexts for this tenant + field.
            // First batch: 2 rows of v1 data. Subsequent batches empty.
            // First page: the keyset cursor is null.
            if (sql.includes("LIKE 'v1:%'") && args[2] === null) {
                const v1a = encryptField('legacy-one');
                const v1b = encryptField('legacy-two');
                const rows = [
                    { id: 'row-1', value: v1a },
                    { id: 'row-2', value: v1b },
                ];
                // Return the rows once, then empty.
                queryRawUnsafe.mockImplementation(async () => []);
                return rows;
            }
            return [];
        });

        const result = await runKeyRotation({
            tenantId: 'tenant-A',
            initiatedByUserId: 'admin',
        });

        expect(result.totalScanned).toBe(2);
        expect(result.totalRewritten).toBe(2);
        expect(result.totalErrors).toBe(0);
        // Two UPDATEs — both with fresh ciphertexts.
        const updateCalls = executeRawUnsafe.mock.calls.filter(
            (c) => typeof c[0] === 'string' && c[0].includes('UPDATE'),
        );
        expect(updateCalls).toHaveLength(2);
        for (const c of updateCalls) {
            const fresh = c[1] as string;
            expect(isEncryptedValue(fresh)).toBe(true);
        }
    });

    test('idempotent — no v1 rows found means no writes', async () => {
        tenantFindUnique.mockResolvedValueOnce({
            encryptedDek: wrapDek(generateDek()),
        });

        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('LIMIT 0')) return [];
            return []; // no v1 rows
        });

        const result = await runKeyRotation({
            tenantId: 'tenant-clean',
            initiatedByUserId: 'admin',
        });

        expect(result.totalScanned).toBe(0);
        expect(result.totalRewritten).toBe(0);
        const updateCalls = executeRawUnsafe.mock.calls.filter(
            (c) => typeof c[0] === 'string' && c[0].includes('UPDATE'),
        );
        expect(updateCalls).toHaveLength(0);
    });

    test('per-row UPDATE failure isolated — batch continues', async () => {
        tenantFindUnique.mockResolvedValueOnce({
            encryptedDek: wrapDek(generateDek()),
        });

        let v1Served = false;
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('LIMIT 0')) return [];
            if (!v1Served && sql.includes("LIKE 'v1:%'")) {
                v1Served = true;
                return [
                    { id: 'ok-1', value: encryptField('a') },
                    { id: 'fail-2', value: encryptField('b') },
                    { id: 'ok-3', value: encryptField('c') },
                ];
            }
            return [];
        });

        executeRawUnsafe.mockImplementation(async (_sql: string, _val: unknown, id: unknown) => {
            if (id === 'fail-2') throw new Error('db transient');
            return 1;
        });

        const result = await runKeyRotation({
            tenantId: 'tenant-mix',
            initiatedByUserId: 'admin',
        });

        // 3 scanned; 2 rewritten; 1 error; no crash.
        expect(result.totalScanned).toBe(3);
        expect(result.totalRewritten).toBe(2);
        expect(result.totalErrors).toBe(1);
    });

    test('skips manifest models without a tenantId column (ownership-chained)', async () => {
        tenantFindUnique.mockResolvedValueOnce({
            encryptedDek: wrapDek(generateDek()),
        });

        // The probe for the planted model (no tenantId) fails with
        // Postgres' undefined-column message; the probe for
        // TenantSecuritySettings succeeds.
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('LIMIT 0')) {
                if (sql.includes(`"${OWNERSHIP_CHAINED_FIXTURE}"`)) {
                    throw new Error('column "tenantId" does not exist');
                }
                return [];
            }
            return [];
        });

        const result = await runKeyRotation({
            tenantId: 'tenant-probe',
            initiatedByUserId: 'admin',
        });

        // The planted model never appears in per-field results.
        const models = new Set(result.perField.map((f) => f.model));
        expect(models.has(OWNERSHIP_CHAINED_FIXTURE)).toBe(false);
        // TenantSecuritySettings (has tenantId) was probed + processed
        // (0 rows, but present in the per-field breakdown).
        expect(models.has('TenantSecuritySettings')).toBe(true);
        // A missing column is a skip, never an error.
        expect(result.totalErrors).toBe(0);
    });
});

describe('runKeyRotation — audit + observability', () => {
    test('records STARTED before processing, COMPLETED after', async () => {
        tenantFindUnique.mockResolvedValueOnce({
            encryptedDek: wrapDek(generateDek()),
        });

        await runKeyRotation({
            tenantId: 'tenant-audit',
            initiatedByUserId: 'admin-5',
        });

        // First call is STARTED, second is COMPLETED — order matters.
        expect(appendAuditEntryMock).toHaveBeenCalledTimes(2);
        const first = appendAuditEntryMock.mock.calls[0]![0];
        const second = appendAuditEntryMock.mock.calls[1]![0];
        expect(first.action).toBe('KEY_ROTATION_STARTED');
        expect(first.tenantId).toBe('tenant-audit');
        expect(first.userId).toBe('admin-5');

        expect(second.action).toBe('KEY_ROTATION_COMPLETED');
        expect(second.metadataJson).toHaveProperty('dekRewrapped', true);
        expect(second.metadataJson).toHaveProperty('totalScanned');
    });
});

describe('runKeyRotation — audit 2026-11 fixes', () => {
    test('pages by id, so a field with more v1 rows than one batch finishes (#5099)', async () => {
        tenantFindUnique.mockResolvedValueOnce({ encryptedDek: wrapDek(generateDek()) });
        // A table whose rewritten rows stay `v1:` — exactly what the sweep
        // writes. The select honours the cursor; ignoring it returns the
        // first page for ever, which the call cap turns into a failure
        // instead of a hung test.
        const table = ['r1', 'r2', 'r3'].map((id) => ({ id, value: encryptField(`plain-${id}`) }));
        let selects = 0;
        queryRawUnsafe.mockImplementation(async (sql: string, ...args: unknown[]) => {
            if (sql.includes('LIMIT 0')) return [];
            if (!sql.includes('"TenantSecuritySettings"') || !sql.includes("LIKE 'v1:%'")) return [];
            if (++selects > 20) throw new Error('select called too often: the sweep is not advancing');
            const [, limit, cursor] = args as [string, number, string | null];
            return table.filter((r) => cursor === null || r.id > cursor).slice(0, limit);
        });

        const result = await runKeyRotation({ tenantId: 'tenant-A', initiatedByUserId: 'admin', batchSize: 2 });

        const settings = result.perField.filter((f) => f.model === 'TenantSecuritySettings');
        expect(settings.length).toBeGreaterThan(0);
        expect(settings.reduce((n, f) => n + f.errors, 0)).toBe(0);
        // Every TenantSecuritySettings field that reads the table scans each row once.
        for (const f of settings) expect(f.scanned).toBe(3);
    });

    test('a probe that fails for any reason but a missing column fails the run (#5108)', async () => {
        tenantFindUnique.mockResolvedValueOnce({ encryptedDek: wrapDek(generateDek()) });
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('LIMIT 0')) throw new Error('Connection terminated unexpectedly');
            return [];
        });

        await expect(
            runKeyRotation({ tenantId: 'tenant-A', initiatedByUserId: 'admin' }),
        ).rejects.toThrow(/Connection terminated/);
    });

    test('the rewrite is conditional on the value read, and a row that moved on is not counted (#5109)', async () => {
        tenantFindUnique.mockResolvedValueOnce({ encryptedDek: wrapDek(generateDek()) });
        const old = encryptField('stale');
        let served = false;
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('LIMIT 0')) return [];
            if (!served && sql.includes("LIKE 'v1:%'")) {
                served = true;
                return [{ id: 'edited', value: old }];
            }
            return [];
        });
        // The user saved a new value after the SELECT: the guarded UPDATE
        // matches no row.
        executeRawUnsafe.mockResolvedValue(0);

        const result = await runKeyRotation({ tenantId: 'tenant-A', initiatedByUserId: 'admin' });

        const update = executeRawUnsafe.mock.calls.find(
            (c) => typeof c[0] === 'string' && c[0].includes('UPDATE'),
        )!;
        expect(update[0]).toMatch(/WHERE id = \$2 AND "\w+" = \$3$/);
        expect(update[3]).toBe(old);
        expect(result.totalRewritten).toBe(0);
        expect(result.totalErrors).toBe(0);
    });
});

describe('keyRotationOutcome (#5299)', () => {
    test('a clean sweep passes', () => {
        expect(keyRotationOutcome(0, true, undefined)).toEqual({ status: 'PASSED' });
    });

    test('row errors or a failed re-wrap fail the job', () => {
        expect(keyRotationOutcome(2, true, undefined)).toMatchObject({ status: 'ERROR' });
        const failedWrap = keyRotationOutcome(1, false, 'bad wrap');
        expect(failedWrap.status).toBe('ERROR');
        expect(failedWrap.errorMessage).toContain('bad wrap');
    });
});

/**
 * THE PII COLUMNS THE SWEEP USED TO SKIP (#5070).
 *
 * `pii-middleware` writes its own `*Encrypted` columns with v1 `encryptField`
 * and they are not in `ENCRYPTED_FIELDS`, so this sweep never saw them and
 * nothing else rewrote them. The runbook's "zero v1 rows, now remove
 * DATA_ENCRYPTION_KEY_PREVIOUS" was therefore true of the manifest and false
 * of the database, and the next read nulled every mapped PII field.
 */
describe('runKeyRotation — the PII columns (#5070)', () => {
    test('sweeps a TENANT-SCOPED PII column, by its physical column name', async () => {
        const dek = generateDek();
        tenantFindUnique.mockResolvedValueOnce({ encryptedDek: wrapDek(dek) });
        const selected: string[] = [];
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('LIMIT 0')) return [];
            if (sql.includes("LIKE 'v1:%'")) selected.push(sql);
            return [];
        });

        await runKeyRotation({ tenantId: 'tenant-A', initiatedByUserId: 'admin' });

        // The physical column, because the sweep is raw SQL. Islestone stores
        // the outbox recipient encrypted in place, so the column keeps the
        // field's name (`toEmail`); inflect-compliance's mapped models used a
        // `*Encrypted` column.
        const outbox = selected.filter(
            (sql) => sql.includes('"NotificationOutbox"') && sql.includes('"toEmail"'),
        );
        expect(outbox.length).toBeGreaterThan(0);
        // And it is scoped, or one tenant's rotation would rewrite another's.
        // Asserted as a derived boolean rather than `toContain` on an element
        // of a captured array: the subject is a binding the Class D ratchet
        // cannot resolve, so that form counts as an un-analysable read.
        const scoped = outbox.every((sql) => sql.includes('"tenantId" = $1'));
        expect({ scoped }).toEqual({ scoped: true });
    });

    test('does NOT try to sweep a global PII model per tenant', async () => {
        // `User` has no tenantId; a per-tenant SELECT against it would either
        // throw or, with a tenantId column added later, scope wrongly. The
        // job's own probe skips it, and that is why the global sweep exists.
        const dek = generateDek();
        tenantFindUnique.mockResolvedValueOnce({ encryptedDek: wrapDek(dek) });
        const selected: string[] = [];
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes('LIMIT 0')) return [];
            if (sql.includes("LIKE 'v1:%'")) selected.push(sql);
            return [];
        });

        await runKeyRotation({ tenantId: 'tenant-A', initiatedByUserId: 'admin' });

        expect(selected.filter((sql) => sql.includes('FROM "User"'))).toHaveLength(0);
        expect(selected.filter((sql) => sql.includes('FROM "Account"'))).toHaveLength(0);
    });
});

describe('rotateGlobalPiiColumns — the half a per-tenant job cannot do (#5070)', () => {
    test('sweeps User and Account with NO tenant predicate', async () => {
        const selected: string[] = [];
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes("LIKE 'v1:%'")) selected.push(sql);
            return [];
        });

        await rotateGlobalPiiColumns();

        expect(selected.filter((sql) => sql.includes('FROM "User"')).length)
            .toBeGreaterThan(0);
        expect(selected.filter((sql) => sql.includes('FROM "Account"')).length)
            .toBeGreaterThan(0);
        // The discriminator: a tenant predicate here would return nothing on a
        // table that has no such column, and the sweep would report a clean
        // zero — the same false "done" that #5070 is about.
        const anyTenantPredicate = selected.some((sql) => sql.includes('"tenantId"'));
        expect({ anyTenantPredicate }).toEqual({ anyTenantPredicate: false });
    });

    test('rewrites what it finds, under the current primary KEK', async () => {
        let served = false;
        queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (sql.includes("LIKE 'v1:%'") && !served) {
                served = true;
                return [{ id: 'u-1', value: encryptField('someone@example.com') }];
            }
            return [];
        });

        const out = await rotateGlobalPiiColumns();

        expect({ scanned: out.scanned, rewritten: out.rewritten, errors: out.errors })
            .toEqual({ scanned: 1, rewritten: 1, errors: 0 });
        const updates = executeRawUnsafe.mock.calls.filter(
            (c) => typeof c[0] === 'string' && c[0].includes('UPDATE'),
        );
        expect(updates.length).toBeGreaterThan(0);
        expect(isEncryptedValue(updates[0]?.[1] as string)).toBe(true);
    });
});
