/**
 * RLS coverage must stay at 100% — the live-database half.
 *
 * This test is the ratchet that makes it impossible to silently add
 * a new tenant-scoped table without shipping a matching RLS
 * migration. Flow:
 *
 *   1. Compute the canonical tenant-scoped model set from
 *      `TENANT_SCOPED_MODELS` in `@/lib/db/rls-middleware` — that
 *      set itself is derived from the live Prisma DMMF, so any new
 *      `tenantId` column automatically enters the inventory.
 *   2. Query `pg_policies` against the live database and pg_tables
 *      for `forcerowsecurity = true`.
 *   3. Assert set equality:
 *        - Every tenant-scoped table has BOTH a `tenant_isolation`
 *          AND a `superuser_bypass` policy.
 *        - Every tenant-scoped table has `FORCE ROW LEVEL SECURITY`
 *          enabled.
 *
 *   4. Assert `app_user` holds SELECT/INSERT/UPDATE/DELETE on every
 *      tenant- and org-scoped table: RLS on a table app_user cannot
 *      read is a 500, not isolation, and default privileges do not
 *      cover tables created by another role.
 *
 * If a new model with `tenantId` lands in the schema without a
 * matching RLS migration, this test fails with the exact model name
 * in the error message. Its DB-free twin,
 * tests/guards/rls-migration-policies.test.ts, reads the migrations.
 *
 * This test REQUIRES the live Postgres with migrations applied.
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { TENANT_SCOPED_MODELS } from '@/lib/db/rls-middleware';

import { prismaTestClient } from '../helpers/db';
import { ORG_SCOPED_MODELS, SINGLE_POLICY_EXCEPTIONS } from '../helpers/rls-policies';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

/** Tenant tables app_user may only read and append to (sub-phase 1.5). */
const APPEND_ONLY_TABLES: readonly string[] = ['AuditLog'];

/**
 * Tenant tables app_user may only read (sub-phase 2.5a): their one writer is a
 * SECURITY DEFINER trigger, so no request can forge, change or remove a row.
 */
const READ_ONLY_TABLES: readonly string[] = ['WorkItemTransition'];

/**
 * Tenant tables app_user may read, insert and update but never delete
 * (sub-phase 1.6): the application never deletes an outbox row or a settings
 * row; a workspace purge cascades as the table owner.
 */
const NO_DELETE_TABLES: readonly string[] = [
    'NotificationOutbox',
    'TenantNotificationSettings',
    // Sub-phases 2.1–2.2: key bookkeeping is never pruned (prefixes and
    // numbers are never reused; old keys keep resolving).
    'ProjectKeyPrefix',
    'ProjectKeySequence',
    'WorkItemKeyAlias',
];

