/**
 * GUARD — nothing the BullMQ worker can reach may pull in the NextAuth tree or
 * statically import a Next-server-only module.
 *
 * `scripts/worker.ts` (and the scheduler and healthcheck beside it) are plain
 * Node processes, not a Next runtime. Two things do not survive there:
 *
 *   - `next/headers`, `next/navigation` and `server-only` do not resolve, so a
 *     STATIC import of one anywhere in the graph kills the process at module
 *     load, before a single executor registers. A dynamic
 *     `await import('next/headers')` at a request-only call site is fine: it
 *     resolves only when called.
 *   - the NextAuth seam (`src/auth.ts` builds the provider array at module
 *     scope; `next-auth` itself expects the Next runtime). Reached through a
 *     LAZY import it does not kill the boot, it kills the job that loads it,
 *     while the worker looks healthy. So every edge counts for this one,
 *     dynamic imports included: the executor registry loads its jobs lazily.
 *
 * In inflect-compliance both happened, through one edge (`context.ts`
 * importing the session helper, which every usecase pulls in): the worker
 * crash-looped with `ERR_MODULE_NOT_FOUND … next/headers` and, after a partial
 * fix, jobs died with `Google is not a function`. Nothing failed loudly; the
 * jobs simply never ran. The damage was transitive, so this walks the real
 * import graph from the worker's entry points rather than checking files.
 *
 * Copied from inflect-compliance `tests/guards/worker-import-graph.test.ts` and
 * `tests/guards/worker-safe-imports.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e and rewritten as one walk on
 * Islestone's import-graph helper (`tests/helpers/import-graph.ts`): the
 * entries are the three worker scripts, the forbidden set is the NextAuth seam
 * as `eslint.config.mjs` lists it plus `next-auth` itself, and the detector is
 * proved against a planted repository.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { gitFiles } from '../helpers/git-files';
import { analyseModule, resolveSpecifier } from '../helpers/import-graph';
import { codeOf } from '../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../..');

/**
 * `NEXT_AUTH_SEAM` as `eslint.config.mjs` declares it, read from the file
 * rather than imported (loading the config loads every lint plugin).
 * `auth-stack-pinning.test.ts` holds the list equal to the real importers.
 */
function nextAuthSeam(): string[] {
    const config = fs.readFileSync(path.join(ROOT, 'eslint.config.mjs'), 'utf8');
    const block = /export const NEXT_AUTH_SEAM = \[([^\]]*(?:\][^\]]*)*?)\];/.exec(config);
    if (!block) throw new Error('NEXT_AUTH_SEAM not found in eslint.config.mjs');
    return [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}
const NEXT_AUTH_SEAM = nextAuthSeam();

/** The processes the worker image runs (scripts/build-worker.mjs builds these three). */
const ENTRIES = ['scripts/worker.ts', 'scripts/scheduler.ts', 'scripts/worker-healthcheck.ts'];

/** Modules that only resolve inside a Next server runtime. */
const NEXT_ONLY_MODULES = ['next/headers', 'next/navigation', 'server-only'];

interface Finding {
    readonly reason: string;
    readonly chain: readonly string[];
}

interface Walk {
    readonly reached: ReadonlySet<string>;
    readonly findings: readonly Finding[];
}

function staticallyImports(code: string, mod: string): boolean {
    const escaped = mod.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    return new RegExp(`^\\s*(?:import|export)\\s+(?:[^;]*?\\s+from\\s+)?['"]${escaped}['"]`, 'm').test(code);
}

/** Walk every bundled edge from `entries`; report the seam, next-auth and static Next-only imports. */
function walkWorkerGraph(root: string, entries: readonly string[], seam: readonly string[]): Walk {
    const reached = new Set<string>();
    const findings: Finding[] = [];
    const stack: Array<{ file: string; chain: string[] }> = entries.map((e) => ({ file: e, chain: [e] }));
    while (stack.length > 0) {
        const { file, chain } = stack.pop()!;
        if (reached.has(file)) continue;
        reached.add(file);
        if (seam.includes(file)) {
            findings.push({ reason: `reaches the NextAuth seam (${file})`, chain });
            continue;
        }
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        const facts = analyseModule(source, file);
        // A 'use client' module is browser code and is never evaluated by the
        // worker; reaching one is not a fault of its own, so it is not walked.
        if (facts.isClientEntry) continue;
        const code = codeOf(source);
        for (const mod of NEXT_ONLY_MODULES) {
            if (staticallyImports(code, mod)) findings.push({ reason: `statically imports ${mod}`, chain });
        }
        for (const spec of facts.specifiers) {
            if (spec === 'next-auth' || spec.startsWith('next-auth/') || spec.startsWith('@next-auth/')) {
                findings.push({ reason: `imports ${spec}`, chain });
                continue;
            }
            const res = resolveSpecifier(spec, path.join(root, file), root);
            if (res.kind !== 'file') continue;
            const rel = path.relative(root, res.file).split(path.sep).join('/');
            stack.push({ file: rel, chain: [...chain, rel] });
        }
    }
    return { reached, findings };
}

