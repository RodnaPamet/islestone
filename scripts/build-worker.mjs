/**
 * Build the standalone BullMQ worker + scheduler entrypoints.
 *
 * The worker and scheduler run as separate processes from the
 * Next.js server (sub-phase 1.8's production compose runs the `worker`
 * service).
 * The production image is dev-dependency-pruned, so it cannot run
 * the TypeScript sources directly via `tsx`. This script bundles
 * each entrypoint — with all its `src/` imports inlined — into a
 * single self-contained `.mjs` file under `dist/`. node_modules
 * stay external (resolved at runtime from the pruned production
 * `node_modules`), so every package the bundle imports MUST be a
 * production `dependency`, not a `devDependency`.
 *
 * Output: `dist/worker.mjs`, `dist/scheduler.mjs`, `dist/worker-healthcheck.mjs`.
 * Run:    `node scripts/build-worker.mjs`  (npm script: `build:worker`)
 *
 * Copied from inflect-compliance `scripts/build-worker.mjs` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, with its three process entry
 * points and none of its seeders; the banner code is unchanged.
 */
import { build } from 'esbuild';

const common = {
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    // Keep every node_modules package external — resolved at runtime
    // from the production node_modules. Only first-party `src/` +
    // `scripts/` code is inlined into the bundle.
    packages: 'external',
    // Resolves the `@/*` path alias.
    tsconfig: 'tsconfig.json',
    logLevel: 'info',
    // ═══ THE CJS SHIMS ESM DOES NOT HAVE ═══
    //
    // esbuild emits `import.meta` helpers for ESM, but `require`, `__filename`
    // and `__dirname` simply do not exist there. This banner supplies all
    // three, for any inlined module that reaches for them.
    //
    // It used to supply only `require`, while this comment claimed it supplied
    // `__dirname` too — so a reader checking whether `__dirname` was safe in
    // worker-reachable code found a comment saying yes. It was not:
    // `dist/worker.mjs` USED it once and DEFINED it zero times (#3611), and
    // the one use is at module scope, so importing that module threw a
    // ReferenceError and took every export in it with it.
    //
    // In inflect-compliance that went unnoticed behind a try/catch that turned
    // the ReferenceError into a `warn` line nobody chased, for the life of the
    // ESM bundle.
    //
    // ═══ WHAT `__dirname` RESOLVES TO HERE, WHICH IS NOT WHAT IT LOOKS LIKE ═══
    //
    // The BUNDLE's directory — `dist/` — not the source module's. That is the
    // right answer for `require` and the wrong one for anything resolving a
    // path relative to its own source file: such a file is not copied into
    // `dist`. Worker-reachable code that needs one must say so here.
    banner: {
        js:
            "import { createRequire as __createRequire } from 'module';"
            + "import { dirname as __nodeDirname } from 'path';"
            + "import { fileURLToPath as __nodeFileURLToPath } from 'url';"
            + "const require = __createRequire(import.meta.url);"
            + "const __filename = __nodeFileURLToPath(import.meta.url);"
            + "const __dirname = __nodeDirname(__filename);",
    },
};

await build({
    ...common,
    entryPoints: ['scripts/worker.ts'],
    outfile: 'dist/worker.mjs',
});
await build({
    ...common,
    entryPoints: ['scripts/scheduler.ts'],
    outfile: 'dist/scheduler.mjs',
});
// Container healthcheck for the `worker` service (inflect #2745). Bundled
// rather than run from source because the runner image carries no source tree,
// and sub-phase 1.8's compose invokes it as `node dist/worker-healthcheck.mjs`.
// If this entry is removed the compose healthcheck silently fails every probe
// and the container is marked unhealthy forever — `worker-heartbeat-wiring`
// pins the pair.
await build({
    ...common,
    entryPoints: ['scripts/worker-healthcheck.ts'],
    outfile: 'dist/worker-healthcheck.mjs',
});
console.log('✓ built dist/worker.mjs + dist/scheduler.mjs + dist/worker-healthcheck.mjs');
