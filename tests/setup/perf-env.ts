/**
 * Runs before every test file in the `perf` Jest project (Hardening H2a,
 * docs/performance.md). The project measures the database `scripts/seed-scale/`
 * seeded: `DATABASE_URL` (the application's connection, through PgBouncer as
 * in production) and `DIRECT_DATABASE_URL` (the superuser, directly) must both
 * name it. FAIL CLOSED: a missing database is an error, never a skip, because
 * a perf job that measured nothing must not pass (map part 1.6).
 */
for (const name of ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const) {
    if (!process.env[name]) throw new Error(`perf: ${name} is not set; the perf project runs against the seeded database (docs/performance.md)`);
}
