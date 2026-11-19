/**
 * The worker's and scheduler's lines carry `requestId` (inflect #5022).
 *
 * In inflect-compliance the log shipper forwarded a container line only when
 * its text contained `requestId` and `msg`; the worker logged through a bare
 * `pino()` with no `requestId`, so none of its job lines, failures included,
 * ever left the VM. Islestone's shipper arrives with sub-phase 1.8, and these
 * tests hold every line of the shared process logger to the same two fields,
 * so the shipper can rely on them.
 *
 * Copied from inflect-compliance `tests/unit/observability/process-logger.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e; the strings are pinned here
 * rather than read from inflect's agent config, which Islestone does not have.
 */
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import * as ts from 'typescript';

import { createProcessLogger } from '@/lib/observability/process-logger';
import { repoFiles, repoRelative } from '../../helpers/repo-files';

/** Every string a forwarded line must contain. */
function requiredSubstrings(): string[] {
    return ['requestId', 'msg'];
}

function capture(): { stream: Writable; lines: string[] } {
    const lines: string[] = [];
    const stream = new Writable({
        write(chunk, _enc, cb) {
            lines.push(...String(chunk).split('\n').filter(Boolean));
            cb();
        },
    });
    return { stream, lines };
}

describe('the worker and scheduler logs carry requestId (#5022)', () => {
    it.each(['worker', 'scheduler'] as const)(
        'every %s line, at every level, contains what the filter keeps',
        (name) => {
            const { stream, lines } = capture();
            const log = createProcessLogger(name, stream);
            log.info({ jobName: 'notification-outbox-flush', jobId: 'j1' }, 'processing job');
            log.error({ jobName: 'notification-outbox-flush', errorMessage: 'connect ECONNREFUSED' }, 'job processing failed');
            log.warn({ jobId: 'j1' }, 'job stalled — will be retried');
            log.fatal('REDIS_URL is not set. Cannot start worker.');

            expect(lines).toHaveLength(4);
            const needles = requiredSubstrings();
            for (const line of lines) {
                expect(needles.filter((n) => !line.includes(n))).toEqual([]);
                expect(JSON.parse(line).requestId).toBe(name);
            }
        },
    );

    it('a requestId passed to a call still wins', () => {
        const { stream, lines } = capture();
        createProcessLogger('worker', stream).info({ requestId: 'job-42' }, 'processing job');
        expect(JSON.parse(lines[0]).requestId).toBe('job-42');
    });
});

describe('no process builds its own pino instance', () => {
    /**
     * A bare `pino(...)` is how the worker's lines lost `requestId`. Two files
     * may construct one: the app logger and the process logger.
     */
    const ALLOWED = new Set(['src/lib/observability/logger.ts', 'src/lib/observability/process-logger.ts']);

    it('pino() is called only by the two observability loggers', () => {
        const callers: string[] = [];
        for (const file of [
            ...repoFiles({ under: 'src', extensions: ['.ts', '.tsx'] }),
            ...repoFiles({ under: 'scripts', extensions: ['.ts', '.mts', '.mjs'] }),
        ]) {
            const text = readFileSync(file, 'utf8');
            if (!/\bpino\s*\(/.test(text)) continue;
            const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
            const visit = (node: ts.Node): void => {
                if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'pino') {
                    callers.push(repoRelative(file));
                }
                ts.forEachChild(node, visit);
            };
            visit(sf);
        }
        expect([...new Set(callers)].filter((f) => !ALLOWED.has(f))).toEqual([]);
        expect(new Set(callers)).toEqual(ALLOWED);
    });
});
