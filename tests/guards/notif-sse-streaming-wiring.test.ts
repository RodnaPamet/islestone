/**
 * SSE notification streaming wiring.
 *
 * Locks the surfaces this feature crosses so a refactor cannot silently
 * strand the streaming path and leave the bell on its fallback poll:
 *
 *   1. The in-process bus module exists at the canonical path with
 *      `subscribeToNotifications` + `publishNotificationEvent` + the
 *      `NotificationEvent` shape exported, filters by tenant AND user, and
 *      drops a subscriber whose send throws.
 *   2. The workspace SSE route is a Node-runtime force-dynamic GET that hands
 *      its signal to the shared stream, which writes `text/event-stream`,
 *      subscribes on connect, unsubscribes on abort and sends a heartbeat.
 *   3. Both bell writers (`assignment.ts`, `watcher.ts`) publish to the bus
 *      only AFTER a successful insert (count > 0): a deduplicated write does
 *      not re-fan to subscribers.
 *
 * Copied from inflect-compliance `tests/guards/notif-sse-streaming-wiring.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e. Islestone has one stream route,
 * the workspace's (the flat `/api/notifications/stream` used a context 1.3
 * deleted and is not ported); part 3 asserts the two Islestone bell writers in
 * place of `task-due.ts` (2.2); part 4, the bell client, comes with the bell
 * in sub-phase 1.7.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// #2246 Class A — `codeOf` masks comments at the READ SEAM, so a guard can no
// longer be satisfied by a COMMENT naming the thing its assertion is about.
// Applied here rather than per assertion so a new `expect(read(...))` inherits
// it. String literals are KEPT: masking them would silently empty assertions
// that harvest codes or ids from source. Every path this file reads is a
// TypeScript-alike (re-derived per file, not assumed from the directory), so
// `codeOf` is the right lexer and no language split is needed.
import { codeOf } from '../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => codeOf(readFileSync(path.join(ROOT, p), 'utf-8'));

describe('PR-C SSE notification streaming wiring', () => {
    describe('1. Notification bus module', () => {
        const PATH_BUS = 'src/lib/notifications/notification-bus.ts';
        it('file exists', () => {
            expect(existsSync(path.join(ROOT, PATH_BUS))).toBe(true);
        });

        it('exports subscribe + publish + the event type', () => {
            const s = read(PATH_BUS);
            expect(s).toMatch(/export function subscribeToNotifications/);
            expect(s).toMatch(/export function publishNotificationEvent/);
            expect(s).toMatch(/export interface NotificationEvent/);
        });

        it('filters publishes by both tenantId AND userId', () => {
            // Anti-leak: a cross-tenant or cross-user fan-out would
            // surface another user's notification text to the bell.
            const s = read(PATH_BUS);
            expect(s).toMatch(/sub\.tenantId !== tenantId/);
            expect(s).toMatch(/sub\.userId !== userId/);
        });

        it('drops a subscriber whose send() throws (poison-pill recovery)', () => {
            const s = read(PATH_BUS);
            expect(s).toMatch(/try \{\s*sub\.send/);
            expect(s).toMatch(/subscribers\.delete\(sub\)/);
        });
    });

    describe('2. The SSE route and the stream it uses', () => {
        const PATH_WORKSPACE_ROUTE = 'src/app/api/t/[tenantSlug]/notifications/stream/route.ts';
        const PATH_SSE = 'src/lib/notifications/notification-sse.ts';

        it('the route exists at its canonical path, and the shared stream does', () => {
            expect(existsSync(path.join(ROOT, PATH_WORKSPACE_ROUTE))).toBe(true);
            expect(existsSync(path.join(ROOT, PATH_SSE))).toBe(true);
        });

        it('the workspace route uses Node runtime + force-dynamic, and hands its signal to the shared stream', () => {
            const s = read(PATH_WORKSPACE_ROUTE);
            expect(s).toMatch(/export const runtime = ['"]nodejs['"]/);
            expect(s).toMatch(/export const dynamic = ['"]force-dynamic['"]/);
            expect(s).toMatch(/return notificationStreamResponse\(ctx, req\.signal\)/);
        });

        it('the stream returns Content-Type: text/event-stream with no-cache + X-Accel-Buffering', () => {
            const s = read(PATH_SSE);
            expect(s).toMatch(/['"]Content-Type['"]:\s*['"]text\/event-stream/);
            expect(s).toMatch(/['"]Cache-Control['"]:\s*['"]no-cache, no-transform['"]/);
            expect(s).toMatch(/['"]X-Accel-Buffering['"]:\s*['"]no['"]/);
        });

        it('the stream subscribes on connect + unsubscribes on abort', () => {
            const s = read(PATH_SSE);
            expect(s).toMatch(/subscribeToNotifications\(/);
            expect(s).toMatch(/signal\.addEventListener\(['"]abort['"]/);
        });

        it('the stream emits an SSE heartbeat comment on a fixed cadence (proxy-keep-alive)', () => {
            const s = read(PATH_SSE);
            expect(s).toMatch(/HEARTBEAT_INTERVAL_MS/);
            expect(s).toMatch(/setInterval\(/);
            // SSE comment line — starts with `:` per the wire format.
            expect(s).toMatch(/: hb\\n\\n/);
        });
    });

    describe('3. The bell writers publish to the bus on insert only', () => {
        const WRITERS = [
            {
                file: 'src/app-layer/notifications/assignment.ts',
                signature: /publishNotificationEvent\(\s*target\.tenantId,\s*target\.assigneeUserId,/,
            },
            {
                file: 'src/app-layer/notifications/watcher.ts',
                signature: /publishNotificationEvent\(\s*a\.tenantId,\s*row\.userId,/,
            },
        ];

        it.each(WRITERS)('$file imports publishNotificationEvent', ({ file }) => {
            expect(read(file)).toMatch(
                /import\s*\{\s*publishNotificationEvent\s*\}\s*from\s*['"]@\/lib\/notifications\/notification-bus['"]/,
            );
        });

        it.each(WRITERS)('$file publishes ONLY when result.count > 0 (duplicates skip publish)', ({ file }) => {
            const s = read(file);
            const branch = s.indexOf('if (result.count > 0) {');
            const publish = s.indexOf('publishNotificationEvent(');
            expect(branch).toBeGreaterThan(-1);
            expect(publish).toBeGreaterThan(branch);
            // The one publish call sits inside that branch: no second call elsewhere.
            expect(s.split('publishNotificationEvent(').length - 1).toBe(1);
        });

        it.each(WRITERS)('$file publishes with the canonical (tenantId, userId, event) signature', ({ file, signature }) => {
            expect(read(file)).toMatch(signature);
        });
    });
});
