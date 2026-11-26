/**
 * Structural guardrails for tenant/scope isolation.
 *
 * These checks scan `src/` (population from git) and FAIL if:
 * 1. `session.tenantId` is used anywhere: the tenant comes from the URL's
 *    slug and the user's membership (`getTenantCtx`), never from a session
 *    claim. No file is allowlisted.
 * 2. A page exists outside /t/[tenantSlug] and the root allowlist.
 * 3. An API route exists outside /api/t/[tenantSlug] and the API allowlist.
 * 4. A page under /t/[tenantSlug] calls `fetch('/api/...')` with a flat path
 *    instead of the tenant-scoped URL helper.
 *
 * Each allowlist entry carries its reason; a new entry is added, with its
 * reason, in the sub-phase that creates the page or route.
 *
 * The last block plants a repository with one violation of each kind and
 * shows each is reported, so the guard cannot pass by checking nothing.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

/** Root-level entries of src/app that may hold pages outside /t/. */
const ALLOWED_ROOT_PAGES = new Set([
    'page.tsx', // Root page (placeholder home today; later the redirector to /t/<slug>)
    'layout.tsx', // Root layout
    'not-found.tsx', // 404 page
    'error.tsx', // Error boundary
    'global-error.tsx', // Global error boundary
    // The shared-UI gallery (sub-phase 1.2): static primitives with sample
    // data, no tenant data and no data access, so it needs no workspace.
    'gallery',
    // Sub-phase 1.4: the pages a person reaches before, or outside, any one
    // workspace. Each reads only the signed-in person's own rows, or nothing.
    'login', // Sign in and register
    'forgot-password', // Password-reset request (public)
    'reset-password', // Password-reset confirm, from an emailed token (public)
    'invite', // Invite preview, acceptance and result (public preview)
    'no-tenant', // Landing for a person with no workspace
    'tenants', // The workspace picker: the person's own memberships
    'account', // The person's own profile and password, account-wide
    // Sub-phase 2.6b: a public intake form (`/f/<publicId>`) and a requester's
    // confirmation page (`/f/confirm/<token>`). Reached with no session; the
    // form resolves its workspace from its random public id alone
    // (`resolvePublicIntakeForm`), and the confirmation page reads nothing.
    'f',
]);

/** Top-level directories of src/app/api that may hold routes outside /api/t/. */
const ALLOWED_API_DIRS = new Set([
    // Health probes: liveness and readiness carry no tenant data and must stay
    // reachable without a session.
    'livez',
    'readyz',
    // Sub-phase 1.4. Sign-in, registration, password change and reset,
    // email verification: before any workspace is chosen.
    'auth',
    // Tenant invite preview and redemption: the redeemer is not yet a member.
    'invites',
    // Organization invites and the org-admin invite routes, isolated by
    // getOrgCtx rather than a tenant slug.
    'org',
    // The person's own profile, account-wide.
    'account',
    // Sub-phase 1.6. The CSP violation-report sink (`security/csp-report`):
    // browsers POST reports with no session, and the buffer has no tenant
    // dimension (its operator GET is gated on PLATFORM_ADMIN_API_KEY, never a
    // tenant role, because reading it is deployment-wide).
    'security',
    // Its legacy alias, which hands the request to the same sink in-process.
    'csp-report',
    // The web-vitals beacon: a credential-less sendBeacon from any page,
    // recording route-shaped metrics with no tenant or user attached.
    'telemetry',
    // Sub-phase 2.6b (owner decision 98): the public intake submit and the
    // address confirmation (`intake/forms/<publicId>`, `intake/confirm`),
    // machine-caller paths that gate themselves; the workspace comes from the
    // form's public id or the confirmation token, never from a session.
    'intake',
    // Roadmap 3.3b: the calendar OAuth callbacks (`integrations/calendar/callback`,
    // `integrations/calendar/admin-callback`). Each provider returns to one
    // fixed URI; the workspace comes from the sealed state cookie, then the
    // route asks `requirePermission` for it and checks the state's user is the
    // session's.
    'integrations',
]);

/** Global (non-tenant-scoped) API prefixes a tenant page may fetch with a flat path. */
const GLOBAL_APIS = ['/api/auth/'];

interface StructuralReport {
    sessionTenantId: string[];
    pagesOutsideTenant: string[];
    apiRoutesOutsideTenant: string[];
    flatFetchInTenantPages: string[];
    tenantPages: string[];
}

