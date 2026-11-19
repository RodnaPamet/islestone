/**
 * GUARD — every executor registration reads its payload.
 *
 * Rule 8 of `src/app-layer/jobs/types.ts`: an executor that names its payload
 * `_payload`, or takes no parameter at all, silently drops what the enqueuer
 * sent — most dangerously a `tenantId`, so an operator's single-workspace
 * re-run becomes a drain of every workspace. (inflect-compliance found that
 * class with a 445-line behavioural regression over its compliance jobs; with
 * Islestone's two jobs the rule is cheaper to hold structurally, and the
 * `NamesEveryField` forward in the outbox flush holds the field-by-field half
 * at the type level.)
 *
 * Reads the live registrations in `executor-registry.ts` (comments masked),
 * and proves the detector against planted registrations.
 *
 * Written for Islestone (sub-phase 1.6; porting map "new tests").
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { codeOf } from '../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../..');

interface Registration {
    readonly job: string;
    readonly params: string;
}

function registrationsIn(code: string): Registration[] {
    return [...code.matchAll(/executorRegistry\.register\(\s*'([a-z0-9-]+)'\s*,\s*async\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/g)].map(
        (m) => ({ job: m[1]!, params: (m[2] ?? m[3] ?? '').trim() }),
    );
}

/** Registrations whose first parameter is missing or underscore-prefixed. */
function ignoringPayload(regs: readonly Registration[]): string[] {
    return regs
        .filter((r) => {
            const first = r.params.split(',')[0]!.trim().split(':')[0]!.trim();
            return first === '' || first.startsWith('_');
        })
        .map((r) => r.job);
}

describe('GUARD: executors read their payload', () => {
    const code = codeOf(fs.readFileSync(path.join(ROOT, 'src/app-layer/jobs/executor-registry.ts'), 'utf8'));
    const regs = registrationsIn(code);

    it('parses every registration (the population is real)', () => {
        // As many parsed as the file registers: a registration the pattern
        // cannot read would otherwise escape the check.
        const calls = code.match(/executorRegistry\.register\(/g) ?? [];
        expect(regs.map((r) => r.job).sort()).toEqual(['health-check', 'notification-outbox-flush']);
        expect(regs).toHaveLength(calls.length);
    });

    it('no executor takes `_payload` or no parameter', () => {
        expect(ignoringPayload(regs)).toEqual([]);
    });

    it('the detector flags planted registrations that drop the payload', () => {
        const planted = registrationsIn(
            codeOf(`
                executorRegistry.register('reads-it', async (payload) => run(payload.tenantId));
                executorRegistry.register('underscored', async (_payload) => run());
                executorRegistry.register('typed-underscored', async (_p: Payload, ctx) => run(ctx));
                executorRegistry.register('no-params', async () => run());
                executorRegistry.register('bare', async payload => run(payload));
                // executorRegistry.register('commented', async () => run());
            `),
        );
        expect(planted.map((r) => r.job)).toEqual(['reads-it', 'underscored', 'typed-underscored', 'no-params', 'bare']);
        expect(ignoringPayload(planted)).toEqual(['underscored', 'typed-underscored', 'no-params']);
    });
});
