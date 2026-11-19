/**
 * What the row-level-security guards expect, and the static detector that
 * checks the migrations for it. Shared by the DB-free guard
 * (tests/guards/rls-migration-policies.test.ts) and the live-database suite
 * (tests/integration/rls-coverage.test.ts), so the two never disagree about
 * which tables sit on which axis.
 *
 * Two isolation axes:
 *
 *   tenant axis   every TENANT_SCOPED_MODELS table (src/lib/db/rls-middleware,
 *                 derived from the Prisma DMMF): `tenant_isolation`,
 *                 `tenant_isolation_insert` (direct-tenantId tables outside
 *                 SINGLE_POLICY_EXCEPTIONS), `superuser_bypass`, FORCE.
 *   org axis      ORG_SCOPED_MODELS below, keyed on `app.user_id`: the named
 *                 isolation policy, `superuser_bypass`, FORCE.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { gitFiles } from './git-files';
import { sqlCodeOf } from './source-blocks';

/**
 * The organization layer's tables and the isolation policy each carries.
 * `Organization` and `OrgMembership` are user-scoped, NOT tenant-scoped (no
 * `tenantId` column): `org_isolation` is an EXISTS over the requester's own
 * membership, `org_membership_self_isolation` is `userId = app.user_id`.
 * A Map, so a future third org-scoped table can name its own policy.
 */
export const ORG_SCOPED_MODELS: ReadonlyMap<string, string> = new Map([
    ['Organization', 'org_isolation'],
    ['OrgMembership', 'org_membership_self_isolation'],
]);

/**
 * Direct-tenantId tables that use ONE asymmetric policy (USING permissive,
 * WITH CHECK strict) instead of the split `tenant_isolation_insert` form,
 * because a permissive INSERT sibling would OR with the USING and leak.
 * `UserSession` (nullable tenantId) joined it in sub-phase 1.4
 * as the first such table; the live suite verifies each entry really carries
 * both clauses.
 */
export const SINGLE_POLICY_EXCEPTIONS: ReadonlySet<string> = new Set<string>(['UserSession']);

/** The migration files of the repository at `root`, from git. */
export function migrationFiles(root: string): string[] {
    return gitFiles(root).filter((rel) => /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(rel));
}

/** Every migration's SQL with its comments blanked, so prose cannot satisfy a check. */
export function readMigrationCode(root: string): string {
    return migrationFiles(root)
        .map((rel) => sqlCodeOf(fs.readFileSync(path.join(root, rel), 'utf8')))
        .join('\n');
}

export function hasCreatePolicy(sql: string, model: string, policy: string): boolean {
    return new RegExp(`CREATE\\s+POLICY\\s+${policy}\\s+ON\\s+"${model}"`, 'i').test(sql);
}

export function hasForceRls(sql: string, model: string): boolean {
    return new RegExp(`ALTER\\s+TABLE\\s+"${model}"\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(sql);
}

export interface PolicyExpectations {
    /** TENANT_SCOPED_MODELS. */
    tenantScoped: Iterable<string>;
    /** The subset with a `tenantId` column (needs `tenant_isolation_insert`). */
    directTenantScoped: Iterable<string>;
    orgScoped: ReadonlyMap<string, string>;
    singlePolicyExceptions?: ReadonlySet<string>;
}

/**
 * Every policy or FORCE statement the expectations need that no migration
 * creates, as readable lines. Empty means the migrations cover them all.
 *
 * This reads CREATE statements only, so it does not see a later DROP; the
 * live suite (tests/integration/rls-coverage.test.ts) reads `pg_policies`
 * and closes that gap. This half runs with no database, so a table shipped
 * without its policies fails CI before any database exists.
 */
export function findMigrationPolicyGaps(sql: string, expected: PolicyExpectations): string[] {
    const gaps: string[] = [];
    const exceptions = expected.singlePolicyExceptions ?? new Set<string>();
    const direct = new Set(expected.directTenantScoped);
    for (const model of expected.tenantScoped) {
        for (const policy of ['tenant_isolation', 'superuser_bypass']) {
            if (!hasCreatePolicy(sql, model, policy)) gaps.push(`CREATE POLICY ${policy} ON "${model}"`);
        }
        if (direct.has(model) && !exceptions.has(model) && !hasCreatePolicy(sql, model, 'tenant_isolation_insert')) {
            gaps.push(`CREATE POLICY tenant_isolation_insert ON "${model}"`);
        }
        if (!hasForceRls(sql, model)) gaps.push(`ALTER TABLE "${model}" FORCE ROW LEVEL SECURITY`);
    }
    for (const [model, policy] of expected.orgScoped) {
        for (const p of [policy, 'superuser_bypass']) {
            if (!hasCreatePolicy(sql, model, p)) gaps.push(`CREATE POLICY ${p} ON "${model}"`);
        }
        if (!hasForceRls(sql, model)) gaps.push(`ALTER TABLE "${model}" FORCE ROW LEVEL SECURITY`);
    }
    return gaps;
}
