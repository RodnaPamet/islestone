/**
 * The scale seeder runs on every pull request (Hardening H2a,
 * docs/performance.md): the Performance job restores a cached dump while
 * nothing it hashes changed, so this suite seeds the `mini` shape on the
 * integration database to keep the seeder from rotting against the usecases
 * it calls. The seed's own verification (counts, both audit chains, 100
 * decrypted descriptions found by their own text, the two-tenant read)
 * runs at the end of every seed and is asserted here.
 */
import type { PrismaClient } from '@prisma/client';

import { seedScale } from '../../scripts/seed-scale/seed';
import { SHAPES, shapeItemCount } from '../../scripts/seed-scale/shapes';

import { getTestDirectDatabaseUrl, prismaTestClient, resetDatabase } from '../helpers/db';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('the scale seeder (mini shape)', () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        await resetDatabase(prisma);
        await prisma.$disconnect();
    });

    it('seeds both workspaces and verifies them; a second run keeps them', async () => {
        // Small batches, so BLOCKS edges and sub-items cross from one batch into the next.
        const first = await seedScale({ shape: SHAPES.mini, bulkUrl: getTestDirectDatabaseUrl(), batchSize: 64 });
        expect(first.seededSlugs).toEqual(['perf-mini', 'perf-mini-sibling']);
        const [a, b] = first.report.workspaces;
        for (const w of [a!, b!]) {
            expect(w.items).toBe(shapeItemCount(SHAPES.mini));
            expect(w.decryptedChecked).toBe(100);
            expect(w.searchVectors).toBe(w.describedItems + w.liveComments);
            expect(w.auditEntries).toBeGreaterThan(0);
        }

        const second = await seedScale({ shape: SHAPES.mini, bulkUrl: getTestDirectDatabaseUrl() });
        expect(second.seededSlugs).toEqual([]);
        expect(second.report.workspaces.map((w) => w.items)).toEqual([shapeItemCount(SHAPES.mini), shapeItemCount(SHAPES.mini)]);
    }, 300_000);
});
