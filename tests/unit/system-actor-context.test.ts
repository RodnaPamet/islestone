/**
 * B2-1c (#35) — machine activity is recorded as machine activity, and no
 * job borrows a real member's authority.
 *
 * In inflect-compliance, thirteen jobs and sweeps each hand-rolled a `RequestContext` with
 * `role: 'ADMIN'`. Two things were wrong with that, and they are
 * different problems with different fixes:
 *
 *   1. **The audit trail lied.** `logEvent` hardcoded `actorType: 'USER'`,
 *      so every row a sweep wrote claimed a person acted. Eight of the
 *      contexts also used the non-existent `userId: 'system'`, which
 *      resolves to nobody — a reviewer could not filter machine writes
 *      out, and could not tell a nightly sweep from a deliberate change.
 *
 *   2. **Four of them escalated a REAL user.** They kept a genuine
 *      `userId` — the policy owner, the evidence owner, the test-plan
 *      author — and pinned ADMIN on top. `policyReviewReminder` said so
 *      in its own docblock: "ADMIN permissions clear
 *      `assertCanWriteTasks`". A READER who owned a policy therefore had
 *      an admin-authority write committed under their name.
 *
 * These tests execute the real code paths rather than scanning source,
 * because the defect is entirely about what VALUE reaches the audit
 * writer — a regex over `actorType` would pass on a context that never
 * reaches `logEvent` at all.
 */
const mockAppendAuditEntry = jest.fn().mockResolvedValue({ id: 'audit_1' });
jest.mock('@/lib/audit/audit-writer', () => ({
    __esModule: true,
    appendAuditEntry: (...a: unknown[]) => mockAppendAuditEntry(...a),
}));

import { logEvent } from '@/app-layer/events/audit';
import { makeRequestContext } from '../helpers/make-context';

/**
 * Sub-phase 1.5 keeps the `logEvent` half. `buildSystemContext` and
 * `SYSTEM_PRINCIPAL` arrive with sub-phase 1.6 (`context-system.ts`), which
 * restores its describe and the "no hand-rolled ADMIN context" scan; until
 * then the JOB context is built by hand, with the principal's literal.
 */
const SYSTEM_PRINCIPAL = 'system';

const db = {} as Parameters<typeof logEvent>[0];

const PAYLOAD = {
    action: 'MEMBER_ROLE_CHANGED',
    entityType: 'TenantMembership',
    entityId: 'membership_1',
} as Parameters<typeof logEvent>[2];

beforeEach(() => {
    mockAppendAuditEntry.mockClear();
});

describe('logEvent — actorType follows the context', () => {
    it('writes JOB for a system context', async () => {
        const ctx = makeRequestContext('ADMIN', {
            tenantId: 'tenant_1',
            userId: SYSTEM_PRINCIPAL,
            actorType: 'JOB',
        });
        await logEvent(db, ctx, PAYLOAD);

        expect(mockAppendAuditEntry).toHaveBeenCalledTimes(1);
        const entry = mockAppendAuditEntry.mock.calls[0][0];
        expect(entry.actorType).toBe('JOB');
        expect(entry.userId).toBe(SYSTEM_PRINCIPAL);
    });

    /**
     * The regression that matters in the other direction. `appendAuditEntry`
     * defaults an absent `actorType` to 'USER', so an HTTP-borne context —
     * which never sets the field — must still be recorded as a user action.
     * If this ever went to 'JOB'/undefined-as-machine, every human action in
     * the product would be mislabelled.
     */
    it('leaves a normal request context as a USER action', async () => {
        const ctx = makeRequestContext('MEMBER', { tenantId: 'tenant_1', userId: 'user_1' });
        await logEvent(db, ctx, PAYLOAD);

        const entry = mockAppendAuditEntry.mock.calls[0][0];
        // Either explicitly USER, or absent — the writer defaults it.
        expect(entry.actorType ?? 'USER').toBe('USER');
        expect(entry.userId).toBe('user_1');
    });
});
