/**
 * Every workspace page is classified (inflect-compliance's
 * `rq4-1-page-segregation`, renamed for its invariant; sub-phase 1.7).
 *
 * Lists `src/app/t/[tenantSlug]/(app)/**\/page.tsx` from git and confirms each
 * route is in `MAIN_PAGES` or `SUBPAGES` (`src/lib/nav/page-segregation.ts`),
 * the source of truth the page header (an sr-only H1 on main pages) and the
 * back affordance read. The workspace root (`(app)/page.tsx`) is the one
 * exception: it only redirects to My Work. The shell's own routes, the
 * sidebar's `NAV_PATHS`, are exactly the main pages, and each has a page.
 *
 * The last block plants a repository, so the walk cannot pass by finding
 * nothing.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { NAV_PATHS } from '@/components/layout/nav-config';
import { MAIN_PAGES, SUBPAGES, classifyRoute, normalizePathname } from '@/lib/nav/page-segregation';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

const APP_DIR = 'src/app/t/[tenantSlug]/(app)/';

/** The workspace root, which only redirects to My Work. */
const ROOT_PAGE = `${APP_DIR}page.tsx`;

/** The route of every page under the workspace app group, from git. */
function appRoutes(root: string): string[] {
    return gitFiles(root)
        .filter((rel) => rel.startsWith(APP_DIR) && rel.endsWith('/page.tsx') && rel !== ROOT_PAGE)
        .map((rel) => `/${rel.slice(APP_DIR.length, -'/page.tsx'.length)}`)
        .map((route) => route.replace(/\/\([^/]+\)/g, '')) // nested route groups add no segment
        .sort();
}

function unclassified(routes: readonly string[]): string[] {
    const listed = new Set<string>([...MAIN_PAGES, ...SUBPAGES]);
    return routes.filter((route) => !listed.has(route));
}

describe('page segregation', () => {
    const routes = appRoutes(REPO_ROOT);

    it('every workspace page is classified as MAIN or SUBPAGE', () => {
        expect(routes.length).toBeGreaterThan(0);
        expect(unclassified(routes)).toEqual([]);
    });

    it('the shell destinations are exactly the main pages, and each has a page', () => {
        expect([...MAIN_PAGES].sort()).toEqual(Object.values(NAV_PATHS).sort());
        for (const main of MAIN_PAGES) expect(routes).toContain(main);
    });

    it('MAIN_PAGES and SUBPAGES are disjoint, without duplicates', () => {
        expect(MAIN_PAGES.filter((p) => SUBPAGES.includes(p))).toEqual([]);
        expect(new Set(MAIN_PAGES).size).toBe(MAIN_PAGES.length);
        expect(new Set(SUBPAGES).size).toBe(SUBPAGES.length);
    });

    it('normalizePathname strips the workspace prefix, and refuses a path outside it', () => {
        expect(normalizePathname('/t/acme/my-work')).toBe('/my-work');
        expect(normalizePathname('/t/acme/projects')).toBe('/projects');
        expect(normalizePathname('/login')).toBeNull();
    });

    it('classifyRoute returns the expected class', () => {
        for (const main of MAIN_PAGES) expect(classifyRoute(`/t/acme${main}`)).toBe('main');
        expect(classifyRoute('/t/acme/projects/ISL')).toBe('subpage');
        expect(classifyRoute('/t/acme/work-items/ISL-1')).toBe('subpage');
        expect(classifyRoute('/t/acme/projects/ISL/settings')).toBe('unknown');
        expect(classifyRoute('/login')).toBe('unknown');
    });
});

describe('the walk, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-pages-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = [
            `${APP_DIR}my-work/page.tsx`,
            `${APP_DIR}projects/[projectId]/page.tsx`,
            `${APP_DIR}(team)/cycles/page.tsx`,
            `${APP_DIR}inbox/InboxClient.tsx`,
            'src/app/t/[tenantSlug]/(mfa)/auth/mfa/page.tsx',
            `${APP_DIR}ignored/page.tsx`,
            ROOT_PAGE,
        ];
        // A bare directory name: in a .gitignore pattern `[tenantSlug]` would be a character class.
        fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
        for (const rel of plant) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), 'export default function P() { return null; }\n');
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('lists every page under the group, through nested route groups, and only those', () => {
        expect(appRoutes(root)).toEqual(['/cycles', '/my-work', '/projects/[projectId]']);
    });

    it('reports the routes the lists do not classify', () => {
        expect(unclassified(appRoutes(root))).toEqual(['/cycles', '/projects/[projectId]']);
    });
});
