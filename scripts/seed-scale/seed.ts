/**
 * The scale seed's driver (Hardening H2a; docs/performance.md): both
 * workspaces of a shape, then `ANALYZE`, then the verification. Importable,
 * so the integration suite runs it at the `mini` shape; `index.ts` is the
 * command line.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { BATCH_SIZE, seedProjectBulk } from './bulk';
import { planProject } from './plan';
import { stream } from './random';
import { seedProjectSample } from './sample';
import { sampleCount, shapeItemCount, type Shape } from './shapes';
import { verifySeed, type SeedReport } from './verify';
import { existingWorkspace, seedConfiguration, type SeedEnv } from './workspace';

export const DEFAULT_SEED = 'islestone-h2';

/** The two workspaces of a shape: the measured one and its sibling. */
export function workspaceSlugs(shape: Shape): readonly [string, string] {
    return [`perf-${shape.name}`, `perf-${shape.name}-sibling`];
}

/** The superuser client the bulk writer uses (no extensions: it writes what it was given). */
export function bulkClient(url: string): PrismaClient {
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 4 }) });
}

export interface SeedRun {
    report: SeedReport;
    seededSlugs: string[];
    seconds: number;
}

export async function seedScale(opts: {
    shape: Shape;
    seed?: string;
    bulkUrl: string;
    log?: (line: string) => void;
    verifyOnly?: boolean;
    /** Items per bulk batch; defaults to BATCH_SIZE (5,000). */
    batchSize?: number;
}): Promise<SeedRun> {
    const started = Date.now();
    const log = opts.log ?? (() => undefined);
    const now = new Date();
    const env: SeedEnv = {
        seed: opts.seed ?? DEFAULT_SEED,
        anchor: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        log,
        batchSize: opts.batchSize ?? BATCH_SIZE,
    };
    const bulk = bulkClient(opts.bulkUrl);
    const slugs = workspaceSlugs(opts.shape);
    const seededSlugs: string[] = [];
    try {
        for (const slug of slugs) {
            if (opts.verifyOnly || (await existingWorkspace(slug, shapeItemCount(opts.shape)))) {
                log(`${slug}: present, not seeded again`);
                continue;
            }
            log(`${slug}: seeding the ${opts.shape.name} shape`);
            const ws = await seedConfiguration(env, bulk, opts.shape, slug);
            for (const project of ws.projects) {
                const team = ws.teams.find((t) => t.id === project.teamId)!;
                const plans = planProject(stream(env.seed, `${slug}:items:${project.keyPrefix}`), {
                    size: project.size,
                    anchor: env.anchor,
                    assignable: ws.writers.length,
                    members: ws.members.length,
                    writers: ws.writers.length,
                    labels: ws.labelIds.length,
                    pastCycles: team.cycles.filter((c) => c.past).length,
                    cycles: team.cycles.length,
                    milestones: project.milestones.length,
                });
                const from = project.size - sampleCount(project.size);
                const bulkResult = await seedProjectBulk(env, bulk, ws, project, plans, from);
                await seedProjectSample(env, ws, project, plans, from, bulkResult);
            }
            seededSlugs.push(slug);
        }
        if (seededSlugs.length > 0) {
            log('ANALYZE');
            await bulk.$executeRawUnsafe('ANALYZE');
        }
        log('verifying');
        const report = await verifySeed(bulk, opts.shape, slugs);
        return { report, seededSlugs, seconds: (Date.now() - started) / 1000 };
    } finally {
        await bulk.$disconnect();
    }
}
