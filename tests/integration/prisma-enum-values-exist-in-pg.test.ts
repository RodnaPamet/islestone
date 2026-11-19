/**
 * Every value a Prisma enum declares exists in its physical Postgres type.
 *
 * ═══ THE FAILURE THIS EXISTS FOR (inflect-compliance #3903) ═══
 *
 * In inflect-compliance a migration that added an enum value with
 * `ALTER TYPE … ADD VALUE` was RECORDED as applied on a shared database —
 * `_prisma_migrations.finished_at` not null — and its DDL was not there. It
 * surfaced as `invalid input value for enum …` deep inside an unrelated
 * feature suite. A migration ROW is evidence that a migration was recorded,
 * not that its DDL took effect; `migrate diff` and `prisma validate` compare
 * nothing physical either.
 *
 * In Islestone the enums are created by hand-finished SQL in the migration,
 * so this is also the test that catches a value missing from `CREATE TYPE`.
 *
 * So: **a check on a type's identity is not a check on its contents, and one
 * that binds a single value only proves that value exists.** This file checks
 * contents, for every enum.
 *
 * ═══ DERIVED, WHICH IS THE WHOLE POINT ═══
 *
 * Both halves come from the product, not from a list written here:
 *
 *   · the VALUES from the generated client (`Prisma`'s exported enum objects),
 *     which is what application code will actually send;
 *   · the PHYSICAL TYPE NAME from the schema's `@@map`, defaulting to the
 *     enum's own name. ADR 0006 rule 3 bans `@@map` in Islestone's schema, so
 *     every name maps to itself today; the mapping half stays so a pin ever
 *     admitted by an ADR amendment is followed, not missed.
 *
 * `Prisma.dmmf.datamodel.enums` is empty in this client build, which is why
 * the mapping is read from the schema rather than from runtime metadata.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as PrismaClientModule from '@prisma/client';

import { prismaTestClient } from '../helpers/db';
import { codeOf } from '../helpers/source-blocks';

import { DB_AVAILABLE } from './db-helper';

const prisma = prismaTestClient();
const describeFn = DB_AVAILABLE ? describe : describe.skip;
jest.setTimeout(60_000);

const SCHEMA_DIR = path.join(process.cwd(), 'prisma/schema');

/**
 * Schema source with comments removed.
 *
 * Load-bearing (found in inflect-compliance while building this): a `///` doc
 * comment that merely mentions a `@@map("…")` would otherwise be read as that
 * enum's physical type name, and the test would look for a type that cannot
 * exist — a false finding, in the file whose job is reporting real ones.
 */
function stripComments(src: string): string {
    return codeOf(src);
}

function schemaSource(): string {
    let out = '';
    for (const f of readdirSync(SCHEMA_DIR)) {
        if (!f.endsWith('.prisma')) continue;
        out += `${readFileSync(path.join(SCHEMA_DIR, f), 'utf8')}\n`;
    }
    return stripComments(out);
}

interface SchemaEnum {
    /** The Prisma-side name, which is what the client exports. */
    readonly name: string;
    /** The physical Postgres type: `@@map` when present, else the name. */
    readonly pgType: string;
    readonly mapped: boolean;
}

function schemaEnums(): SchemaEnum[] {
    const out: SchemaEnum[] = [];
    for (const m of schemaSource().matchAll(/enum\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
        const mapped = /@@map\("([^"]+)"\)/.exec(m[2]!);
        out.push({
            name: m[1]!,
            pgType: mapped === null ? m[1]! : mapped[1]!,
            mapped: mapped !== null,
        });
    }
    return out;
}

/** The values the generated client will send for one enum, or null if absent. */
function clientValues(name: string): string[] | null {
    const mod = PrismaClientModule as unknown as Record<string, unknown>;
    const e = mod[name];
    if (e === undefined || e === null || typeof e !== 'object') return null;
    return Object.keys(e as Record<string, string>);
}

