/**
 * The application shell's structure (sub-phase 1.7), held over the whole of
 * `src/` and proved against a planted repository so it cannot pass by
 * checking nothing:
 *
 *   1. ONE shell. Exactly one module defines `AppShell`
 *      (`src/components/layout/AppShell.tsx`), and the workspace app layout
 *      mounts it — inflect-compliance once carried two near-identical shells
 *      and a third hand-rolled header (its `single-app-shell` ratchet).
 *   2. ONE banner. Exactly one file renders `role="banner"`: the top chrome's
 *      `NavBar`. A second would be a second banner landmark on every page
 *      (its `one-banner-landmark-in-src`).
 *   3. The layout mounts `NavigationTracker` exactly once, the writer of
 *      the back affordance's referrer (its `rq4-3-navigation-tracker`), and
 *      the tracker and the referrer hook are client modules.
 *
 * Comments are masked before matching (`codeOf`), so prose naming a rule is
 * neither a violation nor a pass. Mirrored files (`ui-mirror.json`) are out
 * of scope: they are inflect's, byte for byte.
 *
 * Written for Islestone from those three inflect-compliance guards at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, with the population from git.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { PREV_PATH_KEY_PREFIX } from '@/lib/nav/usePreviousPath';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

const SHELL = 'src/components/layout/AppShell.tsx';
const BANNER_OWNER = 'src/components/layout/nav-bar.tsx';
const APP_LAYOUT = 'src/app/t/[tenantSlug]/(app)/layout.tsx';

function mirrored(root: string): Set<string> {
    const file = path.join(root, 'ui-mirror.json');
    if (!fs.existsSync(file)) return new Set();
    return new Set(Object.keys((JSON.parse(fs.readFileSync(file, 'utf8')) as { files?: Record<string, string> }).files ?? {}));
}

function sources(root: string): Array<{ rel: string; code: string }> {
    const skip = mirrored(root);
    return gitFiles(root)
        .filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel) && !rel.endsWith('.d.ts') && !skip.has(rel))
        .map((rel) => ({ rel, code: codeOf(fs.readFileSync(path.join(root, rel), 'utf8')) }));
}

const DEFINES_APP_SHELL = /export\s+(?:function|const)\s+AppShell\b/;
const BANNER = /role\s*=\s*(?:"banner"|'banner'|\{\s*['"]banner['"]\s*\})/;

/** Files that define an `AppShell` component. */
function shellDefinitions(root: string): string[] {
    return sources(root).filter((f) => DEFINES_APP_SHELL.test(f.code)).map((f) => f.rel);
}

/** Files that render `role="banner"`. */
function bannerOwners(root: string): string[] {
    return sources(root).filter((f) => BANNER.test(f.code)).map((f) => f.rel);
}

describe('the application shell, in this repository', () => {
    it('one module defines AppShell', () => {
        expect(shellDefinitions(REPO_ROOT)).toEqual([SHELL]);
    });

    it('one file renders the banner landmark: the top chrome', () => {
        expect(bannerOwners(REPO_ROOT)).toEqual([BANNER_OWNER]);
    });

    it('the workspace app layout mounts AppShell and NavigationTracker, each once', () => {
        const layout = codeOf(fs.readFileSync(path.join(REPO_ROOT, APP_LAYOUT), 'utf8'));
        expect(layout).toMatch(/from\s+['"]@\/components\/layout\/AppShell['"]/);
        expect(layout.match(/<AppShell\b/g)).toHaveLength(1);
        expect(layout).toMatch(/from\s+['"]@\/components\/nav\/NavigationTracker['"]/);
        expect(layout.match(/<NavigationTracker\s*\/>/g)).toHaveLength(1);
    });

    it('the tracker and the referrer hook are client modules, keyed in the islestone namespace', () => {
        for (const rel of ['src/components/nav/NavigationTracker.tsx', 'src/lib/nav/usePreviousPath.ts']) {
            expect(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').startsWith("'use client';")).toBe(true);
        }
        // The VALUE: it addresses data already in members' sessionStorage.
        expect(PREV_PATH_KEY_PREFIX).toBe('islestone:nav:prev:');
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-shell-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            '.gitignore': 'src/ignored/\n',
            'ui-mirror.json': JSON.stringify({ files: { 'src/components/ui/mirrored.tsx': 'x' } }),
            'src/components/layout/AppShell.tsx': 'export function AppShell() { return <header role="banner" />; }\n',
            'src/components/layout/OrgAppShell.tsx': 'export const AppShell = () => null;\n',
            'src/components/page.tsx': "export const P = () => <div role={'banner'} />;\n",
            'src/components/prose.tsx': '// export function AppShell() and role="banner" in a comment\nexport const x = 1;\n',
            'src/components/ui/mirrored.tsx': 'export function AppShell() { return <header role="banner" />; }\n',
            'src/ignored/AppShell.tsx': 'export function AppShell() { return null; }\n',
        };
        for (const [rel, content] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds every shell definition outside comments, mirrors and ignored files', () => {
        expect(shellDefinitions(root)).toEqual(['src/components/layout/AppShell.tsx', 'src/components/layout/OrgAppShell.tsx']);
    });

    it('finds every banner, in either spelling', () => {
        expect(bannerOwners(root)).toEqual(['src/components/layout/AppShell.tsx', 'src/components/page.tsx']);
    });
});
