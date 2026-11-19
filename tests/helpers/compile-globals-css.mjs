/**
 * Compiles `src/app/globals.css` through the real postcss plugin chain
 * (`postcss.config.mjs`: `@tailwindcss/postcss`) and writes the CSS to stdout.
 *
 * Copied from inflect-compliance's tests/helpers/compile-globals-css.mjs
 * (PROVENANCE.md); Islestone's chain has no autoprefixer, so neither does
 * this. A separate script run as a child process, not a `require` inside a
 * test: `@tailwindcss/postcss` calls `module.registerHooks()` at import time,
 * which Jest refuses. Not a `*.test.*` file, so no Jest project picks it up.
 *
 * Usage: `node tests/helpers/compile-globals-css.mjs > out.css`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GLOBALS = path.join(ROOT, 'src/app/globals.css');

const out = await postcss([tailwind()]).process(fs.readFileSync(GLOBALS, 'utf8'), { from: GLOBALS });
process.stdout.write(out.css);
