/**
 * Job contract completeness, and no in-process cron.
 *
 * Extracted from inflect-compliance `tests/regression/infrastructure-guards.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: its "Job Contract
 * Completeness" and "No In-Process Cron" describes. The production-defaults
 * and AV download-gate describes are sub-phase 4.4's (storage). Imports go
 * through `@/`, which Islestone's Jest maps in every project, so inflect's
 * `tests/helpers/job-imports.ts` is not needed.
 *
 * These run WITHOUT live infrastructure (no Redis).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { JOB_DEFAULTS, QUEUE_NAME } from '@/app-layer/jobs/types';
import { SCHEDULED_JOBS } from '@/app-layer/jobs/schedules';

/**
 * Every job the scheduler registers, sorted. Written out so that adding or
 * removing a scheduled job is a visible edit here; the length test derives
 * from this list rather than a literal.
 */
const EXPECTED_SCHEDULED_JOB_NAMES: readonly string[] = [
    'audit-outbox-flush',
    'cycle-rollover',
    'health-check',
    'intake-purge',
    'intake-snooze-wake',
    'notification-digest',
    'notification-outbox-flush',
    'notification-purge',
    'search-index-rebuild',
    'work-item-due-notification',
    'work-item-purge',
    'work-item-recurrence',
    'work-item-sortkey-rebalance',
];

function readPackageJson(): {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
} {
    return JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
}

describe('Infrastructure Regression Guards — jobs', () => {
    describe('Job Contract Completeness', () => {
        test('all scheduled jobs have matching JOB_DEFAULTS', () => {
            for (const schedule of SCHEDULED_JOBS) {
                expect(JOB_DEFAULTS).toHaveProperty(schedule.name);
            }
        });

        test('all JOB_DEFAULTS have required fields', () => {
            for (const [_name, defaults] of Object.entries(JOB_DEFAULTS)) {
                expect(defaults).toHaveProperty('attempts');
                expect(defaults).toHaveProperty('backoff');
                expect(defaults).toHaveProperty('removeOnComplete');
                expect(defaults).toHaveProperty('removeOnFail');
                expect(typeof defaults.attempts).toBe('number');
                expect(defaults.attempts).toBeGreaterThan(0);
                expect(defaults.backoff).toHaveProperty('type');
                expect(defaults.backoff).toHaveProperty('delay');
            }
        });

        test('QUEUE_NAME is defined and non-empty', () => {
            expect(QUEUE_NAME).toBeTruthy();
            expect(typeof QUEUE_NAME).toBe('string');
        });

        test('all scheduled jobs have valid cron patterns', () => {
            for (const schedule of SCHEDULED_JOBS) {
                const parts = schedule.pattern.split(' ');
                expect(parts.length).toBeGreaterThanOrEqual(5);
                expect(parts.length).toBeLessThanOrEqual(6);
                expect(schedule.description).toBeTruthy();
            }
        });

        // The derivation is only as trustworthy as the list it derives from:
        // a duplicated name would inflate `.length` (and hide a genuinely
        // double-registered repeatable job), and an out-of-sort-order append
        // turns the name-set failure below into an unreadable diff.
        test('the expected-name list is sorted and duplicate-free', () => {
            expect(new Set(EXPECTED_SCHEDULED_JOB_NAMES).size).toBe(
                EXPECTED_SCHEDULED_JOB_NAMES.length,
            );
            expect([...EXPECTED_SCHEDULED_JOB_NAMES].sort()).toEqual(
                EXPECTED_SCHEDULED_JOB_NAMES,
            );
        });

        // NAMED FOR WHAT IT CHECKS, which is only the count. It used to say
        // "holds exactly the expected set" — the same claim the NEXT test makes
        // and actually verifies. Two tests asserting "the expected set" invite a
        // later reader to dedupe them, and deleting the wrong one leaves a file
        // whose surviving test promises a set and checks a number.
        test('SCHEDULED_JOBS length matches the expected-name list', () => {
            // Derived, not a literal — see EXPECTED_SCHEDULED_JOB_NAMES.
            expect(SCHEDULED_JOBS).toHaveLength(
                EXPECTED_SCHEDULED_JOB_NAMES.length,
            );
        });

        test('scheduled job names match expected set', () => {
            const names = SCHEDULED_JOBS.map(s => s.name).sort();
            expect(names).toEqual(EXPECTED_SCHEDULED_JOB_NAMES);
        });
    });

    describe('No In-Process Cron', () => {
        test('no node-cron dependency exists', () => {
            // Verify node-cron is not in package.json
            const pkg = readPackageJson();
            expect(pkg.dependencies?.['node-cron']).toBeUndefined();
            expect(pkg.devDependencies?.['node-cron']).toBeUndefined();
        });

        test('BullMQ is a production dependency', () => {
            const pkg = readPackageJson();
            expect(pkg.dependencies?.['bullmq']).toBeDefined();
        });

        test('ioredis is a production dependency', () => {
            const pkg = readPackageJson();
            expect(pkg.dependencies?.['ioredis']).toBeDefined();
        });
    });
});
