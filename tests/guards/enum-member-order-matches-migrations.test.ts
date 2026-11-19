/**
 * Enum member ORDER must agree between `prisma/migrations` and `prisma/schema`.
 *
 * ─── The gap this closes (inflect-compliance #2475) ─────────────────
 *
 * `scripts/check-fresh-db-schema-drift.mjs` is the gate trusted to catch
 * schema/migration disagreement. It runs `prisma migrate diff`, and
 * `migrate diff` COMPARES ENUM VALUES AS A SET, NOT A SEQUENCE. A migration
 * and a schema that agree on the members and disagree on their order produce
 * no drift at all. In inflect-compliance a migration appended two members
 * that the schema declared mid-list, and the gate reported a clean match.
 *
 * ─── Why order is not cosmetic ──────────────────────────────────────
 *
 * A Postgres enum is an ORDERED type. Each member has an ordinal, `<`/`>`
 * between members compares ordinals, and `ORDER BY <enum column>` sorts by
 * ordinal — never alphabetically, never by what `prisma/schema` happens to
 * declare. Inserting a member mid-list renumbers every member after it.
 * `Role` is declared in seniority order (ADR 0006: Owner > Admin > Member >
 * Viewer > Guest) precisely because code that looks for the most senior
 * member sorts `TenantMembership.role` ascending.
 *
 * ─── What is asserted ───────────────────────────────────────────────
 *
 *  1. THE PARSER IS NOT BLIND. Any `CREATE`/`ALTER`/`DROP TYPE` statement no
 *     pattern consumed fails the suite.
 *  2. Every declared enum is reconstructible, and the member SETS agree.
 *  3. The set of order-disagreeing enums equals `SIGNED_OFF` EXACTLY. It is
 *     EMPTY: Islestone starts with no drift, and Postgres cannot reorder an
 *     existing enum, so a drift once shipped is permanent.
 *  4. No `ORDINAL_SENSITIVE` enum may ever be signed off.
 *
 * ─── When this fires on a member you just added ─────────────────────
 *
 * You inserted it in the middle of the `enum { }` block and the migration
 * appended it. Two honest fixes:
 *
 *   • put the member LAST in `prisma/schema` so the append matches, or
 *   • write the migration to place it where the schema declares it:
 *     `ALTER TYPE "T" ADD VALUE IF NOT EXISTS 'X' BEFORE 'Y';`
 *
 * Adding your enum to `SIGNED_OFF` is NOT the fix.
 */
import { parseSchemaModels } from '../helpers/prisma-schema-models';
import { computeEnumOrderReport, enumOrderReport } from '../helpers/prisma-enum-order';

/**
 * The enums whose ordinals are load-bearing, because something sorts a
 * column of that type in the database, or is designed to.
 *
 *   TenantMembership.role   seniority order (ADR 0006); "most senior member"
 *                           pickers sort it ascending (from sub-phase 1.6)
 *
 * The `model`/`field` pair is re-derived from `prisma/schema` on every run,
 * so a renamed field or a retyped column turns this red rather than turning
 * the entry vacuous.
 */
const ORDINAL_SENSITIVE: ReadonlyArray<{
    model: string;
    field: string;
    prismaEnum: string;
}> = [{ model: 'TenantMembership', field: 'role', prismaEnum: 'Role' }];

/**
 * Enums whose schema order and migration order disagree, each with BOTH
 * orders written out. EMPTY, and signing one off is an edit to test code a
 * reviewer sees.
 */
const SIGNED_OFF: ReadonlyArray<{
    physicalName: string;
    schemaOrder: readonly string[];
    migrationOrder: readonly string[];
}> = [];

const signedOffNames = (): string[] => SIGNED_OFF.map((s) => s.physicalName).sort();

