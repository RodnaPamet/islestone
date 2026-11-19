/**
 * CI Regression Guard: the global Prisma client stays out of the layers that
 * must go through a tenant context.
 *
 * This test scans source files (population from git, recursive) and FAILS if:
 * - a repository (src/app-layer/repositories/**) imports the global prisma
 *   client: repositories take the transaction client they are handed;
 * - a usecase (src/app-layer/usecases/**) imports the global prisma client:
 *   usecases open `runInTenantContext` so RLS applies;
 * - a usecase calls the lower-level `withTenantDb(` instead of
 *   `runInTenantContext`;
 * - a route handler (src/app/api/**\/route.ts) calls `prisma.x`, `logAudit(`
 *   or `requireRole(` directly: data access belongs in usecases, auditing in
 *   usecases/events, authorisation in policies.
 *
 * Each allowlist entry carries its written reason, and comes back in the
 * sub-phase that ports the file that needs it (sub-phase 1.4 brought the
 * sign-in, MFA, invite and org-invite usecases and the `/api/auth/*`
 * routes, which run before any tenant context exists).
 *
 * The last block plants a repository with one violation of each kind and
 * shows each is reported, so the guard cannot pass by checking nothing.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

/** Repositories that may import the global client. */
const REPO_ALLOWLIST: readonly string[] = [];
/** Usecases that may import the global client. */
const USECASE_ALLOWLIST: readonly string[] = [
    // Sub-phase 1.4 (docs/porting/maps/1.4.md, "RLS", item 3; the parent's
    // list in `tests/unit/no-direct-prisma.test.ts`). Each reads or writes
    // outside a tenant context, as inflect-compliance does:
    //  - the MFA usecases: the challenge runs while the session is still
    //    MFA-pending, before `getTenantCtx` admits it, and the enrolment
    //    reads the person's own rows across workspaces;
    'mfa.ts',
    'mfa-enrollment.ts',
    'mfa-challenge.ts',
    //  - session revocation: `UserSession` rows are the person's, across
    //    workspaces (tenantId is nullable), and revoke-all stamps every one;
    'session-security.ts',
    //  - invite redemption and preview: the redeemer is not yet a member of
    //    the tenant, so there is no tenant context to run in;
    'tenant-invites.ts',
    //  - org invites and provisioning: Organization, OrgMembership and
    //    OrgInvite are org-scoped, not tenant-scoped, and the provisioning
    //    fans ADMIN rows out to every tenant under the org by design.
    'org-invites.ts',
    'org-provisioning.ts',
];
/** Usecases that may call `withTenantDb(` (a job with a raw tenantId, a cross-tenant fan-out). */
const WITH_TENANT_DB_ALLOWLIST: readonly string[] = [];
/** Route directories (path segments under src/app/api) exempt from the route rules. */
const ROUTE_DIR_ALLOWLIST: readonly string[] = [
    // `/api/auth/*` (sub-phase 1.4): register, me and verify-email/resend read
    // the user and create the first workspace before any tenant context or
    // usecase layer applies, as inflect-compliance's do (its list names
    // 'auth' too). A later sub-phase that moves them into usecases removes
    // this entry.
    'auth',
];

const GLOBAL_PRISMA_IMPORT = /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*)['"](?:@\/lib\/prisma|(?:\.\.?\/)+(?:[\w-]+\/)*lib\/prisma)['"]/;

function nonCommentLines(content: string): string[] {
    return content.split('\n').filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    });
}

interface Report {
    repositories: string[];
    usecases: string[];
    repositoriesImportingPrisma: string[];
    usecasesImportingPrisma: string[];
    usecasesCallingWithTenantDb: string[];
    routes: string[];
    routesCallingPrisma: string[];
    routesCallingLogAudit: string[];
    routesCallingRequireRole: string[];
}

