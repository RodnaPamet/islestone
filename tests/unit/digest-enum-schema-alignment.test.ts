/**
 * Digest categories and the `EmailNotificationType` enum stay aligned.
 *
 * `dispatchDigest` writes its category straight into `NotificationOutbox.type`,
 * so every `DigestCategory` must be an `EmailNotificationType` value, and every
 * enum value must exist in the database, i.e. appear in a migration: a
 * Prisma client that names a value the database lacks fails the INSERT.
 *
 * Copied from inflect-compliance `tests/unit/digest-enum-schema-alignment.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e and rewritten over Islestone's
 * one category (`DUE_DIGEST`): the type-level check replaces the source scan of
 * the `DigestCategory` union, the generated client is the schema's own enum,
 * and the migration population comes from git.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { EmailNotificationType } from '@prisma/client';

import type { DigestCategory } from '@/app-layer/notifications/digest-dispatcher';
import { repoRelativeFiles } from '../helpers/repo-files';

const ROOT = path.resolve(__dirname, '../..');

/** Every DigestCategory, written out; `satisfies` fails `tsc` when the union moves. */
const DIGEST_CATEGORIES = ['DUE_DIGEST'] as const satisfies readonly DigestCategory[];

// The reverse direction at the type level: a DigestCategory that is not an
// EmailNotificationType does not compile.
type IsSubset<A, B> = [A] extends [B] ? true : false;
const _categoriesAreEmailTypes: IsSubset<DigestCategory, EmailNotificationType> = true;
void _categoriesAreEmailTypes;

function allMigrationSql(): string {
    return repoRelativeFiles()
        .filter((f) => /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(f))
        .map((f) => readFileSync(path.join(ROOT, f), 'utf8'))
        .join('\n');
}

describe('digest categories match the schema enum', () => {
    it('every DigestCategory is an EmailNotificationType value', () => {
        for (const category of DIGEST_CATEGORIES) {
            expect(Object.values(EmailNotificationType)).toContain(category);
        }
    });

    it('every EmailNotificationType value has a migration', () => {
        const sql = allMigrationSql();
        expect(sql).toContain('CREATE TYPE "EmailNotificationType"');
        const unmigrated = Object.values(EmailNotificationType).filter((v) => !sql.includes(`'${v}'`));
        expect(unmigrated).toEqual([]);
    });
});
