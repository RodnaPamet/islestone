/**
 * Integration test helper: synchronous DB availability check, used to gate
 * every DB-backed suite (`const describeFn = DB_AVAILABLE ? describe :
 * describe.skip`).
 *
 * URL resolution: `getTestDatabaseUrl()` (DATABASE_URL_TEST, else
 * DATABASE_URL), the same function the test client and the app's client
 * (through tests/setup/integration-env.ts) use, so the three can never
 * disagree.
 *
 * FAIL CLOSED. When the probe fails, importing this module THROWS unless
 * `ALLOW_DB_SKIP=1` is set, which CI never does: an unavailable database must
 * not turn every isolation suite into a green skip (see db-availability.ts).
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

import { getTestDatabaseUrl } from '../helpers/db';

import { assertDbAvailableOrSkipAllowed } from './db-availability';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Synchronous DB availability check.
 *
 * Attempts a Prisma `$connect()` + `SELECT 1` against the given URL in a child
 * process, so it can gate `describe` / `describe.skip` at module scope. The
 * URL is passed through the environment, not the command line.
 */
function checkDbAvailable(url: string): boolean {
    if (!url) return false;
    const script = [
        "const{PrismaClient}=require('@prisma/client');",
        "const{PrismaPg}=require('@prisma/adapter-pg');",
        'const u=process.env.__DB_CHECK_URL;',
        'const adapter=new PrismaPg({connectionString:u});',
        'const p=new PrismaClient({adapter});',
        'p.$connect()',
        '.then(()=>p.$queryRawUnsafe("SELECT 1"))',
        '.then(()=>{p.$disconnect();process.exit(0)})',
        '.catch(()=>{p.$disconnect().catch(()=>{});process.exit(1)})',
    ].join('');
    const result = spawnSync(process.execPath, ['-e', script], {
        // A cold Prisma client plus a connect on a loaded machine can take
        // several seconds. Erring long only ever runs more tests; it cannot
        // mask a failure, because a timeout fails closed below.
        timeout: 30_000,
        stdio: 'ignore',
        cwd: ROOT,
        env: { ...process.env, __DB_CHECK_URL: url },
    });
    return result.status === 0;
}

const dbUrl = getTestDatabaseUrl();
const available = checkDbAvailable(dbUrl);

assertDbAvailableOrSkipAllowed(available, process.env.ALLOW_DB_SKIP, dbUrl);

export const DB_URL = dbUrl;
export const DB_AVAILABLE = available;
