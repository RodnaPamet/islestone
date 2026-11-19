/**
 * Structural guard — the mailer MUST be initialized from env at startup.
 *
 * `initMailerFromEnv()` swaps the mailer from the dev console sink to the
 * real SMTP transport when `SMTP_HOST` is configured. For a long time it
 * existed but was never called in production startup, so EVERY email
 * (verification, password reset, notification outbox, invites) silently
 * went to the console sink and never reached a recipient — even with SMTP
 * configured.
 *
 * Both server entrypoints must call it: the web tier (the startup hook's
 * Node.js half, `src/instrumentation-node.ts`) and the BullMQ worker
 * (`scripts/worker.ts`, which runs the notification outbox + digests). This
 * guard fails if either drops the call. Islestone has no SMTP transport yet
 * (nodemailer awaits a licence decision), so today the call only reports the
 * transport; the wiring is what the transport will need when it lands.
 *
 * Copied from inflect-compliance `tests/guards/mailer-init-wiring.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e. inflect's third case (the
 * mailer reads raw `process.env`) is inverted: Islestone forbids raw reads in
 * `src/` (tests/guards/no-raw-process-env.test.ts), so it asserts the read
 * goes through `@/env`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// #2246 Class A — `codeOf` masks comments at the READ SEAM, so this guard can
// no longer be satisfied by a COMMENT naming the thing its assertion is about.
// At the seam, not per assertion, so a new `expect(read(...))` inherits it.
// String literals are KEPT — masking them would silently empty assertions that
// harvest codes or ids from source. Every path this file reads is a
// TypeScript-alike, re-derived per file rather than assumed from the directory.
import { codeOf } from '../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => codeOf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

describe('mailer initialization wiring', () => {
    it('web instrumentation calls initMailerFromEnv()', () => {
        const src = read('src/instrumentation-node.ts');
        expect(src).toContain('initMailerFromEnv');
        expect(src).toMatch(/initMailerFromEnv\s*\(\s*\)/);
    });

    it('the BullMQ worker calls initMailerFromEnv()', () => {
        const src = read('scripts/worker.ts');
        expect(src).toContain('initMailerFromEnv');
        expect(src).toMatch(/initMailerFromEnv\s*\(\s*\)/);
    });

    it('initMailerFromEnv reads SMTP_HOST through @/env, never raw process.env', () => {
        const src = read('src/lib/mailer.ts');
        const initBlock = src.slice(src.indexOf('export function initMailerFromEnv'));
        expect(initBlock).toMatch(/\benv\.SMTP_HOST\b/);
        expect(initBlock).not.toMatch(/process\.env/);
        expect(src).toMatch(/import \{ env \} from '@\/env'/);
    });
});
