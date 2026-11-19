/**
 * A BUNDLE THAT USES A CJS GLOBAL MUST DEFINE IT (#3611).
 *
 * `scripts/build-worker.mjs` emits ESM, where `require`, `__filename` and
 * `__dirname` do not exist. Its banner supplies them. If an inlined module
 * reaches for one the banner does not provide, the bundle still BUILDS, still
 * typechecks, and still passes every unit test — jest runs from source under
 * CJS, where all three are defined by the runtime — and then throws a
 * ReferenceError the first time that module is imported in production.
 *
 * That is exactly what happened: the banner defined `require` only, while its
 * own comment claimed it defined `__dirname` too. `dist/worker.mjs` used
 * `__dirname` once and defined it zero times, at module scope, so the import
 * threw and took every export in that file with it. The single visible symptom
 * was `legacy-reconcile` logging "adjudication failed, run stands" on every
 * resolved run, from behind a try/catch that is right to exist.
 *
 * ═══ WHY THIS READS THE BUILD SCRIPT AND NOT THE BUNDLE ═══
 *
 * The bundle is the artefact where the property is true, and reading it would
 * be the stronger check. But `dist/` is a build output: it is absent from a
 * fresh clone and stale in a working tree, so a guard that read it would be
 * either skipped or lying depending on when anyone last ran a build —
 * `absence reads as success`, which is the failure mode this repo keeps
 * finding.
 *
 * So this asserts the INVARIANT at its source: the banner defines every CJS
 * global, and `src/` is scanned for any use of one. Both halves are needed —
 * the banner alone could be deleted while uses remain, and a use alone proves
 * nothing if the banner covers it.
 *
 * Copied from inflect-compliance `tests/guards/worker-bundle-defines-its-cjs-shims.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: the `src/` population comes
 * from git, not a directory walk, and the scan's 500-file floor (inflect's
 * size) is replaced by a planted file the detector must flag.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { codeOf } from '../helpers/source-blocks';
import { repoRelativeFiles } from '../helpers/repo-files';

const ROOT = path.join(__dirname, '..', '..');
const BUILD = 'scripts/build-worker.mjs';

/** The three globals ESM does not have and CJS does. */
const CJS_GLOBALS = ['require', '__filename', '__dirname'] as const;

const buildSource = codeOf(readFileSync(path.join(ROOT, BUILD), 'utf8'));

/**
 * The banner's JS, as one string.
 *
 * Read from the `banner:` block rather than the whole file, so a mention of
 * `__dirname` in a comment elsewhere — or in this very explanation, were it in
 * that file — cannot satisfy the assertion. `codeOf` masks comments too, which
 * makes that belt and braces.
 */
function bannerJs(): string {
    const i = buildSource.indexOf('banner:');
    expect(i).toBeGreaterThan(-1);
    const open = buildSource.indexOf('{', i);
    let depth = 0;
    let j = open;
    for (; j < buildSource.length; j += 1) {
        const c = buildSource[j];
        if (c === '{') depth += 1;
        else if (c === '}') {
            depth -= 1;
            if (depth === 0) break;
        }
    }
    return buildSource.slice(open, j + 1);
}

describe('the worker bundle defines every CJS global it ships', () => {
    it('the banner defines all three', () => {
        const banner = bannerJs();
        const missing = CJS_GLOBALS.filter(
            (g) => !new RegExp(String.raw`const\s+${g}\s*=`).test(banner),
        );
        expect(missing).toEqual([]);
    });

    it('NEGATIVE CONTROL — the reader is looking at the banner, not the file', () => {
        // Without this, a `bannerJs()` that silently returned the whole file
        // would pass the assertion above on any mention anywhere. The banner is
        // a small object literal; the file is not.
        const banner = bannerJs();
        expect(banner.length).toBeLessThan(buildSource.length / 2);
        expect(banner).toContain('createRequire');
        // And it must NOT contain something that is in the file but outside the
        // banner, which proves the slice has real bounds.
        expect(banner).not.toContain('entryPoints');
    });

    it('every CJS global used under src/ is one the banner provides', () => {
        // The other half. The banner could cover all three and a fourth global
        // creep in — `module`, `exports` — with the same silent failure.
        const used = new Set<string>();
        const files = sourceFiles();
        for (const rel of files) {
            for (const g of cjsGlobalsUsedIn(codeOf(readFileSync(path.join(ROOT, rel), 'utf8')))) used.add(g);
        }
        // The denominator: a scan that read nothing would pass over nothing.
        expect(files).toEqual(expect.arrayContaining(['src/app-layer/jobs/queue.ts', 'src/lib/redis.ts']));
        const unprovided = [...used].filter(
            (g) => !(CJS_GLOBALS as readonly string[]).includes(g),
        );
        expect(unprovided).toEqual([]);
    });
});

/** Every `.ts` under `src/`, excluding declaration files. */
function sourceFiles(): string[] {
    return repoRelativeFiles().filter(
        (f) => f.startsWith('src/') && f.endsWith('.ts') && !f.endsWith('.d.ts'),
    );
}

/** The CJS globals (and `module.exports` / `exports.`) a source uses. */
function cjsGlobalsUsedIn(code: string): string[] {
    return ['require', '__filename', '__dirname', 'module.exports', 'exports.'].filter((g) =>
        new RegExp(String.raw`(^|[^.\w])${g.replace('.', '\\.')}`).test(code),
    );
}

describe('the CJS-global scan is not vacuous', () => {
    it('flags a planted use of a global the banner does not provide', () => {
        expect(cjsGlobalsUsedIn(codeOf('module.exports = { a: 1 };'))).toEqual(['module.exports']);
        expect(cjsGlobalsUsedIn(codeOf('// module.exports in a comment'))).toEqual([]);
    });
});