const render = (f: Finding) => `${f.reason}\n    ${f.chain.join('\n    -> ')}`;

describe('GUARD: the worker import graph', () => {
    const walk = walkWorkerGraph(ROOT, ENTRIES, NEXT_AUTH_SEAM);

    it('starts from real, git-listed entry points and reaches the job code', () => {
        expect(NEXT_AUTH_SEAM).toContain('src/auth.ts');
        expect(NEXT_AUTH_SEAM).toContain('src/lib/security/session-tracker.ts');
        const listed = new Set(gitFiles(ROOT));
        expect(ENTRIES.filter((e) => !listed.has(e))).toEqual([]);
        // The population: if the walk stopped resolving, every assertion below
        // would pass over nothing.
        for (const reachedFile of [
            'src/app-layer/jobs/executor-registry.ts',
            'src/app-layer/jobs/notification-outbox-flush.ts',
            'src/app-layer/notifications/processOutbox.ts',
            'src/lib/prisma.ts',
        ]) {
            expect(walk.reached.has(reachedFile)).toBe(true);
        }
        expect(walk.reached.size).toBeGreaterThan(50);
    });

    it('never reaches the NextAuth seam or next-auth, and imports no Next-only module statically', () => {
        expect(walk.findings.map(render)).toEqual([]);
    });

    it('the known request-only use sites still reach next/headers dynamically', () => {
        // The other direction: "tidying" one of these into a static import
        // brings the crash back for any job that reaches the file.
        for (const f of ['src/auth.ts', 'src/lib/security/session-tracker.ts']) {
            expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).toMatch(/await import\(\s*['"]next\/headers['"]\s*\)/);
        }
    });
});

describe('the walk catches planted faults (it is not vacuous)', () => {
    let dir: string;
    const write = (rel: string, body: string) => {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), body);
    };

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-graph-'));
        execFileSync('git', ['init', '-q'], { cwd: dir });
        write('scripts/worker.ts', "void (async () => { await import('../src/app-layer/jobs/registry'); })();\n");
        write(
            'src/app-layer/jobs/registry.ts',
            "import { a } from '@/lib/a';\nexport async function run() { await import('./lazy-job'); return a; }\n",
        );
        // A static Next-only import, two hops from the entry.
        write('src/lib/a.ts', "import { cookies } from 'next/headers';\nexport const a = cookies;\n");
        // The seam, reached only through a LAZY job import.
        write('src/app-layer/jobs/lazy-job.ts', "import { authOptions } from '@/auth';\nexport default authOptions;\n");
        write('src/auth.ts', 'export const authOptions = {};\n');
        // A dynamic next/headers import is fine, and prose naming it is not an import.
        write(
            'src/lib/fine.ts',
            "// import { cookies } from 'next/headers';\nexport async function f() { return import('next/headers'); }\n",
        );
        write('scripts/scheduler.ts', "import { f } from '../src/lib/fine';\nvoid f;\n");
    });

    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('flags the static Next-only import and the lazily reached seam, with their chains', () => {
        const { findings } = walkWorkerGraph(dir, ['scripts/worker.ts'], ['src/auth.ts']);
        expect(findings.map((f) => f.reason).sort()).toEqual([
            'reaches the NextAuth seam (src/auth.ts)',
            'statically imports next/headers',
        ]);
        const seam = findings.find((f) => f.reason.startsWith('reaches'))!;
        expect(seam.chain).toEqual([
            'scripts/worker.ts',
            'src/app-layer/jobs/registry.ts',
            'src/app-layer/jobs/lazy-job.ts',
            'src/auth.ts',
        ]);
    });

    it('passes a dynamic next/headers import and a comment naming the module', () => {
        expect(walkWorkerGraph(dir, ['scripts/scheduler.ts'], ['src/auth.ts']).findings).toEqual([]);
    });
});
