#!/usr/bin/env -S npx tsx
/**
 * The scale seed's command line (Hardening H2a; docs/performance.md;
 * docs/porting/maps/H2.md part 1.1; owner decisions 170 and 171).
 *
 *   npx tsx scripts/seed-scale/index.ts --shape 10k [--seed islestone-h2] [--verify-only] [--json]
 *
 * Needs the app's database environment: `DATABASE_URL` (the application's
 * connection, through PgBouncer as in production; the usecases run on it as
 * `app_user` with row-level security) and `DIRECT_DATABASE_URL` (the
 * superuser, directly: the bulk writer and the verification's counts). Seeds
 * `perf-<shape>` and `perf-<shape>-sibling` into a migrated database; a
 * workspace already complete is kept, a partial one refuses. Every run ends
 * with the verification; `--verify-only` runs only that (on a restored dump).
 * Exit 0 verified, 1 a verification or seed failure, 2 a usage error.
 */
import { seedScale } from './seed';
import { isShapeName, SHAPES } from './shapes';

function arg(name: string): string | undefined {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<number> {
    const shapeName = arg('shape') ?? '10k';
    if (!isShapeName(shapeName)) {
        console.error(`seed-scale: unknown shape ${shapeName} (one of ${Object.keys(SHAPES).join(', ')})`);
        return 2;
    }
    const bulkUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
    if (!bulkUrl) {
        console.error('seed-scale: set DATABASE_URL and DIRECT_DATABASE_URL');
        return 2;
    }
    const json = process.argv.includes('--json');
    const run = await seedScale({
        shape: SHAPES[shapeName],
        seed: arg('seed'),
        bulkUrl,
        verifyOnly: process.argv.includes('--verify-only'),
        log: (line) => console.error(`[seed-scale] ${line}`),
    });
    if (json) {
        console.log(JSON.stringify({ shape: shapeName, ...run }, null, 2));
    } else {
        console.log(`seed-scale: ${shapeName} verified in ${run.seconds.toFixed(1)} s; database ${(run.report.databaseBytes / 1024 / 1024).toFixed(0)} MB`);
        for (const w of run.report.workspaces) {
            console.log(
                `  ${w.slug}: ${w.items} items (${w.liveItems} live), ${w.comments} comments, ${w.searchVectors} search vectors, ` +
                    `${w.labels} labels, ${w.relations} relations, ${w.customFieldValues} field values, ${w.watchers} watchers, ` +
                    `${w.auditEntries} audit entries; ${w.decryptedChecked} descriptions decrypted and found`,
            );
        }
    }
    return 0;
}

main().then(
    (code) => process.exit(code),
    (err: unknown) => {
        console.error(err instanceof Error ? (err.stack ?? err.message) : err);
        process.exit(1);
    },
);
