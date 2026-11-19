/**
 * Every row-level-security policy the schema needs is created by a migration.
 *
 * The migrations are the ONLY apply path: `prisma migrate deploy` and every
 * fresh bootstrap run them and nothing else. A policy no migration creates is
 * absent from every environment. This guard needs no database: it reads the
 * migrations (population from git) with their comments blanked, and checks
 *
 *   • every TENANT_SCOPED_MODELS table (derived from the Prisma DMMF, so a new
 *     `tenantId` column enters the inventory by itself) has `tenant_isolation`,
 *     `superuser_bypass`, `tenant_isolation_insert` (direct-tenantId tables
 *     outside SINGLE_POLICY_EXCEPTIONS) and FORCE ROW LEVEL SECURITY;
 *   • every ORG_SCOPED_MODELS table has its named policy, `superuser_bypass`
 *     and FORCE.
 *
 * Its live twin, tests/integration/rls-coverage.test.ts, reads `pg_policies`
 * and also catches a policy a later migration dropped.
 *
 * The second half plants a repository with one table's policy missing and
 * shows the detector reports it, so the guard cannot pass by checking nothing.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Prisma } from '@prisma/client';

import { TENANT_SCOPED_MODELS } from '@/lib/db/rls-middleware';

import { gitEnvFor, REPO_ROOT } from '../helpers/git-files';
import {
    findMigrationPolicyGaps,
    hasCreatePolicy,
    migrationFiles,
    ORG_SCOPED_MODELS,
    readMigrationCode,
    SINGLE_POLICY_EXCEPTIONS,
} from '../helpers/rls-policies';

const DIRECT_TENANT_SCOPED = Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
    .map((m) => m.name);

describe('the migrations create every row-level-security policy the schema needs', () => {
    const sql = readMigrationCode(REPO_ROOT);

    it('reads the migration population from git, and it is not empty', () => {
        expect(migrationFiles(REPO_ROOT).length).toBeGreaterThan(0);
        expect(migrationFiles(REPO_ROOT)).toContain('prisma/migrations/20261119120000_tenancy_core/migration.sql');
    });

    it('the tenant inventory holds TenantMembership, and the org axis is disjoint from it', () => {
        expect(TENANT_SCOPED_MODELS.has('TenantMembership')).toBe(true);
        expect([...ORG_SCOPED_MODELS.keys()].filter((m) => TENANT_SCOPED_MODELS.has(m))).toEqual([]);
    });

    it('no tenant-scoped or org-scoped table lacks a policy or FORCE in the migrations', () => {
        expect(
            findMigrationPolicyGaps(sql, {
                tenantScoped: TENANT_SCOPED_MODELS,
                directTenantScoped: DIRECT_TENANT_SCOPED,
                orgScoped: ORG_SCOPED_MODELS,
                singlePolicyExceptions: SINGLE_POLICY_EXCEPTIONS,
            }),
        ).toEqual([]);
    });

    it('mutation regression — removing org_isolation from the migrations is detected', () => {
        // Proves the detector on known-bad input from the real migration text.
        const removed = sql.replace(/CREATE\s+POLICY\s+org_isolation\s+ON\s+"Organization"[\s\S]*?;/i, '');
        expect(removed).not.toBe(sql); // sanity — the source had it
        expect(hasCreatePolicy(removed, 'Organization', 'org_isolation')).toBe(false);
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;

    const plant = (files: Record<string, string>) => {
        for (const [rel, content] of Object.entries(files)) {
            const file = path.join(root, rel);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        }
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-rls-guard-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const expectations = {
        tenantScoped: ['Project', 'Label'],
        directTenantScoped: ['Project', 'Label'],
        orgScoped: new Map([['Organization', 'org_isolation']]),
    };

    const fullTable = (t: string) =>
        [
            `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`,
            `ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;`,
            `CREATE POLICY tenant_isolation ON "${t}" USING (true);`,
            `CREATE POLICY tenant_isolation_insert ON "${t}" FOR INSERT WITH CHECK (true);`,
            `CREATE POLICY superuser_bypass ON "${t}" USING (true);`,
        ].join('\n');

    it('reports each missing statement, across migrations, and ignores policies that exist only in comments', () => {
        plant({
            '.gitignore': 'ignored/\n',
            'prisma/migrations/1_a/migration.sql': fullTable('Project'),
            'prisma/migrations/2_b/migration.sql': [
                // Label: no insert policy, and its FORCE is only a comment.
                `CREATE POLICY tenant_isolation ON "Label" USING (true);`,
                `CREATE POLICY superuser_bypass ON "Label" USING (true);`,
                `-- ALTER TABLE "Label" FORCE ROW LEVEL SECURITY;`,
                `/* CREATE POLICY tenant_isolation_insert ON "Label" FOR INSERT WITH CHECK (true); */`,
                `ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;`,
                `CREATE POLICY superuser_bypass ON "Organization" USING (true);`,
            ].join('\n'),
            // Not a migration.sql: never read.
            'prisma/migrations/3_c/notes.sql': `CREATE POLICY org_isolation ON "Organization" USING (true);`,
            // Ignored by git: not part of the population.
            'ignored/prisma/migrations/4_d/migration.sql': `CREATE POLICY org_isolation ON "Organization" USING (true);`,
        });
        expect(migrationFiles(root)).toEqual(['prisma/migrations/1_a/migration.sql', 'prisma/migrations/2_b/migration.sql']);
        expect(findMigrationPolicyGaps(readMigrationCode(root), expectations)).toEqual([
            'CREATE POLICY tenant_isolation_insert ON "Label"',
            'ALTER TABLE "Label" FORCE ROW LEVEL SECURITY',
            'CREATE POLICY org_isolation ON "Organization"',
        ]);
    });

    it('accepts a single-policy exception without an insert policy, and nothing else', () => {
        plant({
            'prisma/migrations/1_a/migration.sql': [
                fullTable('Project'),
                `ALTER TABLE "Label" FORCE ROW LEVEL SECURITY;`,
                `CREATE POLICY tenant_isolation ON "Label" USING (true) WITH CHECK (true);`,
                `CREATE POLICY superuser_bypass ON "Label" USING (true);`,
                `ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;`,
                `CREATE POLICY org_isolation ON "Organization" USING (true);`,
                `CREATE POLICY superuser_bypass ON "Organization" USING (true);`,
            ].join('\n'),
        });
        const sql = readMigrationCode(root);
        expect(findMigrationPolicyGaps(sql, { ...expectations, singlePolicyExceptions: new Set(['Label']) })).toEqual([]);
        expect(findMigrationPolicyGaps(sql, expectations)).toEqual(['CREATE POLICY tenant_isolation_insert ON "Label"']);
    });
});