function check(root: string): Report {
    const files = gitFiles(root);
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
    const base = (rel: string) => path.posix.basename(rel);

    const repositories = files.filter((f) => /^src\/app-layer\/repositories\/.+\.ts$/.test(f));
    const usecases = files.filter((f) => /^src\/app-layer\/usecases\/.+\.ts$/.test(f));
    const routes = files
        .filter((f) => /^src\/app\/api\/(?:.+\/)?route\.ts$/.test(f))
        .filter((f) => !f.split('/').some((seg) => ROUTE_DIR_ALLOWLIST.includes(seg)));

    const importsPrisma = (rel: string) => nonCommentLines(read(rel)).some((line) => GLOBAL_PRISMA_IMPORT.test(line));
    const routeLines = (rel: string, re: RegExp) => nonCommentLines(read(rel)).some((line) => re.test(line));

    return {
        repositories,
        usecases,
        repositoriesImportingPrisma: repositories.filter((f) => !REPO_ALLOWLIST.includes(base(f))).filter(importsPrisma),
        usecasesImportingPrisma: usecases.filter((f) => !USECASE_ALLOWLIST.includes(base(f))).filter(importsPrisma),
        usecasesCallingWithTenantDb: usecases
            .filter((f) => !WITH_TENANT_DB_ALLOWLIST.includes(base(f)))
            .filter((f) => read(f).includes('withTenantDb(')),
        routes,
        routesCallingPrisma: routes.filter((f) =>
            nonCommentLines(read(f)).some(
                (line) => /\bprisma\.\w+\b/.test(line) && !line.includes('customPrisma') && !line.includes('globalPrisma'),
            ),
        ),
        routesCallingLogAudit: routes.filter((f) => routeLines(f, /\blogAudit\s*\(/)),
        routesCallingRequireRole: routes.filter((f) => routeLines(f, /\brequireRole\s*\(/)),
    };
}

describe('CI Guard: No direct prisma in tenant-scoped code', () => {
    const report = check(REPO_ROOT);

    it('reads its populations from git (the two owner locks and the health routes today)', () => {
        expect(report.usecases).toEqual(
            expect.arrayContaining([
                'src/app-layer/usecases/org-owner-lock.ts',
                'src/app-layer/usecases/tenant-owner-lock.ts',
            ]),
        );
        expect(report.routes).toEqual(expect.arrayContaining(['src/app/api/livez/route.ts', 'src/app/api/readyz/route.ts']));
    });

    it('no repository imports the global prisma client', () => {
        expect(report.repositoriesImportingPrisma).toEqual([]);
    });

    it('no usecase imports the global prisma client', () => {
        expect(report.usecasesImportingPrisma).toEqual([]);
    });

    it('no usecase calls withTenantDb( instead of runInTenantContext', () => {
        expect(report.usecasesCallingWithTenantDb).toEqual([]);
    });

    it('no route handler calls prisma, logAudit or requireRole directly', () => {
        expect({
            prisma: report.routesCallingPrisma,
            logAudit: report.routesCallingLogAudit,
            requireRole: report.routesCallingRequireRole,
        }).toEqual({ prisma: [], logAudit: [], requireRole: [] });
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

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-no-direct-prisma-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        plant({
            '.gitignore': 'src/app-layer/usecases/ignored/\n',
            // Nested two levels deep: the source guard read only the top level.
            'src/app-layer/repositories/work/ProjectRepository.ts': "import prisma from '@/lib/prisma';\nexport const r = prisma;\n",
            'src/app-layer/repositories/CleanRepository.ts': "import type { PrismaTx } from '@/lib/db-context';\nexport type T = PrismaTx;\n",
            'src/app-layer/usecases/projects.ts': "import { prisma } from \"../../lib/prisma\";\nexport const u = prisma;\n",
            'src/app-layer/usecases/jobs/digest.ts': "import { withTenantDb } from '@/lib/db-context';\nexport const d = () => withTenantDb('t', async () => 1);\n",
            'src/app-layer/usecases/clean.ts': "// import prisma from '@/lib/prisma';\nimport { runInTenantContext } from '@/lib/db-context';\nexport const c = runInTenantContext;\n",
            'src/app-layer/usecases/ignored/skip.ts': "import prisma from '@/lib/prisma';\nexport const s = prisma;\n",
            'src/app/api/t/[tenantSlug]/projects/route.ts': [
                'export async function GET() {',
                '    const rows = await prisma.project.findMany();',
                "    logAudit('x');",
                "    requireRole('ADMIN');",
                '    return Response.json(rows);',
                '}',
            ].join('\n'),
            'src/app/api/livez/route.ts': 'export const GET = () => new Response();\n',
        });
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reports one violation of each kind, and only those', () => {
        const r = check(root);
        expect(r.repositoriesImportingPrisma).toEqual(['src/app-layer/repositories/work/ProjectRepository.ts']);
        expect(r.usecasesImportingPrisma).toEqual(['src/app-layer/usecases/projects.ts']);
        expect(r.usecasesCallingWithTenantDb).toEqual(['src/app-layer/usecases/jobs/digest.ts']);
        const route = 'src/app/api/t/[tenantSlug]/projects/route.ts';
        expect([r.routesCallingPrisma, r.routesCallingLogAudit, r.routesCallingRequireRole]).toEqual([[route], [route], [route]]);
        expect(r.usecases).not.toContain('src/app-layer/usecases/ignored/skip.ts');
    });
});