describe('enum member order — migrations vs prisma/schema', () => {
    it('reports its own denominator (an empty population is not a pass)', () => {
        const r = enumOrderReport();
        // Every number the assertions below rest on, printed beside them.
        // A parser that suddenly reads 3 migrations and 0 enums would satisfy
        // every `toEqual([])` in this file.
        expect(r.migrationsReplayed).toBeGreaterThanOrEqual(1);
        expect(r.declared.length).toBe(3);
        expect(r.reconstructed.size).toBe(3);
        // The comparison actually reached every declared enum: nothing was
        // skipped into silence between parsing and comparing.
        const compared =
            r.declared.length -
            r.missingFromMigrations.length -
            r.memberSetDifferences.length;
        expect(compared).toBe(r.declared.length);
    });

    it('reads every enum DDL statement in every migration (no blind shapes)', () => {
        // A statement the parser cannot read drops its enum out of the
        // comparison, and the symptom is a GREEN guard over a smaller
        // population.
        expect(enumOrderReport().unreadableDdl).toEqual([]);
    });

    it('every `ADD VALUE … BEFORE/AFTER` names an anchor that exists', () => {
        // Postgres raises 22023 on a missing anchor, so one of these is a
        // migration that cannot apply — and it would also mean the
        // reconstructed order below is a guess rather than a reading.
        expect(enumOrderReport().danglingAnchors).toEqual([]);
    });

    it('every enum in prisma/schema is created by some migration', () => {
        expect(enumOrderReport().missingFromMigrations).toEqual([]);
    });

    it('member SETS agree — the precondition for comparing order', () => {
        // The live drift gate (npm run db:check-schema-drift) covers this
        // too, but only with a database. Here it is static, so a schema-only member addition is
        // caught in the guardrail suite rather than at the CI database step.
        expect(enumOrderReport().memberSetDifferences).toEqual([]);
    });

    it('exactly the signed-off enums disagree on ORDER — floor and ceiling', () => {
        const drifted = enumOrderReport()
            .orderDifferences.map((d) => d.physicalName)
            .sort();
        // Set equality, in one assertion, so the two directions cannot
        // disagree with each other:
        //   an enum that newly drifts        -> appears here, unsigned
        //   a signed-off enum that is fixed  -> disappears, stale sign-off
        expect(drifted).toEqual(signedOffNames());
    });

    it('each signed-off enum drifts in exactly the way it was signed off for', () => {
        // The verbatim pin. Without it, a member inserted into the middle of
        // an ALREADY-drifted enum changes the ordinals of everything after it
        // and the assertion above still passes: same name, same count, new
        // defect.
        const actual = enumOrderReport().orderDifferences.map((d) => ({
            physicalName: d.physicalName,
            schemaOrder: d.schemaOrder,
            migrationOrder: d.migrationOrder,
        }));
        expect(actual).toEqual(
            SIGNED_OFF.map((s) => ({
                physicalName: s.physicalName,
                schemaOrder: [...s.schemaOrder],
                migrationOrder: [...s.migrationOrder],
            })),
        );
    });

    describe('enums whose ordinals are load-bearing', () => {
        it('each named model/field still carries the enum it is listed for', () => {
            // Re-derived, not cited. A renamed field or a column retyped to
            // String would otherwise leave an entry below pointing at nothing
            // while every assertion around it stayed green.
            const models = new Map(parseSchemaModels().map((m) => [m.name, m]));
            const broken = ORDINAL_SENSITIVE.filter(
                (o) =>
                    models.get(o.model)?.fields.find((f) => f.name === o.field)?.type !==
                    o.prismaEnum,
            ).map((o) => `${o.model}.${o.field}: ${o.prismaEnum}`);
            expect(broken).toEqual([]);
        });

        it('none of them may be signed off for order drift', () => {
            // The clause that makes a sign-off list safe. Everything else here
            // is negotiable by argument; this is not. If a future diff needs
            // one of these in SIGNED_OFF, the answer is to fix the order, not
            // to widen the allowance — the column is sorted by ordinal in
            // production.
            const declared = new Map(
                enumOrderReport().declared.map((e) => [e.prismaName, e.physicalName]),
            );
            const signed = new Set(signedOffNames());
            const refused = ORDINAL_SENSITIVE.filter((o) =>
                signed.has(declared.get(o.prismaEnum) ?? o.prismaEnum),
            ).map((o) => o.prismaEnum);
            expect(refused).toEqual([]);
        });

        it('and none of them drifts', () => {
            // Belt and braces with the two above, and the one that would fire
            // first: this fails the moment a sorted enum's order moves, before
            // anyone gets as far as trying to sign it off.
            const declared = new Map(
                enumOrderReport().declared.map((e) => [e.prismaName, e.physicalName]),
            );
            const drifted = new Set(
                enumOrderReport().orderDifferences.map((d) => d.physicalName),
            );
            const bad = ORDINAL_SENSITIVE.filter((o) =>
                drifted.has(declared.get(o.prismaEnum) ?? o.prismaEnum),
            ).map((o) => `${o.prismaEnum} (${o.model}.${o.field})`);
            expect(bad).toEqual([]);
        });
    });
});

describe('the comparison, against planted migrations and schema', () => {
    const schema = ['enum Role {', '  OWNER', '  ADMIN', '  MEMBER', '}', 'enum Kind {', '  A', '  B', '}'].join('\n');

    it('sees an appended member that the schema declares mid-list as ORDER drift', () => {
        const report = computeEnumOrderReport(
            [
                { name: '1_init', sql: `CREATE TYPE "Role" AS ENUM ('OWNER', 'MEMBER');\nCREATE TYPE "Kind" AS ENUM ('A', 'B');` },
                { name: '2_add', sql: `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN';` },
            ],
            schema,
        );
        expect(report.orderDifferences.map((d) => [d.physicalName, d.migrationOrder])).toEqual([
            ['Role', ['OWNER', 'MEMBER', 'ADMIN']],
        ]);
    });

    it('accepts the same member placed with BEFORE, and reads DO-block DDL', () => {
        const report = computeEnumOrderReport(
            [
                { name: '1_init', sql: `CREATE TYPE "Role" AS ENUM ('OWNER', 'MEMBER');` },
                { name: '2_add', sql: `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN' BEFORE 'MEMBER';` },
                {
                    name: '3_kind',
                    sql: `DO $$ BEGIN\n  CREATE TYPE "Kind" AS ENUM ('A', 'B');\nEXCEPTION WHEN duplicate_object THEN null;\nEND $$;`,
                },
            ],
            schema,
        );
        expect([report.orderDifferences, report.memberSetDifferences, report.unreadableDdl, report.missingFromMigrations]).toEqual([
            [],
            [],
            [],
            [],
        ]);
    });

    it('reports a schema-only member and an enum no migration creates', () => {
        const report = computeEnumOrderReport([{ name: '1_init', sql: `CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN');` }], schema);
        expect(report.memberSetDifferences.map((d) => [d.physicalName, d.schemaOnly])).toEqual([['Role', ['MEMBER']]]);
        expect(report.missingFromMigrations).toEqual(['Kind']);
    });
});
