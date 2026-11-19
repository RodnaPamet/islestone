/**
 * Single-Prisma-major pin.
 *
 * In inflect-compliance a branch stranded on Prisma 5 while `main` moved to
 * Prisma 7 — a major skew that turned a stale branch into an expensive,
 * high-risk reconcile. This ratchet keeps the whole Prisma family on ONE major
 * so a divergent line can't silently pin a different one, and so a bump across
 * a major boundary fails CI at PR time instead of surfacing as runtime drift.
 *
 * Every Prisma-family package must resolve to `PINNED_MAJOR`. Upgrading is a
 * deliberate act: bump `PINNED_MAJOR` here in the SAME change that bumps
 * package.json.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');

/** The one Prisma major the whole repo is on. Bump deliberately. */
const PINNED_MAJOR = 7;

/** Every Prisma-family package that must share the major. */
const PRISMA_PACKAGES = ['prisma', '@prisma/client', '@prisma/adapter-pg'] as const;

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

/** Parse the leading major out of a semver range (`^7.8.0`, `7.8.0`, `~7.1`). */
function majorOf(range: string): number | null {
    const m = range.match(/(\d+)\./);
    return m ? Number(m[1]) : null;
}

/** The declared Prisma packages whose major is not `pinned`, or that are missing. */
function majorProblems(pkg: Manifest, pinned: number): string[] {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    return PRISMA_PACKAGES.flatMap((name) => {
        const range = deps[name];
        if (range === undefined) return [`${name}: not declared`];
        const major = majorOf(range);
        return major === pinned ? [] : [`${name}: ${range} is not major ${pinned}`];
    });
}

describe('Prisma major pin — one major across the repo', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as Manifest;

    it('every Prisma-family package is declared and pinned to the same major', () => {
        expect(majorProblems(pkg, PINNED_MAJOR)).toEqual([]);
    });

    it('the installed prisma CLI matches the pinned major (lockfile ↔ installed)', () => {
        // Resolve, rather than joining `node_modules` onto the repo root: a
        // worktree resolves node_modules upward. The package is a declared
        // devDependency, so not resolving it is a failure, not a skip.
        const installedPath = require.resolve('prisma/package.json', { paths: [REPO_ROOT] });
        const installed = JSON.parse(fs.readFileSync(installedPath, 'utf-8')) as { version?: string };
        expect(installed.version).toBeDefined();
        expect(majorOf(installed.version!)).toBe(PINNED_MAJOR);
    });
});

describe('the check, against a planted manifest', () => {
    it('reports a split-major family and a missing package', () => {
        const split: Manifest = {
            dependencies: { '@prisma/client': '7.10.1', '@prisma/adapter-pg': '6.19.0' },
        };
        expect(majorProblems(split, 7)).toEqual(['prisma: not declared', '@prisma/adapter-pg: 6.19.0 is not major 7']);
    });

    it('accepts a family on one major, wherever each is declared', () => {
        const ok: Manifest = {
            dependencies: { '@prisma/client': '7.10.1', '@prisma/adapter-pg': '7.10.1' },
            devDependencies: { prisma: '7.10.1' },
        };
        expect(majorProblems(ok, 7)).toEqual([]);
    });
});
