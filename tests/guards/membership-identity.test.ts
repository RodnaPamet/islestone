/**
 * Membership-Only Identity Guardrails
 *
 * Ensures that:
 *   1. The schema's `User` carries no `tenantId`, `role` or `tenant`
 *      relation, and `TenantMembership` carries `tenantId` and `role`:
 *      TenantMembership is the sole source of truth for the tenant/role
 *      binding.
 *   2. No code under src/ (population from git) reads `user.tenantId` /
 *      `user.role` or writes a role on a `User`.
 *
 * The "auth resolves identity from membership" half of the source guard reads
 * the NextAuth files and arrives with them in sub-phase 1.4.
 *
 * The last block runs both detectors on planted input.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import type { SchemaModel } from '../helpers/prisma-schema-models';
import { parseSchemaModels, parseSchemaModelsFrom } from '../helpers/prisma-schema-models';
import { codeOf } from '../helpers/source-blocks';

/** Islestone's roles (ADR 0006), for the "role written on a User" check. */
const ROLE_LITERAL = /role:\s*['"](?:OWNER|ADMIN|MEMBER|VIEWER|GUEST)['"]/;

function schemaProblems(models: readonly SchemaModel[]): string[] {
    const problems: string[] = [];
    const user = models.find((m) => m.name === 'User');
    const membership = models.find((m) => m.name === 'TenantMembership');
    if (!user) problems.push('no User model');
    if (!membership) problems.push('no TenantMembership model');
    if (user) {
        for (const f of ['tenantId', 'role', 'tenant']) {
            if (user.fields.some((x) => x.name === f)) problems.push(`User has ${f}`);
        }
    }
    if (membership) {
        for (const f of ['tenantId', 'role']) {
            if (!membership.fields.some((x) => x.name === f)) problems.push(`TenantMembership lacks ${f}`);
        }
    }
    return problems;
}

interface CodeReport {
    userRoleWrites: string[];
    userTenantIdReads: string[];
    userRoleReads: string[];
}

/**
 * Comments MASKED at the read seam: offsets and newlines survive, so the
 * `file:line` reports still point at the right line, and prose cannot fail
 * (or satisfy) a check.
 */
function codeProblems(root: string): CodeReport {
    const report: CodeReport = { userRoleWrites: [], userTenantIdReads: [], userRoleReads: [] };
    const files = gitFiles(root).filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel));
    for (const file of files) {
        const lines = codeOf(fs.readFileSync(path.join(root, file), 'utf-8')).split('\n');
        lines.forEach((line, i) => {
            const at = `${file}:${i + 1}`;
            // A User create/update/upsert that sets a role.
            if (
                /user\.(create|update|upsert)\s*\(/.test(line) &&
                ROLE_LITERAL.test(line) &&
                !/membership/i.test(file)
            ) {
                report.userRoleWrites.push(at);
            }
            // `.tenantId` on a variable named user/dbUser.
            if (/(?:user|dbUser)\.tenantId/.test(line) && !line.includes('session.user.tenantId')) {
                report.userTenantIdReads.push(at);
            }
            // `.role` on user/dbUser, but not a session or token claim.
            if (/(?:user|dbUser)\.role\b/.test(line) && !line.includes('session.user.role') && !line.includes('token.role')) {
                report.userRoleReads.push(at);
            }
        });
    }
    return report;
}

describe('Schema: identity is bound through TenantMembership', () => {
    it('User has no tenantId, role or tenant relation; TenantMembership has tenantId and role', () => {
        expect(schemaProblems(parseSchemaModels())).toEqual([]);
    });
});

describe('No code reads deprecated User.tenantId / User.role', () => {
    it('finds none in src/', () => {
        expect(codeProblems(REPO_ROOT)).toEqual({ userRoleWrites: [], userTenantIdReads: [], userRoleReads: [] });
    });
});

describe('the detectors, against planted input', () => {
    it('the schema check reports a User that carries the binding itself', () => {
        const planted = codeOf(
            [
                'model User {',
                '  id       String @id',
                '  tenantId String',
                '  role     Role',
                '  tenant   Tenant @relation(fields: [tenantId], references: [id])',
                '}',
                'model TenantMembership {',
                '  id     String @id',
                '  userId String',
                '}',
            ].join('\n'),
        );
        expect(schemaProblems(parseSchemaModelsFrom(planted))).toEqual([
            'User has tenantId',
            'User has role',
            'User has tenant',
            'TenantMembership lacks tenantId',
            'TenantMembership lacks role',
        ]);
    });

    describe('the code scan', () => {
        let root: string;

        beforeAll(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-membership-identity-'));
            execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
            const plant = (rel: string, content: string) => {
                fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
                fs.writeFileSync(path.join(root, rel), content);
            };
            plant(
                'src/lib/bad.ts',
                [
                    "await prisma.user.create({ data: { email: 'a', role: 'ADMIN' } });",
                    'const t = dbUser.tenantId;',
                    'const r = user.role;',
                    'const ok = session.user.role;',
                    '// user.tenantId in a comment is fine',
                ].join('\n'),
            );
        });

        afterAll(() => {
            fs.rmSync(root, { recursive: true, force: true });
        });

        it('reports each kind once, at its line', () => {
            expect(codeProblems(root)).toEqual({
                userRoleWrites: ['src/lib/bad.ts:1'],
                userTenantIdReads: ['src/lib/bad.ts:2'],
                userRoleReads: ['src/lib/bad.ts:3'],
            });
        });
    });
});
