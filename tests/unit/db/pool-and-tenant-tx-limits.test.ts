/**
 * The connection pool's limits and the tenant-context transaction's budget
 * are DECLARED, not inherited (inflect-compliance #2653, #3266).
 *
 * The defect this pins is not a wrong number — it is an ABSENT one. Left
 * alone, the product's supported concurrency is library defaults nobody has
 * written down (node-postgres `max: 10` and `connectionTimeoutMillis:
 * undefined`; Prisma `maxWait: 2000` and `timeout: 5000`), so the ceiling
 * moves with the host and the dependency version.
 *
 * So this suite asserts DECLARATION AT THE CALL SITE, not the presence of a
 * constant:
 *
 *   • `src/lib/prisma.ts`      → a recording `PrismaPg` double
 *   • `src/lib/db-context.ts`  → parsed: every `$transaction` gets a second
 *                                argument, and every `txOptions` starts from
 *                                `TENANT_TX_OPTIONS`
 *
 * Re-deriving a limit to another DECLARED value is free. Setting one back to
 * its inherited default reddens, and so does breaking a relation
 * (`connectionTimeoutMillis` must stay >= the largest `maxWait`).
 *
 * The audit append path's half of the source suite (`appendAuditEntry`'s own
 * transaction limits) is `audit-concurrency-limits.test.ts` (sub-phase 1.5);
 * the test-cleanup transaction's budget (`tests/helpers/audit-cleanup.ts`) is
 * asserted here, beside the tenant budget it spreads.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import ts from 'typescript';

// ─── Recording doubles for the Prisma boundary ────────────────────────
//
// Importing `src/lib/prisma.ts` builds a client at module scope, so the
// doubles must be registered before the import below.

interface RecordedPoolConfig {
    connectionString?: string;
    max?: number;
    connectionTimeoutMillis?: number;
}

/**
 * A function declaration, because it is hoisted: the doubles run while the
 * hoisted import of `src/lib/prisma.ts` evaluates, before any `const` in this
 * file is initialised.
 */
function poolConfigs(): RecordedPoolConfig[] {
    const holder = poolConfigs as unknown as { list?: RecordedPoolConfig[] };
    holder.list ??= [];
    return holder.list;
}

jest.mock('@prisma/adapter-pg', () => ({
    PrismaPg: class PrismaPg {
        constructor(cfg: RecordedPoolConfig) {
            poolConfigs().push(cfg);
        }
    },
}));

jest.mock('@prisma/client', () => ({
    PrismaClient: class PrismaClient {
        $on(): void {
            /* the slow-query listener is another suite's */
        }
        $extends(): this {
            return this;
        }
    },
}));

// The extension chain is not what this suite is about; an identity stub
// keeps the module load cheap and pointed at the adapter construction.
jest.mock('@/lib/db/rls-middleware', () => ({ withRlsTripwireExtension: <T>(c: T): T => c }));
// The 1.5 extensions, stubbed the same way: the PII extension reads
// `Prisma.dmmf` at module load, which the `@prisma/client` double lacks.
jest.mock('@/lib/security/pii-middleware', () => ({ withPiiEncryptionExtension: <T>(c: T): T => c }));
jest.mock('@/lib/db/encryption-middleware', () => ({ withEncryptionExtension: <T>(c: T): T => c }));

