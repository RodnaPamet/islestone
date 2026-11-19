/**
 * Global setup for the `integration` Jest project: apply the migrations to the
 * test database once, before any suite runs.
 *
 * A database that cannot be reached is not an error HERE: every suite imports
 * `tests/integration/db-helper.ts`, which fails closed with a message naming
 * the problem (or skips, when `ALLOW_DB_SKIP=1` asks it to). A database that
 * can be reached but will not migrate throws, because every suite would then
 * fail on a schema that is not the one in prisma/migrations.
 */
import { spawnSync } from 'node:child_process';

import { getTestDatabaseUrl, migrateTestDb } from '../helpers/db';

function reachable(url: string): boolean {
    const script =
        "const{PrismaClient}=require('@prisma/client');const{PrismaPg}=require('@prisma/adapter-pg');" +
        'const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.__DB_CHECK_URL})});' +
        'p.$queryRawUnsafe("SELECT 1").then(()=>process.exit(0),()=>process.exit(1));';
    const res = spawnSync(process.execPath, ['-e', script], {
        timeout: 30_000,
        stdio: 'ignore',
        env: { ...process.env, __DB_CHECK_URL: url },
    });
    return res.status === 0;
}

export default async function globalSetup(): Promise<void> {
    const url = getTestDatabaseUrl();
    if (!url || !reachable(url)) return;
    migrateTestDb();
}
