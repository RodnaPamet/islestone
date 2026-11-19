/**
 * The logger for a standalone process: the BullMQ worker and the scheduler (#5022).
 *
 * Those two processes start from `scripts/` and log before, around and outside
 * any request context, so they cannot use `log()` from `./logger`, which reads
 * one. In inflect-compliance they each built a bare `pino()` instead, and its
 * lines carried no `requestId`. That mattered more than it looks: inflect's log
 * shipper forwards a container line only if its text contains `requestId`
 * (how it tells the app's Pino JSON from other containers' plain text), so
 * every line the worker wrote about a job stayed in a container log that was
 * discarded on every new image. Islestone's shipper (sub-phase 1.8) can rely
 * on the same field.
 *
 * Every line from this logger carries `requestId`, set to the process name,
 * the way `log()` sets `'unknown'` outside a request. A field passed to a call
 * still wins, so a line that knows its job can name it.
 *
 * Imports nothing but pino and the server env module: the worker bundle is
 * built from `scripts/` and should not pull the observability barrel in for
 * one logger. `tests/unit/observability/process-logger.test.ts` holds every
 * line to carrying `requestId`.
 *
 * Copied from inflect-compliance `src/lib/observability/process-logger.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e; `NODE_ENV` and `LOG_LEVEL` are
 * read through `@/env`.
 */
import pino from 'pino';

import { env } from '@/env';

export type ProcessName = 'worker' | 'scheduler';

export function createProcessLogger(
    processName: ProcessName,
    destination?: pino.DestinationStream,
): pino.Logger {
    const pretty = env.NODE_ENV !== 'production' && destination === undefined;
    return pino(
        {
            level: env.LOG_LEVEL || 'info',
            mixin: () => ({ requestId: processName }),
            transport: pretty
                ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname', translateTime: 'HH:MM:ss.l' } }
                : undefined,
        },
        destination,
    );
}