jest.mock('@/lib/observability/logger', () => ({
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Imported for the module-load side effect: constructing the client is
// what calls `new PrismaPg(...)`.
import '@/lib/prisma';

import {
    DB_POOL_CONNECTION_TIMEOUT_MS,
    DB_POOL_MAX,
    TENANT_TX_MAX_WAIT_MS,
    TENANT_TX_OPTIONS,
    TENANT_TX_TIMEOUT_MS,
} from '@/lib/db/concurrency-limits';

// ─── The defaults each limit had to displace ──────────────────────────
//
// node-postgres: `new Pool({...})` reports max 10, connectionTimeoutMillis
// undefined. Prisma: documented on `PrismaClientOptions.transactionOptions`.
const NODE_POSTGRES_DEFAULT_MAX = 10;
const PRISMA_DEFAULT_MAX_WAIT_MS = 2_000;
const PRISMA_DEFAULT_TX_TIMEOUT_MS = 5_000;

/** The pool config `src/lib/prisma.ts` actually handed to `PrismaPg`. */
function primaryPoolConfig(): RecordedPoolConfig {
    const cfg = poolConfigs()[0];
    if (!cfg) throw new Error('src/lib/prisma.ts constructed no PrismaPg adapter');
    return cfg;
}

describe('pool limits reach the PrismaPg call site', () => {
    it("declares `max`, displacing node-postgres's default of 10", () => {
        const cfg = primaryPoolConfig();
        expect(typeof cfg.max).toBe('number');
        expect(cfg.max).toBe(DB_POOL_MAX);
        // An inherited ceiling is the defect, so the declared value
        // must not merely restate the default it replaced.
        expect(cfg.max).not.toBe(NODE_POSTGRES_DEFAULT_MAX);
    });

    it('declares `connectionTimeoutMillis`, displacing "wait forever"', () => {
        const cfg = primaryPoolConfig();
        expect(cfg.connectionTimeoutMillis).toBe(DB_POOL_CONNECTION_TIMEOUT_MS);
        expect(cfg.connectionTimeoutMillis).toBeDefined();
        expect(Number.isFinite(cfg.connectionTimeoutMillis)).toBe(true);
    });

    it('still passes a connectionString — the build-time fallback is intact', () => {
        // `src/lib/prisma.ts` falls back to `''` so Next's "Collecting page
        // data" phase can import route modules without DATABASE_URL. Adding
        // pool options to the same object must not have displaced it.
        expect(primaryPoolConfig()).toHaveProperty('connectionString');
        expect(typeof primaryPoolConfig().connectionString).toBe('string');
    });
});

describe('#3266 — the tenant-context transaction declares its budget too', () => {
    it('`maxWait` actually displaces the inherited 2000 ms', () => {
        // A "declared" value equal to the default would satisfy a presence
        // check while changing nothing.
        expect(TENANT_TX_MAX_WAIT_MS).toBeGreaterThan(PRISMA_DEFAULT_MAX_WAIT_MS);
    });

    it('connectionTimeoutMillis >= maxWait, so the pool cannot preempt it', () => {
        // If node-postgres gives up first the declared budget is fiction and
        // the caller sees a pool error instead.
        expect(DB_POOL_CONNECTION_TIMEOUT_MS).toBeGreaterThanOrEqual(TENANT_TX_MAX_WAIT_MS);
    });

    it('`timeout` is STATED at Prisma’s default rather than inherited from it', () => {
        // Deliberately equal. The reason is not that the body has headroom
        // (inflect #4079 retired that claim): the observed overshoots were CI
        // contention, and a constant raised on that evidence would be a
        // production budget set by test parallelism. See the constant's
        // docblock, the one place the justification is written.
        expect(TENANT_TX_TIMEOUT_MS).toBe(PRISMA_DEFAULT_TX_TIMEOUT_MS);
    });

    it('EVERY `$transaction` in db-context.ts is given the DECLARED budget', () => {
        // Two claims, because the first alone is aimed one level off the
        // defect. The original bug was `const txOptions = {}` — an options
        // object that is PASSED and carries nothing. A check for "has a
        // second argument" is satisfied by exactly that.
        //
        // Parsed rather than grepped: a regex cannot tell a second ARGUMENT
        // from the identifier appearing in the comment above the call.
        const file = path.join(__dirname, '../../../src/lib/db-context.ts');
        const raw = fs.readFileSync(file, 'utf8');
        const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
        const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

        const bareCalls: number[] = [];
        const unbudgeted: number[] = [];
        let calls = 0;
        let declarations = 0;

        const visit = (n: ts.Node): void => {
            // (a) every `$transaction` receives a second argument at all
            if (
                ts.isCallExpression(n) &&
                ts.isPropertyAccessExpression(n.expression) &&
                n.expression.name.text === '$transaction'
            ) {
                calls += 1;
                if (n.arguments.length < 2) bareCalls.push(lineOf(n));
            }
            // (b) every `txOptions` starts FROM the declared budget, so an
            //     empty object cannot masquerade as a declared one
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'txOptions') {
                declarations += 1;
                const init = n.initializer;
                const spreadsBudget =
                    init !== undefined &&
                    ts.isObjectLiteralExpression(init) &&
                    init.properties.some(
                        (prop) =>
                            ts.isSpreadAssignment(prop) &&
                            ts.isIdentifier(prop.expression) &&
                            prop.expression.text === 'TENANT_TX_OPTIONS',
                    );
                if (!spreadsBudget) unbudgeted.push(lineOf(n));
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);

        // Denominators beside the results: a walker that found nothing would
        // report zero of both. withTenantDb, runInTenantContext,
        // runInTenantReadContext and runInTenantJobContext; the last three
        // build `txOptions`.
        expect(calls).toBeGreaterThanOrEqual(4);
        expect(declarations).toBeGreaterThanOrEqual(3);
        expect(bareCalls).toEqual([]);
        expect(unbudgeted).toEqual([]);
    });

    it('the TEST cleanup transaction declares it too — it is on the same pool', () => {
        // Why a src/ budget test reaches into tests/: the failure that opened
        // #3266 did not surface in src/. It surfaced as
        // `tests/integration/audit-hash-chain.test.ts` going red on an
        // assertion about chain validity, two tests away from the cleanup
        // that actually threw `Unable to start a transaction in the given
        // time`. The cleanup's rollback left the tampered rows in place and
        // the later test read them.
        //
        // That path runs through ONE helper, and it inherited the same
        // 2000 ms maxWait for the same reason db-context.ts did. Nothing else
        // in the repo asserts on it, so without this `it` a revert of the
        // helper is green here and comes back as a load-dependent flake in a
        // different file — the worst available failure mode, because the red
        // suite does not name the broken one.
        const file = path.join(__dirname, '../../helpers/audit-cleanup.ts');
        const raw = fs.readFileSync(file, 'utf8');
        const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);

        let fnFound = false;
        let budgetedCalls = 0;
        let bareCalls = 0;
        // The interface the helper types its client with. Narrowing it back to
        // a single parameter would make the budget un-passable, so the arity
        // is part of the claim rather than a detail the call site implies.
        let txParams = -1;

        const visit = (n: ts.Node): void => {
            if (
                ts.isFunctionDeclaration(n) &&
                n.name?.text === 'withAuditTriggersDisabled'
            ) {
                fnFound = true;
                const inner = (m: ts.Node): void => {
                    if (
                        ts.isCallExpression(m) &&
                        ts.isPropertyAccessExpression(m.expression) &&
                        m.expression.name.text === '$transaction'
                    ) {
                        const second = m.arguments[1];
                        const isBudget =
                            second !== undefined &&
                            ts.isIdentifier(second) &&
                            second.text === 'TENANT_TX_OPTIONS';
                        if (isBudget) budgetedCalls += 1;
                        else bareCalls += 1;
                    }
                    ts.forEachChild(m, inner);
                };
                ts.forEachChild(n, inner);
            }
            if (
                ts.isInterfaceDeclaration(n) &&
                n.name.text === 'RawSqlClient'
            ) {
                for (const member of n.members) {
                    if (
                        ts.isMethodSignature(member) &&
                        ts.isIdentifier(member.name) &&
                        member.name.text === '$transaction'
                    ) {
                        txParams = member.parameters.length;
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        visit(sf);

        // The denominator first: a renamed function or a moved file would
        // otherwise make every count below zero and pass silently.
        expect(fnFound).toBe(true);
        expect(budgetedCalls).toBe(1);
        expect(bareCalls).toBe(0);
        expect(txParams).toBeGreaterThanOrEqual(2);
    });

    it('the declared options are the ones the call sites spread', () => {
        expect(TENANT_TX_OPTIONS).toEqual({
            maxWait: TENANT_TX_MAX_WAIT_MS,
            timeout: TENANT_TX_TIMEOUT_MS,
        });
    });
});
