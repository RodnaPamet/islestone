/**
 * Publish the forecast's calibration (sub-phase 3.6c; Hardening H3; owner
 * decision 325; docs/porting/maps/3.6.md, "Calibration"):
 *
 *   npx tsx scripts/forecast-calibration.ts [--shape 10k|100k] [--write] [--json]
 *   npm run forecast:calibration -- --shape 100k --write
 *
 * Runs H3's back-test (`backtestWorkspaceForecasts`: every project of the
 * seeded workspace `perf-<shape>`, the next 10, 25 and 50 completions from
 * every weekly origin, the history as it stood then) as the workspace's
 * owner, and prints each percentile's hit rate with its scorable origins and
 * a 95 % band. `--write` replaces the table in `docs/analytics.md` between
 * the `forecast-calibration` markers. The history is the scale seed's
 * back-dated, synthetic record (`scripts/seed-scale/history.ts`), and the
 * table says so; the real calibration is 9.1's weekly review.
 *
 * Needs the seeded database's environment, as `npm run seed:scale` does
 * (`DATABASE_URL`, `DIRECT_DATABASE_URL`, `DATA_ENCRYPTION_KEY`, and what
 * `src/env.ts` validates). Exit 0 printed (and written), 1 a failure, 2 a
 * usage error. Written fresh for Islestone.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveMemberContext } from '../src/app-layer/context-system';
import { backtestWorkspaceForecasts, type CalibrationResult } from '../src/app-layer/usecases/forecast-calibration';
import { prisma } from '../src/lib/prisma';

const DOC = path.resolve(__dirname, '..', 'docs', 'analytics.md');
const BEGIN = '<!-- forecast-calibration:begin -->';
const END = '<!-- forecast-calibration:end -->';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)} %`;

/** The published table. */
function calibrationTable(r: CalibrationResult, shape: string, day: string): string {
    const cell = (s: CalibrationResult['bySize'][number]['scores']['p85']) =>
        s.scorable === 0 ? 'none scorable' : `${pct(s.held / s.scorable)} (${s.held} of ${s.scorable}; band ${pct(s.band![0])} to ${pct(s.band![1])})`;
    const lines = [
        `Back-tested on ${day} over the ${shape} scale seed's synthetic, back-dated record (\`scripts/seed-scale/history.ts\`): ${r.projects} projects, each forecast from its own completions over the last ${r.weeks} weeks as the record stood at each weekly origin, ${r.trials.toLocaleString('en-GB')} trials, share 100 %. A hit is the actual day on or before the percentile's date; the band is the 95 % Wilson interval.`,
        '',
        '| Next completions | Origins | 50 % date held | 85 % date held | 95 % date held |',
        '|---|---|---|---|---|',
        ...r.bySize.map((s) => `| ${s.size} | ${s.origins}${s.refused > 0 ? ` (${s.refused} refused)` : ''} | ${cell(s.scores.p50)} | ${cell(s.scores.p85)} | ${cell(s.scores.p95)} |`),
    ];
    return lines.join('\n');
}

async function main(): Promise<number> {
    const shape = arg('shape') ?? '10k';
    if (!/^(10k|100k|mini)$/.test(shape)) {
        console.error(`forecast-calibration: unknown shape ${shape} (10k, 100k or mini)`);
        return 2;
    }
    const tenant = await prisma.tenant.findUnique({ where: { slug: `perf-${shape}` }, select: { id: true } });
    if (!tenant) {
        console.error(`forecast-calibration: no workspace perf-${shape}; seed it first (npm run seed:scale -- --shape ${shape})`);
        return 1;
    }
    const owner = await prisma.tenantMembership.findFirst({ where: { tenantId: tenant.id, role: 'OWNER' }, select: { userId: true } });
    const ctx = owner ? await resolveMemberContext({ tenantId: tenant.id, userId: owner.userId, job: 'forecast-calibration' }) : null;
    if (!ctx) {
        console.error(`forecast-calibration: the owner of perf-${shape} does not resolve`);
        return 1;
    }
    const result = await backtestWorkspaceForecasts(ctx);
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify(result, null, 2));
    }
    const table = calibrationTable(result, shape, new Date().toISOString().slice(0, 10));
    console.log(table);
    if (process.argv.includes('--write')) {
        const doc = fs.readFileSync(DOC, 'utf8');
        const a = doc.indexOf(BEGIN);
        const b = doc.indexOf(END);
        if (a < 0 || b < a) {
            console.error(`forecast-calibration: ${DOC} has no ${BEGIN} … ${END} block`);
            return 1;
        }
        fs.writeFileSync(DOC, `${doc.slice(0, a + BEGIN.length)}\n${table}\n${doc.slice(b)}`);
        console.log(`forecast-calibration: wrote ${path.relative(process.cwd(), DOC)}`);
    }
    return 0;
}

main()
    .then(async (code) => {
        await prisma.$disconnect();
        process.exit(code);
    })
    .catch(async (err: unknown) => {
        console.error(err);
        await prisma.$disconnect();
        process.exit(1);
    });