const isCommentLine = (line: string) => {
    const t = line.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

function check(root: string): StructuralReport {
    const files = gitFiles(root).filter((f) => f.startsWith('src/') && /\.tsx?$/.test(f) && !f.endsWith('.d.ts'));
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

    const sessionTenantId = files
        .filter((f) => !f.includes('__tests__'))
        .filter((f) => read(f).split('\n').some((line) => !isCommentLine(line) && /session\.tenantId/.test(line)));

    const pagesOutsideTenant = files.filter((f) => {
        const m = /^src\/app\/([^/]+)\/(?:.+\/)?page\.tsx$/.exec(f);
        if (!m) return false;
        const top = m[1]!;
        if (top === 't' || top === 'api') return false;
        if (ALLOWED_ROOT_PAGES.has(top)) return false;
        // Next.js private folders and route groups are skipped, as in the
        // inflect-compliance guard this is ported from.
        if (top.startsWith('(') || top.startsWith('_')) return false;
        return true;
    });

    const apiRoutesOutsideTenant = files.filter((f) => {
        const m = /^src\/app\/api\/([^/]+)\/(?:.+\/)?route\.ts$/.exec(f) ?? /^src\/app\/api\/([^/]+)\/route\.ts$/.exec(f);
        if (!m) return /^src\/app\/api\/route\.ts$/.test(f);
        const top = m[1]!;
        return top !== 't' && !ALLOWED_API_DIRS.has(top);
    });

    const tenantPages = files.filter((f) => /^src\/app\/t\/.+\/page\.tsx$/.test(f) || f === 'src/app/t/page.tsx');
    const flatFetchInTenantPages = tenantPages.filter((f) =>
        read(f)
            .split('\n')
            .some((line) => {
                if (isCommentLine(line)) return false;
                // Each flat fetch on the line is judged on its own path, so a
                // global call cannot excuse a tenant call beside it.
                const paths = [...line.matchAll(/fetch\s*\(\s*[`'"](\/api\/[^`'"]*)/g)].map((m) => m[1]!);
                return paths.some((p) => !GLOBAL_APIS.some((g) => p.startsWith(g)));
            }),
    );

    return { sessionTenantId, pagesOutsideTenant, apiRoutesOutsideTenant, flatFetchInTenantPages, tenantPages };
}

describe('Structural Guard: Tenant Isolation Conventions', () => {
    const report = check(REPO_ROOT);

    it('session.tenantId is not used anywhere in src/', () => {
        expect(report.sessionTenantId).toEqual([]);
    });

    it('no page lives outside /t/[tenantSlug] and the root allowlist', () => {
        expect(report.pagesOutsideTenant).toEqual([]);
    });

    it('no API route lives outside /api/t/[tenantSlug] and the API allowlist', () => {
        expect(report.apiRoutesOutsideTenant).toEqual([]);
    });

    it('tenant-scoped pages use the tenant URL helper, never a flat fetch("/api/...")', () => {
        expect(report.flatFetchInTenantPages).toEqual([]);
    });

    it('when /t/ exists, it holds pages (src/app/t arrives with the application shell, 1.7)', () => {
        if (fs.existsSync(path.join(REPO_ROOT, 'src/app/t'))) {
            expect(report.tenantPages.length).toBeGreaterThan(0);
        } else {
            expect(report.tenantPages).toEqual([]);
        }
    });

    it('every allowlisted API directory exists, so no entry is stale', () => {
        for (const dir of ALLOWED_API_DIRS) {
            expect(fs.existsSync(path.join(REPO_ROOT, 'src/app/api', dir))).toBe(true);
        }
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
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-tenant-structure-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        plant({
            '.gitignore': 'src/ignored/\n',
            'src/lib/legacy.ts': 'export const t = (session: { tenantId: string }) => session.tenantId;\n',
            'src/lib/commented.ts': '// session.tenantId is forbidden\nexport const x = 1;\n',
            'src/ignored/also.ts': 'export const t = (session: { tenantId: string }) => session.tenantId;\n',
            'src/app/page.tsx': 'export default function Home() { return null; }\n',
            'src/app/settings/page.tsx': 'export default function S() { return null; }\n',
            'src/app/(marketing)/about/page.tsx': 'export default function A() { return null; }\n',
            'src/app/api/livez/route.ts': 'export const GET = () => new Response();\n',
            'src/app/api/projects/route.ts': 'export const GET = () => new Response();\n',
            'src/app/api/t/[tenantSlug]/members/route.ts': 'export const GET = () => new Response();\n',
            'src/app/t/[tenantSlug]/members/page.tsx': "export default function P() { fetch('/api/members'); fetch('/api/auth/me'); return null; }\n",
            'src/app/t/[tenantSlug]/clean/page.tsx': 'export default function C() { return null; }\n',
        });
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reports one violation of each kind, and only those', () => {
        const r = check(root);
        expect(r.sessionTenantId).toEqual(['src/lib/legacy.ts']);
        expect(r.pagesOutsideTenant).toEqual(['src/app/settings/page.tsx']);
        expect(r.apiRoutesOutsideTenant).toEqual(['src/app/api/projects/route.ts']);
        expect(r.flatFetchInTenantPages).toEqual(['src/app/t/[tenantSlug]/members/page.tsx']);
        expect(r.tenantPages).toEqual(['src/app/t/[tenantSlug]/clean/page.tsx', 'src/app/t/[tenantSlug]/members/page.tsx']);
    });
});
