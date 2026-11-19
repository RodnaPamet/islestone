#!/usr/bin/env node
/**
 * Serve the production build the way the app image does (`npm run start`).
 *
 * `next.config.ts` builds `output: 'standalone'` (sub-phase 1.8): `next build`
 * writes a self-contained server to `.next/standalone/server.js` with the
 * node_modules it traced. The static assets and `public/` are not part of
 * that output; the Dockerfile copies them beside the server, and this script
 * does the same, then runs the server in this process. `next start` would
 * still work but warns that it does not serve a standalone build, and the
 * Playwright suite should exercise the server that ships.
 *
 * PORT and HOSTNAME choose the address (defaults 3000 and 0.0.0.0, as in the
 * image). The server sets NODE_ENV=production itself.
 * Written fresh for Islestone.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const server = path.join(standalone, 'server.js');

if (!fs.existsSync(server)) {
    process.stderr.write('start-standalone: .next/standalone/server.js is missing; run `npm run build` first\n');
    process.exit(1);
}

fs.cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
if (fs.existsSync(path.join(root, 'public'))) {
    fs.cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
}

await import(pathToFileURL(server).href);