describeFn('Guardrail: RLS coverage (pg_policies ↔ schema)', () => {
    let prisma: PrismaClient;
    let policies: Array<{
        tablename: string;
        policyname: string;
        cmd: string;
        // `qual` is the USING expression; `with_check` is the
        // WITH CHECK expression. Both come back as raw SQL strings or
        // null when the clause was omitted at CREATE POLICY time. We
        // lift them out of pg_catalog so the SINGLE_POLICY_EXCEPTIONS
        // sanity check can verify the asymmetric shape is real, not
        // just that the policy name exists.
        qual: string | null;
        with_check: string | null;
    }>;
    let forcedTables: Set<string>;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();

        policies = await prisma.$queryRawUnsafe<typeof policies>(`
            SELECT tablename, policyname, cmd, qual, with_check
            FROM pg_policies
            WHERE schemaname = 'public'
        `);

        const forced = await prisma.$queryRawUnsafe<
            Array<{ tablename: string }>
        >(`
            SELECT c.relname AS tablename
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND c.relforcerowsecurity = true
        `);
        forcedTables = new Set(forced.map((r) => r.tablename));
    });


    function policiesFor(table: string): string[] {
        return policies
            .filter((p) => p.tablename === table)
            .map((p) => p.policyname);
    }

    test('every tenant-scoped model has a tenant_isolation policy', () => {
        const missing: string[] = [];
        for (const model of TENANT_SCOPED_MODELS) {
            const names = policiesFor(model);
            if (!names.includes('tenant_isolation')) {
                missing.push(model);
            }
        }

        if (missing.length > 0) {
            throw new Error(
                `RLS coverage gap — ${missing.length} tenant-scoped model(s) lack a ` +
                    `'tenant_isolation' policy. Ship a migration that adds ` +
                    `'CREATE POLICY tenant_isolation' for each:\n  ` +
                    missing.join('\n  ') +
                    `\n\nSee prisma/migrations/20261119120000_tenancy_core/migration.sql ` +
                    `for the canonical policy shape (docs/rls-tenant-isolation.md).`
            );
        }
    });

    test('every tenant-scoped model has a superuser_bypass policy', () => {
        const missing: string[] = [];
        for (const model of TENANT_SCOPED_MODELS) {
            const names = policiesFor(model);
            if (!names.includes('superuser_bypass')) {
                missing.push(model);
            }
        }

        if (missing.length > 0) {
            throw new Error(
                `Superuser bypass gap — ${missing.length} tenant-scoped model(s) lack a ` +
                    `'superuser_bypass' policy. Without it, migrations and seeds ` +
                    `will be blocked by FORCE ROW LEVEL SECURITY. Ship a ` +
                    `migration adding:\n  ` +
                    missing.map((m) => `'${m}'`).join(', ') +
                    `\n\nCanonical: superuser_bypass USING (current_setting('role') != 'app_user')`
            );
        }
    });

    // The NAME alone proves nothing: LegacyMatchVerdict once carried a
    // `superuser_bypass` keyed on an unset `app.tenant_id`, which admitted an
    // app_user session with no tenant bound to every tenant's rows (#5314).
    // The bypass must be keyed on the ROLE, and nothing else.
    test('every superuser_bypass policy is keyed on the role, in the canonical shape', () => {
        const CANONICAL = "(current_setting('role'::text) <> 'app_user'::text)";
        const offenders = policies
            .filter((p) => p.policyname === 'superuser_bypass')
            .filter((p) => p.qual !== CANONICAL || p.with_check !== null)
            .map((p) => `${p.tablename}: USING ${p.qual} WITH CHECK ${p.with_check}`);
        expect(offenders).toEqual([]);
    });

    test('every tenant-scoped model has FORCE ROW LEVEL SECURITY enabled', () => {
        const missing: string[] = [];
        for (const model of TENANT_SCOPED_MODELS) {
            if (!forcedTables.has(model)) {
                missing.push(model);
            }
        }

        if (missing.length > 0) {
            throw new Error(
                `FORCE RLS gap — ${missing.length} tenant-scoped model(s) are not ` +
                    `FORCING ROW LEVEL SECURITY. Without FORCE, the table owner ` +
                    `(postgres) bypasses RLS policies unconditionally — which ` +
                    `defeats the superuser_bypass role-switching design. ` +
                    `Ship a migration adding:\n  ` +
                    missing.map((m) => `ALTER TABLE "${m}" FORCE ROW LEVEL SECURITY;`).join('\n  ')
            );
        }
    });

    test('tenant-scoped tables with direct tenantId also carry tenant_isolation_insert', () => {
        // Class-A direct-scoped tables have a dedicated INSERT policy.
        // Class-E ownership-chained tables use a single permissive
        // policy with USING + WITH CHECK; they legitimately lack a
        // separate _insert policy. We only require it for tables that
        // also have a Prisma-level `tenantId` scalar.
        //
        // KNOWN EXCEPTIONS — tables that intentionally use the single-
        // policy form (USING + WITH CHECK on one policy), where a split
        // INSERT policy would leak via permissive-OR. The list lives in
        // tests/helpers/rls-policies.ts and is empty in sub-phase 1.3;
        // `UserSession` (nullable tenantId) is the first, in 1.4.
        const directScoped = new Set<string>(
            Prisma.dmmf.datamodel.models
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .filter((m: any) => m.fields.some((f: any) => f.name === 'tenantId'))
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((m: any) => m.name)
        );

        const missing: string[] = [];
        for (const model of directScoped) {
            if (SINGLE_POLICY_EXCEPTIONS.has(model)) continue;
            const names = policiesFor(model);
            if (!names.includes('tenant_isolation_insert')) {
                missing.push(model);
            }
        }

        if (missing.length > 0) {
            throw new Error(
                `INSERT-protection gap — ${missing.length} direct-tenantId model(s) ` +
                    `have no 'tenant_isolation_insert' FOR INSERT WITH CHECK policy. ` +
                    `Without it, a tenant running under app_user could insert a row ` +
                    `carrying another tenant's id. Ship a migration adding:\n  ` +
                    missing.join('\n  ') +
                    `\n\nIf this model legitimately uses the single-policy form ` +
                    `(USING + WITH CHECK on one policy, for asymmetric semantics), ` +
                    `add it to SINGLE_POLICY_EXCEPTIONS in tests/helpers/rls-policies.ts.`
            );
        }

        // Sanity check — the exceptions list must still exist as
        // tenant-scoped tables AND each one's `tenant_isolation`
        // policy must actually carry BOTH a USING (qual) and a
        // WITH CHECK clause. That is the entire reason the table is
        // exempt from the split-policy rule; if a future migration
        // "simplifies" the policy back to USING-only or WITH CHECK-
        // only, the asymmetric-semantics guarantee evaporates and the
        // exception is no longer load-bearing.
        for (const exception of SINGLE_POLICY_EXCEPTIONS) {
            expect(TENANT_SCOPED_MODELS.has(exception)).toBe(true);

            const isolation = policies.find(
                (p) =>
                    p.tablename === exception &&
                    p.policyname === 'tenant_isolation',
            );
            expect(isolation).toBeDefined();
            if (!isolation) continue;

            // Both clauses must be non-null — that's what makes the
            // single-policy form safer than a permissive split.
            if (!isolation.qual || !isolation.with_check) {
                throw new Error(
                    `Single-policy exception '${exception}' lost its asymmetric ` +
                        `USING + WITH CHECK shape — qual=${JSON.stringify(isolation.qual)} ` +
                        `with_check=${JSON.stringify(isolation.with_check)}.\n\n` +
                        `Either restore the policy to the canonical form\n` +
                        `  CREATE POLICY tenant_isolation ON "${exception}"\n` +
                        `      USING (... permissive read filter ...)\n` +
                        `      WITH CHECK (... strict write filter ...);\n` +
                        `or remove '${exception}' from SINGLE_POLICY_EXCEPTIONS in ` +
                        `tests/helpers/rls-policies.ts and add the dedicated ` +
                        `tenant_isolation_insert policy via a new migration.`,
                );
            }
        }
    });

    test('the guardrail inventory is exactly the tenant tables that exist', () => {
        // Defence against the inventory collapsing to zero (if the DMMF
        // enumeration broke, every check above would pass over nothing).
        // An exact list, ratcheted up as tenant tables land.
        expect([...TENANT_SCOPED_MODELS].sort()).toEqual([
            'AuditLog',
            'AuditOutbox',
            'Comment',
            'CustomField',
            'CustomFieldOption',
            'CustomFieldValue',
            'Label',
            'Notification',
            'NotificationOutbox',
            'Project',
            'ProjectKeyPrefix',
            'ProjectKeySequence',
            'SavedView',
            'Team',
            'TenantCustomRole',
            'TenantInvite',
            'TenantMembership',
            'TenantNotificationSettings',
            'TenantSecuritySettings',
            'UserMfaEnrollment',
            'UserSession',
            'WorkItem',
            'WorkItemKeyAlias',
            'WorkItemLabel',
            'WorkItemLink',
            'WorkItemRelation',
            'WorkItemType',
            'WorkItemWatcher',
            'WorkflowState',
        ]);
    });

    test('app_user holds SELECT, INSERT, UPDATE and DELETE on every tenant- and org-scoped table', async () => {
        // RLS on a table app_user cannot read is a 500, not isolation.
        // ALTER DEFAULT PRIVILEGES covers only tables later created by the
        // role that ran it, so every migration that creates a table grants
        // it explicitly; this is the check that it did. The append-only audit
        // trail is the exception: SELECT and INSERT, asserted in the next test.
        const tables = [...TENANT_SCOPED_MODELS, ...ORG_SCOPED_MODELS.keys()].filter(
            (t) => !APPEND_ONLY_TABLES.includes(t) && !READ_ONLY_TABLES.includes(t),
        );
        const missing: string[] = [];
        for (const table of tables) {
            const wanted = NO_DELETE_TABLES.includes(table)
                ? ['SELECT', 'INSERT', 'UPDATE']
                : ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
            for (const privilege of wanted) {
                const [row] = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
                    `SELECT has_table_privilege('app_user', $1, $2) AS ok`,
                    `"${table}"`,
                    privilege,
                );
                if (!row?.ok) missing.push(`${privilege} ON "${table}"`);
            }
        }
        expect(missing).toEqual([]);
    });

    test('app_user holds no DELETE or TRUNCATE on the outbox and the notification settings', async () => {
        const held: string[] = [];
        for (const table of NO_DELETE_TABLES) {
            for (const privilege of ['DELETE', 'TRUNCATE']) {
                const [row] = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
                    `SELECT has_table_privilege('app_user', $1, $2) AS ok`,
                    `"${table}"`,
                    privilege,
                );
                if (row?.ok) held.push(`${privilege} ON "${table}"`);
            }
        }
        expect(held).toEqual([]);
    });

    test('app_user holds SELECT, and nothing more, on the trigger-written tables', async () => {
        const held: string[] = [];
        for (const table of READ_ONLY_TABLES) {
            for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
                const [row] = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
                    `SELECT has_table_privilege('app_user', $1, $2) AS ok`,
                    `"${table}"`,
                    privilege,
                );
                if (row?.ok) held.push(`${privilege} ON "${table}"`);
            }
        }
        expect(held).toEqual(READ_ONLY_TABLES.map((t) => `SELECT ON "${t}"`));
    });

    test('app_user holds SELECT and INSERT, and nothing more, on the append-only audit trails', async () => {
        // Sub-phase 1.5: the trails are append-only by privilege as well as
        // by trigger. A GRANT of UPDATE, DELETE or TRUNCATE would let a tenant
        // request reach a row the trigger is the only thing refusing.
        const held: string[] = [];
        for (const table of [...APPEND_ONLY_TABLES, 'OrgAuditLog']) {
            for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
                const [row] = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
                    `SELECT has_table_privilege('app_user', $1, $2) AS ok`,
                    `"${table}"`,
                    privilege,
                );
                if (row?.ok) held.push(`${privilege} ON "${table}"`);
            }
        }
        expect(held.sort()).toEqual(
            ['INSERT ON "AuditLog"', 'INSERT ON "OrgAuditLog"', 'SELECT ON "AuditLog"', 'SELECT ON "OrgAuditLog"'],
        );
    });

    test('no tenant-scoped table carries the deprecated allow_all policy', () => {
        // `allow_all` was the USING(true) WITH CHECK(true) stopgap for
        // ownership-chained tables before they got EXISTS policies. It's
        // zero isolation. The coverage migration dropped them; this test
        // stops them from sneaking back via a clumsy merge.
        const violators = policies.filter((p) => p.policyname === 'allow_all');
        if (violators.length > 0) {
            throw new Error(
                `allow_all policies detected — these provide ZERO tenant ` +
                    `isolation and must be replaced with EXISTS-based policies:\n  ` +
                    violators.map((p) => `${p.tablename}.${p.policyname}`).join('\n  ')
            );
        }
    });

    // ─── Organization-layer RLS ────────────────────────────────────

    test('every org-scoped model has its named isolation policy', () => {
        const missing: Array<{ model: string; policy: string }> = [];
        for (const [model, expectedPolicy] of ORG_SCOPED_MODELS) {
            const names = policiesFor(model);
            if (!names.includes(expectedPolicy)) {
                missing.push({ model, policy: expectedPolicy });
            }
        }
        if (missing.length > 0) {
            throw new Error(
                `Org-layer RLS gap — ${missing.length} org-scoped model(s) lack ` +
                    `their isolation policy. Ship/restore the relevant CREATE ` +
                    `POLICY (prisma/migrations/20261119120000_tenancy_core):\n  ` +
                    missing
                        .map((m) => `${m.model} → policy '${m.policy}'`)
                        .join('\n  '),
            );
        }
    });

    test('every org-scoped model has a superuser_bypass policy', () => {
        const missing: string[] = [];
        for (const model of ORG_SCOPED_MODELS.keys()) {
            const names = policiesFor(model);
            if (!names.includes('superuser_bypass')) {
                missing.push(model);
            }
        }
        if (missing.length > 0) {
            throw new Error(
                `Org-layer superuser_bypass gap — ${missing.length} model(s) lack ` +
                    `'superuser_bypass'. Without it, the org-create API, auto-` +
                    `provisioning service, seeds, and migrations are blocked by ` +
                    `FORCE ROW LEVEL SECURITY. Add to each:\n  ` +
                    missing.map((m) => `'${m}'`).join(', ') +
                    `\n\nCanonical: superuser_bypass USING (current_setting('role') != 'app_user')`,
            );
        }
    });

    test('every org-scoped model has FORCE ROW LEVEL SECURITY enabled', () => {
        const missing: string[] = [];
        for (const model of ORG_SCOPED_MODELS.keys()) {
            if (!forcedTables.has(model)) {
                missing.push(model);
            }
        }
        if (missing.length > 0) {
            throw new Error(
                `Org-layer FORCE RLS gap — ${missing.length} org-scoped table(s) ` +
                    `aren't FORCING RLS. Without FORCE, the table owner ` +
                    `(postgres) bypasses RLS unconditionally and the bypass-by-` +
                    `role design collapses. Ship:\n  ` +
                    missing
                        .map((m) => `ALTER TABLE "${m}" FORCE ROW LEVEL SECURITY;`)
                        .join('\n  '),
            );
        }
    });

    test('org-scoped and tenant-scoped sets are disjoint', () => {
        // Two different isolation axes — a model being on both lists
        // would mean its policies are keyed on both `app.tenant_id`
        // AND `app.user_id`, which Postgres OR's together permissively
        // and weakens the guarantee of either. If a future model
        // legitimately needs both axes, that's a deliberate hybrid
        // design and should land its own policy strategy + test.
        const overlap: string[] = [];
        for (const model of ORG_SCOPED_MODELS.keys()) {
            if (TENANT_SCOPED_MODELS.has(model)) {
                overlap.push(model);
            }
        }
        if (overlap.length > 0) {
            throw new Error(
                `Isolation-axis overlap — ${overlap.length} model(s) appear in ` +
                    `BOTH ORG_SCOPED_MODELS and TENANT_SCOPED_MODELS:\n  ` +
                    overlap.join('\n  ') +
                    `\n\nThis is almost certainly an accident — the two axes are ` +
                    `keyed on different session variables (app.user_id vs ` +
                    `app.tenant_id) and combining them via Postgres's permissive ` +
                    `OR weakens both. Pick one axis per model.`,
            );
        }
    });

    test('ORG_SCOPED_MODELS sanity: every named policy actually carries a USING clause', () => {
        // Defence-in-depth — if a "simplification" PR drops the USING
        // clause from an org-isolation policy and replaces it with
        // USING(true), the named-policy presence assertion above still
        // passes but the isolation property is gone. Assert non-null
        // qual on every named org policy so that path is closed.
        const broken: Array<{ model: string; policy: string }> = [];
        for (const [model, expectedPolicy] of ORG_SCOPED_MODELS) {
            const row = policies.find(
                (p) => p.tablename === model && p.policyname === expectedPolicy,
            );
            if (!row) continue; // missing-policy is caught by the prior test
            if (!row.qual || row.qual.trim() === 'true') {
                broken.push({ model, policy: expectedPolicy });
            }
        }
        if (broken.length > 0) {
            throw new Error(
                `Org-layer USING-clause gap — ${broken.length} policy(ies) lost ` +
                    `their isolation predicate (USING null or true):\n  ` +
                    broken
                        .map((b) => `${b.model}.${b.policy}`)
                        .join('\n  ') +
                    `\n\nRestore the canonical EXISTS / userId predicate from ` +
                    `prisma/migrations/20261119120000_tenancy_core.`,
            );
        }
    });
});
