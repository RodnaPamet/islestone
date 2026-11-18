#!/usr/bin/env node
/**
 * `next typegen` with env validation switched off, for `npm run typecheck`.
 *
 * `next typegen` loads next.config.ts, which imports both env modules so that
 * `next dev`, `next build` and `next start` refuse a bad environment. Typegen
 * loads the config in the build phase, so the config cannot tell the two
 * apart. A type check reads no runtime value, so it must not depend on one:
 * without this wrapper, `npm run typecheck` (and so `npm run verify`) failed
 * on a fresh clone with no .env.local.
 *
 * Setting the variable here, rather than as `SKIP_ENV_VALIDATION=1 next
 * typegen` in package.json, keeps the script working on every shell npm uses.
 * Extra arguments are passed through to `next typegen`.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const result = spawnSync(process.execPath, [nextBin, 'typegen', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, SKIP_ENV_VALIDATION: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