/**
 * The values an enum DECLARES that its physical type does not accept.
 *
 * ═══ WHY THIS IS A PURE FUNCTION AND NOT A LOOP INSIDE THE TEST ═══
 *
 * Found by mutation-proving this file in inflect-compliance: with the loop
 * inline, deleting its `missing.push(...)` left every test green. The live
 * database has zero missing values, so `missing` is empty whether the
 * comparison works or not — the assertion that matters was passing for the
 * wrong reason and could not fail.
 *
 * The `NO_SUCH_ROLE_VALUE` control proves the SET LOOKUP works. It does not
 * prove the LOOP pairs each enum's client values with the right type's set,
 * which is the part a mapping error would break.
 *
 * Pulled out, it can be driven with inputs that DO have a missing value, so
 * the comparison is falsifiable without waiting for a real migration to fail.
 */
function missingValues(
    enums: readonly SchemaEnum[],
    db: ReadonlyMap<string, ReadonlySet<string>>,
    valuesOf: (name: string) => string[] | null,
): string[] {
    const missing: string[] = [];
    for (const e of enums) {
        const have = db.get(e.pgType);
        // A type that does not exist at all is a different condition, reported
        // by its own test. Folding it in here would report every one of its
        // values as missing and bury the real finding under the noise.
        if (have === undefined) continue;
        for (const v of valuesOf(e.name) ?? []) {
            if (!have.has(v)) missing.push(`${e.pgType}.${v}`);
        }
    }
    return missing;
}

/** Every enum type in `public`, with its values. ONE query, not 163. */
async function pgEnums(): Promise<Map<string, Set<string>>> {
    const rows = await prisma.$queryRaw<Array<{ typname: string; enumlabel: string }>>`
        SELECT t.typname, e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
    `;
    const out = new Map<string, Set<string>>();
    for (const r of rows) {
        const set = out.get(r.typname) ?? new Set<string>();
        set.add(r.enumlabel);
        out.set(r.typname, set);
    }
    return out;
}

