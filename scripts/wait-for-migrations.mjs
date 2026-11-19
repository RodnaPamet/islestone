#!/usr/bin/env node
/**
 * Hold a container's start until the database carries this image's migrations.
 *
 * WHY THIS EXISTS. Migrations run in the one-shot `migrate` service
 * (deploy/docker-compose.prod.yml, owner decision 2026-11-19), which `app`
 * and `worker` depend on with `service_completed_successfully`. That ordering
 * holds for `docker compose up`, and only for it. Watchtower, which rolls the
 * running containers onto each new `:latest`, knows nothing of
 * `depends_on`: it restarts `migrate` (it is labelled, included while stopped
 * and revived) and the two long-running services, and starts them in its own
 * order without waiting for `migrate` to finish. Without this gate a new
 * image could serve requests against the previous schema for as long as the
 * migration takes, or for ever if it failed.
 *
 * So both images start through this script. It reads the newest migration
 * the image was built with (`.migration-head`, written at build time by
 * `--print-head`) and polls `_prisma_migrations` until that migration is
 * recorded as finished and not rolled back. Then it exits 0 and the
 * container's command goes on to start the server or the worker. After
 * MIGRATION_WAIT_SECONDS (default 300) it exits 1; the restart policy starts
 * the container again, and the gate holds again.
 *
 * It only reads. It never runs a migration and never decides one is safe: the
 * `migrate` service is the one writer (forward-fix policy,
 * docs/change-management-policy.md).
 *
 * Usage:
 *   node scripts/wait-for-migrations.mjs --print-head prisma/migrations > .migration-head
 *   node scripts/wait-for-migrations.mjs                # reads ./.migration-head
 *   node scripts/wait-for-migrations.mjs --head <name>  # an explicit migration
 *
 * Environment: DATABASE_URL (required), MIGRATION_WAIT_SECONDS,
 * MIGRATION_POLL_MS (default 2000), MIGRATION_HEAD_FILE (default .migration-head).
 * Written fresh for Islestone (sub-phase 1.8).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Prisma's migration directory names start with a 14-digit timestamp. */
const MIGRATION_DIR = /^\d{14}_[A-Za-z0-9_]+$/;

/**
 * The newest migration in a `prisma/migrations` directory: the greatest name
 * by its timestamp prefix, which is the order `prisma migrate deploy` applies.
 * Throws when the directory holds none, so a build cannot bake an empty head.
 */
export function newestMigration(migrationsDir) {
    const names = fs
        .readdirSync(migrationsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && MIGRATION_DIR.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    const head = names.at(-1);
    if (!head) throw new Error(`no migration directories in ${migrationsDir}`);
    return head;
}

/** Whether `head` is recorded as applied: finished, and not rolled back. */
export async function isApplied(client, head) {
    try {
        const result = await client.query(
            'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
            [head],
        );
        return result.rowCount > 0;
    } catch (err) {
        // 42P01: the table does not exist yet, so nothing has been applied.
        if (err && err.code === '42P01') return false;
        throw err;
    }
}

function parseArgs(argv) {
    const args = { printHead: null, head: null };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--print-head') args.printHead = argv[++i];
        else if (argv[i] === '--head') args.head = argv[++i];
        else throw new Error(`unknown argument: ${argv[i]}`);
    }
    return args;
}

async function waitForHead(head, { url, waitSeconds, pollMs }) {
    // Imported here so --print-head (run in the builder) needs no driver.
    const { default: pg } = await import('pg');
    const deadline = Date.now() + waitSeconds * 1000;
    let lastReason = '';
    for (;;) {
        const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
        try {
            await client.connect();
            if (await isApplied(client, head)) {
                process.stdout.write(`wait-for-migrations: ${head} is applied\n`);
                return true;
            }
            lastReason = 'not applied yet';
        } catch (err) {
            // Never print the driver's message: it can carry the host and the role.
            lastReason = `database unreachable (${err && err.code ? err.code : 'error'})`;
        } finally {
            await client.end().catch(() => undefined);
        }
        if (Date.now() >= deadline) {
            process.stderr.write(`wait-for-migrations: ${head} still ${lastReason} after ${waitSeconds}s; giving up\n`);
            return false;
        }
        process.stdout.write(`wait-for-migrations: ${head} ${lastReason}; waiting\n`);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.printHead) {
        process.stdout.write(`${newestMigration(args.printHead)}\n`);
        return 0;
    }
    const url = process.env.DATABASE_URL;
    if (!url) {
        process.stderr.write('wait-for-migrations: DATABASE_URL is not set\n');
        return 1;
    }
    const headFile = process.env.MIGRATION_HEAD_FILE || '.migration-head';
    const head = args.head ?? fs.readFileSync(path.resolve(headFile), 'utf8').trim();
    if (!MIGRATION_DIR.test(head)) {
        process.stderr.write(`wait-for-migrations: ${JSON.stringify(head)} is not a migration name\n`);
        return 1;
    }
    const waitSeconds = Number(process.env.MIGRATION_WAIT_SECONDS || 300);
    const pollMs = Number(process.env.MIGRATION_POLL_MS || 2000);
    return (await waitForHead(head, { url, waitSeconds, pollMs })) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().then(
        (code) => process.exit(code),
        (err) => {
            process.stderr.write(`wait-for-migrations: ${err instanceof Error ? err.message : String(err)}\n`);
            process.exit(1);
        },
    );
}
