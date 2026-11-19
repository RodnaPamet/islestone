/**
 * Integration Test: Epic B.2 schema shape for Tenant.encryptedDek.
 *
 * Proves against the live DB:
 *   - The `encryptedDek` column exists on `Tenant`.
 *   - It is nullable (so existing tenants survive the migration).
 *   - It is of TEXT type (accommodates the `v1:base64(...)` envelope).
 *   - A wrapped DEK produced by `wrapDek()` round-trips to the DB
 *     and back via Prisma without corruption.
 *   - An unrelated encryption key on the same tenant does NOT
 *     collide (each tenant has its own DEK namespace).
 *   - The CHECK `Tenant_previousEncryptedDek_differs` refuses an outgoing
 *     DEK equal to the current one, and the partial index
 *     `Tenant_rotation_in_flight_idx` exists with its predicate. Prisma's
 *     schema expresses neither, so the 1.5 migration's SQL is tested here.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e;
 * the CHECK case is from its `tenant-dek-rotation.test.ts` (L165–185), the
 * index case is new.
 */

import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient } from '../helpers/db';
import type { PrismaClient } from '@prisma/client';
import {
    generateAndWrapDek,
    unwrapDek,
    isWrappedDek,
    DEK_LENGTH_BYTES,
} from '@/lib/security/tenant-keys';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('Epic B.2 — Tenant.encryptedDek schema', () => {
    let prisma: PrismaClient;
    const slugs: string[] = [];

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        try {
            await prisma.tenant.deleteMany({
                where: { slug: { in: slugs } },
            });
        } catch {
            /* best effort */
        }
        await prisma.$disconnect();
    });

    test('column exists and is nullable TEXT', async () => {
        const rows = await prisma.$queryRawUnsafe<
            Array<{
                column_name: string;
                data_type: string;
                is_nullable: string;
            }>
        >(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Tenant'
              AND column_name = 'encryptedDek'
        `);

        expect(rows).toHaveLength(1);
        expect(rows[0].data_type).toBe('text');
        expect(rows[0].is_nullable).toBe('YES');
    });

    test('tenants created WITHOUT an encryptedDek survive (NULL allowed)', async () => {
        const slug = `dek-null-${Date.now()}`;
        slugs.push(slug);
        const tenant = await prisma.tenant.create({
            data: { name: 'DEK nullable check', slug },
        });
        expect(tenant.encryptedDek).toBeNull();
    });

    test('a wrapped DEK stored + read round-trips via Prisma intact', async () => {
        const slug = `dek-roundtrip-${Date.now()}`;
        slugs.push(slug);
        const { dek, wrapped } = generateAndWrapDek();

        const tenant = await prisma.tenant.create({
            data: {
                name: 'DEK round-trip check',
                slug,
                encryptedDek: wrapped,
            },
        });

        expect(tenant.encryptedDek).toBe(wrapped);
        expect(isWrappedDek(tenant.encryptedDek)).toBe(true);

        // Reload to make sure it's not just the in-memory value.
        const reloaded = await prisma.tenant.findUnique({
            where: { id: tenant.id },
        });
        expect(reloaded?.encryptedDek).toBe(wrapped);

        // And the envelope unwraps back to the original bytes.
        const recovered = unwrapDek(reloaded!.encryptedDek!);
        expect(recovered.equals(dek)).toBe(true);
        expect(recovered.length).toBe(DEK_LENGTH_BYTES);
    });

    test('two tenants hold independent wrapped DEKs', async () => {
        const a = generateAndWrapDek();
        const b = generateAndWrapDek();
        const slugA = `dek-iso-a-${Date.now()}`;
        const slugB = `dek-iso-b-${Date.now()}`;
        slugs.push(slugA, slugB);

        const tenantA = await prisma.tenant.create({
            data: { name: 'A', slug: slugA, encryptedDek: a.wrapped },
        });
        const tenantB = await prisma.tenant.create({
            data: { name: 'B', slug: slugB, encryptedDek: b.wrapped },
        });

        expect(tenantA.encryptedDek).not.toBe(tenantB.encryptedDek);
        expect(unwrapDek(tenantA.encryptedDek!).equals(a.dek)).toBe(true);
        expect(unwrapDek(tenantB.encryptedDek!).equals(b.dek)).toBe(true);
        // Cross-check — unwrapping with the OTHER tenant's wrapped DEK
        // must not produce the intended DEK (catches a wiring bug
        // where tenants accidentally share).
        expect(unwrapDek(tenantA.encryptedDek!).equals(b.dek)).toBe(false);
    });

    test('Tenant.encryptedDek can be updated (rotation-ready)', async () => {
        const slug = `dek-rotate-${Date.now()}`;
        slugs.push(slug);
        const first = generateAndWrapDek();
        const tenant = await prisma.tenant.create({
            data: {
                name: 'DEK rotation check',
                slug,
                encryptedDek: first.wrapped,
            },
        });
        expect(unwrapDek(tenant.encryptedDek!).equals(first.dek)).toBe(true);

        // Simulate a rotation — new DEK, updated row.
        const second = generateAndWrapDek();
        const rotated = await prisma.tenant.update({
            where: { id: tenant.id },
            data: { encryptedDek: second.wrapped },
        });
        expect(unwrapDek(rotated.encryptedDek!).equals(second.dek)).toBe(true);
        expect(rotated.encryptedDek).not.toBe(first.wrapped);
    });

    test('CHECK constraint rejects identical DEK values — silent-key-mixing guard', async () => {
        const slug = `rot-constraint-${Date.now()}`;
        slugs.push(slug);
        const t = await prisma.tenant.create({
            data: { name: 'rot-constraint', slug, encryptedDek: 'v1:dGVzdA==' },
        });
        await expect(
            prisma.tenant.update({
                where: { id: t.id },
                data: { previousEncryptedDek: 'v1:dGVzdA==' },
            }),
        ).rejects.toThrow(/Tenant_previousEncryptedDek_differs|check constraint/i);
        // A different outgoing DEK is accepted: the CHECK is not a blanket refusal.
        const ok = await prisma.tenant.update({ where: { id: t.id }, data: { previousEncryptedDek: 'v1:b3RoZXI=' } });
        expect(ok.previousEncryptedDek).toBe('v1:b3RoZXI=');
    });

    test('the rotation-in-flight partial index exists with its predicate', async () => {
        const rows = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
            `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Tenant' AND indexname = 'Tenant_rotation_in_flight_idx'`,
        );
        expect(rows).toHaveLength(1);
        // pg_get_indexdef prints an unquoted lower-case column bare.
        expect(rows[0]!.indexdef).toMatch(/USING btree \(id\)/);
        expect(rows[0]!.indexdef).toMatch(/WHERE \("previousEncryptedDek" IS NOT NULL\)/);
    });
});