describeFn('every Prisma enum value exists in its physical Postgres type', () => {
    it('the extraction can see the population it claims to cover', () => {
        // The denominator. An extractor that silently matched nothing would
        // make every assertion below pass over an empty set. Exact counts,
        // ratcheted as enums land.
        const enums = schemaEnums();
        expect(enums.map((e) => e.name).sort()).toEqual(['MembershipStatus', 'OrgRole', 'Role']);

        // Every schema enum must be findable in the client, or the pairing
        // skips it and the skip is invisible.
        const unpaired = enums.filter((e) => clientValues(e.name) === null).map((e) => e.name);
        expect(unpaired).toEqual([]);

        const values = enums.reduce((n, e) => n + (clientValues(e.name)?.length ?? 0), 0);
        // Role 5 + OrgRole 3 + MembershipStatus 4.
        expect(values).toBe(12);

        // No `@@map`ed enum: ADR 0006 rule 3. The mapping half is proved with
        // planted inputs below instead.
        expect(enums.filter((e) => e.mapped).length).toBe(0);
    });

    it('comments are stripped, so a quoted @@map in prose is not read as a mapping', () => {
        // `Role` carries `///` doc comments; it has NO `@@map`.
        const role = schemaEnums().find((e) => e.name === 'Role');
        expect(role).toBeDefined();
        expect(role?.mapped).toBe(false);
        expect(role?.pgType).toBe('Role');

    });

    it('the stripper itself removes a quoted @@map from prose', () => {
        // Driven with a FIXTURE rather than asserted against the real schema
        // text, for two reasons.
        //
        // It can express the failing input, which the real schema may never
        // contain; a control that depends on prose being present passes by
        // finding nothing once the prose is reworded.
        const fixture = [
            'enum Decoy {',
            '  A',
            '  /// prose that mentions @@map("Fake") in passing',
            '  B',
            '}',
        ].join('\n');

        expect(fixture).toContain('@@map("Fake")');
        expect(stripComments(fixture)).not.toContain('@@map("Fake")');
        // And the values survive the strip — a stripper that ate the body
        // would make every enum look empty and every comparison vacuous.
        expect(stripComments(fixture)).toContain('A');
        expect(stripComments(fixture)).toContain('B');
    });

    it('every declared enum has a physical type', async () => {
        const db = await pgEnums();
        const missing = schemaEnums()
            .filter((e) => !db.has(e.pgType))
            .map((e) => `${e.name} -> ${e.pgType}`);
        expect(missing).toEqual([]);
    });

    it('every client value exists in its physical type', async () => {
        // THE ASSERTION. A failure names `Type.VALUE` for each one, so the
        // message says which migration did not take rather than leaving a
        // reader to find it from a feature suite's stack trace.
        const db = await pgEnums();
        expect(missingValues(schemaEnums(), db, clientValues)).toEqual([]);
    });

    it('the COMPARISON reports a missing value — driven, not waited for', () => {
        // The source failure reproduced as inputs: a mapped enum whose client
        // declares a value the physical type does not have.
        const enums: SchemaEnum[] = [
            { name: 'PlantedSource', pgType: 'PlantedSourcePg', mapped: true },
        ];
        const db = new Map<string, ReadonlySet<string>>([
            ['PlantedSourcePg', new Set(['FIRST_VALUE', 'SECOND_VALUE'])],
        ]);
        const got = missingValues(enums, db, () => ['FIRST_VALUE', 'SECOND_VALUE', 'NEWEST_VALUE']);
        expect(got).toEqual(['PlantedSourcePg.NEWEST_VALUE']);
    });

    it('the comparison follows @@map, not the Prisma name', () => {
        // The mapping half, which an identity-mapped enum cannot exercise. If
        // the lookup used `name` instead of `pgType` it would miss
        // `PlantedSourcePg` entirely, find no set, and report NOTHING — a
        // mapping error reading as agreement.
        const enums: SchemaEnum[] = [
            { name: 'PlantedSource', pgType: 'PlantedSourcePg', mapped: true },
        ];
        const dbByPgName = new Map<string, ReadonlySet<string>>([
            ['PlantedSourcePg', new Set(['FIRST_VALUE'])],
        ]);
        expect(missingValues(enums, dbByPgName, () => ['FIRST_VALUE', 'NEWEST_VALUE'])).toEqual([
            'PlantedSourcePg.NEWEST_VALUE',
        ]);

        // Keyed by the PRISMA name instead: the type is absent, so this is the
        // missing-type condition and the value check stays silent by design.
        const dbByPrismaName = new Map<string, ReadonlySet<string>>([
            ['PlantedSource', new Set(['FIRST_VALUE'])],
        ]);
        expect(missingValues(enums, dbByPrismaName, () => ['FIRST_VALUE', 'NEWEST_VALUE'])).toEqual([]);
    });

    it('reports a CLEAN pair as clean, so it is not simply always failing', () => {
        const enums: SchemaEnum[] = [
            { name: 'PlantedSource', pgType: 'PlantedSourcePg', mapped: true },
        ];
        const db = new Map<string, ReadonlySet<string>>([
            ['PlantedSourcePg', new Set(['FIRST_VALUE', 'NEWEST_VALUE'])],
        ]);
        expect(missingValues(enums, db, () => ['FIRST_VALUE', 'NEWEST_VALUE'])).toEqual([]);
    });

    it('the comparison can fail — a value the type lacks is detected', async () => {
        // Positive control. Without it, a bug that compared a set against
        // itself, or against an empty one, would be indistinguishable from
        // agreement.
        const db = await pgEnums();
        const have = db.get('Role');
        expect(have).toBeDefined();
        expect(have?.has('OWNER')).toBe(true);
        expect(have?.has('NO_SUCH_ROLE_VALUE')).toBe(false);
    });

    it('is a SUBSET check, and says why equality would be wrong', async () => {
        // Postgres cannot drop an enum value. A value removed from the schema
        // therefore stays in the type for ever, so the database legitimately
        // holds values the client no longer declares — after a rename, always.
        // Asserting equality would fail on correct history.
        //
        // The direction that matters is the one checked above: a value the
        // CLIENT will send that the TYPE does not accept is a runtime error on
        // the next write. The reverse is dead weight.
        const db = await pgEnums();
        const declared = new Set(
            schemaEnums().flatMap((e) =>
                (clientValues(e.name) ?? []).map((v) => `${e.pgType}.${v}`),
            ),
        );
        const inDb: string[] = [];
        for (const [t, vs] of db) for (const v of vs) inDb.push(`${t}.${v}`);

        // Not an assertion about the count — an assertion that this file does
        // not depend on the counts being equal.
        expect(inDb.length).toBeGreaterThanOrEqual(declared.size);
    });
});
