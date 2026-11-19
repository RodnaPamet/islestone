/**
 * Runs before every test file in the `integration` Jest project, before any
 * module under test is loaded.
 *
 * The app's `prisma` singleton (src/lib/prisma.ts) builds its client from
 * `DATABASE_URL` when it is first imported, and `prismaTestClient()` resolves
 * the test URL itself. Pointing `DATABASE_URL` (and `DIRECT_DATABASE_URL`) at
 * the test database here keeps the two on ONE database; otherwise suites that
 * go through `runInTenantContext` would fail while direct-client suites passed.
 */
import { getTestDatabaseUrl, getTestDirectDatabaseUrl } from '../helpers/db';

const url = getTestDatabaseUrl();
if (url) {
    process.env.DATABASE_URL = url;
    process.env.DIRECT_DATABASE_URL = getTestDirectDatabaseUrl();
}
