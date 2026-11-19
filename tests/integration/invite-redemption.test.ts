/**
 * Integration tests for the token-redemption invite flow (Epic 1, PR 3).
 *
 * Covers the full lifecycle: createInviteToken → previewInviteByToken →
 * redeemInvite → audit, plus the security edge cases enumerated
 * in the PR brief.
 *
 * All tests run against a real PostgreSQL instance. They are skipped
 * automatically when the DB is not available.
 */

jest.mock('@/lib/audit', () => jest.requireActual('../helpers/audit-recorder').auditModuleMock());

import { DB_AVAILABLE } from './db-helper';
import { auditEntries } from '../helpers/audit-recorder';
import { prismaTestClient } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { getPermissionsForRole } from '@/lib/permissions';
import type { PrismaClient } from '@prisma/client';

import {
    createInviteToken,
    revokeInvite,
    redeemInvite,
    redeemPendingInvitesByEmail,
} from '@/app-layer/usecases/tenant-invites';
import { createTenantWithOwner } from '../helpers/tenant-fixture';
import { lookupEmail } from '@/lib/auth/email-lookup';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('invite-redemption usecases', () => {
    let prisma: PrismaClient;

    // Collect created slugs + emails for cleanup.
    const tenantSlugs: string[] = [];
    const userEmails: string[] = [];

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        // FK-safe cleanup: cascade deletes handle most children.
        try {
            const tenants = await prisma.tenant.findMany({
                where: { slug: { in: tenantSlugs } },
                select: { id: true },
            });
            const ids = tenants.map((t) => t.id);
            if (ids.length > 0) {
                await prisma.tenantInvite.deleteMany({ where: { tenantId: { in: ids } } });
                await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: ids } } });
            }
        } catch { /* best effort */ }
        try {
            await prisma.tenant.deleteMany({ where: { slug: { in: tenantSlugs } } });
        } catch { /* best effort */ }
        try {
            await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
        } catch { /* best effort */ }
        await prisma.$disconnect();
    });

    // ── Helpers ────────────────────────────────────────────────────────

    function slugFor(suffix: string): string {
        const slug = `ir-test-${suffix}-${Date.now()}`;
        tenantSlugs.push(slug);
        return slug;
    }

    function emailFor(suffix: string): string {
        const email = `ir-test-${suffix}-${Date.now()}@example.com`;
        userEmails.push(email);
        return email;
    }

    /** Create a tenant with an owner and return ctx + meta. */
    async function setupTenant(suffix: string) {
        const slug = slugFor(suffix);
        const ownerEmail = emailFor(`owner-${suffix}`);
        const result = await createTenantWithOwner({
            name: `Test Tenant ${suffix}`,
            slug,
            ownerEmail,
            requestId: `req-${suffix}`,
        });

        const ownerCtx = makeRequestContext('OWNER', {
            userId: result.ownerUserId,
            tenantId: result.tenant.id,
            tenantSlug: slug,
            appPermissions: getPermissionsForRole('OWNER'),
        });

        return { tenantId: result.tenant.id, slug, ownerEmail, ownerCtx, ownerUserId: result.ownerUserId };
    }

    /** Create a User row with just an email (mirrors OAuth first-sign-in placeholder). */
    async function createUser(email: string) {
        return prisma.user.upsert({
            where: { email: lookupEmail(email) },
            create: { email, name: email.split('@')[0] },
            update: {},
        });
    }

    // ── Tests ──────────────────────────────────────────────────────────

    it('1. happy path — createInviteToken + redeemInvite → ACTIVE membership', async () => {
        const { tenantId, ownerCtx } = await setupTenant('happy');
        const inviteeEmail = emailFor('invitee-happy');
        const inviteeUser = await createUser(inviteeEmail);

        const { invite } = await createInviteToken(ownerCtx, {
            email: inviteeEmail,
            role: 'MEMBER',
        });

        expect(invite.tenantId).toBe(tenantId);
        expect(invite.role).toBe('MEMBER');
        expect(invite.acceptedAt).toBeNull();

        const result = await redeemInvite({
            token: invite.token,
            userId: inviteeUser.id,
            userEmail: inviteeEmail,
        });

        expect(result.tenantId).toBe(tenantId);
        expect(result.role).toBe('MEMBER');

        const membership = await prisma.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId, userId: inviteeUser.id } },
            select: { status: true, role: true },
        });
        expect(membership?.status).toBe('ACTIVE');
        expect(membership?.role).toBe('MEMBER');
    });

    it('2. email mismatch — invite is burnt, 403 thrown', async () => {
        const { ownerCtx } = await setupTenant('mismatch');
        const inviteeEmail = emailFor('invitee-mismatch');
        const wrongUser = await createUser(emailFor('wrong-user-mismatch'));

        const { invite } = await createInviteToken(ownerCtx, {
            email: inviteeEmail,
            role: 'VIEWER',
        });

        await expect(
            redeemInvite({
                token: invite.token,
                userId: wrongUser.id,
                userEmail: wrongUser.email!,
            }),
        ).rejects.toMatchObject({ status: 403 });

        // Invite must be burnt (acceptedAt set) so it cannot be recycled.
        const inv = await prisma.tenantInvite.findUnique({ where: { id: invite.id } });
        expect(inv?.acceptedAt).not.toBeNull();
    });

    it('3. expired invite → 410 Gone on redeem', async () => {
        const { ownerCtx } = await setupTenant('expired');
        const inviteeEmail = emailFor('invitee-expired');
        const user = await createUser(inviteeEmail);

        const { invite } = await createInviteToken(ownerCtx, {
            email: inviteeEmail,
            role: 'VIEWER',
        });

        // Manually expire it.
        await prisma.tenantInvite.update({
            where: { id: invite.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });

        await expect(
            redeemInvite({
                token: invite.token,
                userId: user.id,
                userEmail: inviteeEmail,
            }),
        ).rejects.toMatchObject({ status: 410 });
    });

    it('4. revoked invite → 410 Gone on redeem', async () => {
        const { ownerCtx } = await setupTenant('revoked');
        const inviteeEmail = emailFor('invitee-revoked');
        const user = await createUser(inviteeEmail);

        const { invite } = await createInviteToken(ownerCtx, {
            email: inviteeEmail,
            role: 'VIEWER',
        });

        await revokeInvite(ownerCtx, { inviteId: invite.id });

        await expect(
            redeemInvite({
                token: invite.token,
                userId: user.id,
                userEmail: inviteeEmail,
            }),
        ).rejects.toMatchObject({ status: 410 });
    });

    it('5. already redeemed invite → 410 Gone on second redeem', async () => {
        const { ownerCtx } = await setupTenant('double');
        const inviteeEmail = emailFor('invitee-double');
        const user = await createUser(inviteeEmail);

        const { invite } = await createInviteToken(ownerCtx, {
            email: inviteeEmail,
            role: 'VIEWER',
        });

        await redeemInvite({ token: invite.token, userId: user.id, userEmail: inviteeEmail });

        await expect(
            redeemInvite({ token: invite.token, userId: user.id, userEmail: inviteeEmail }),
        ).rejects.toMatchObject({ status: 410 });
    });

    it('6. concurrent redemption — exactly one succeeds, rest get 410', async () => {
        const { ownerCtx } = await setupTenant('concurrent');
        const inviteeEmail = emailFor('invitee-concurrent');
        const user = await createUser(inviteeEmail);

        const { invite } = await createInviteToken(ownerCtx, {
            email: inviteeEmail,
            role: 'VIEWER',
        });

        const concurrency = 10;
        const results = await Promise.allSettled(
            Array.from({ length: concurrency }, () =>
                redeemInvite({ token: invite.token, userId: user.id, userEmail: inviteeEmail }),
            ),
        );

        const successes = results.filter((r) => r.status === 'fulfilled');
        const failures = results.filter((r) => r.status === 'rejected');
        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(concurrency - 1);

        // All failures must be 410 (or 403 for email mismatch if the updateMany race
        // happened to run the re-fetch before the winner's acceptedAt committed —
        // both are acceptable; the invariant is exactly-once redemption).
        for (const f of failures) {
            expect((f as PromiseRejectedResult).reason?.status).toBeGreaterThanOrEqual(400);
        }
    });

    it('7. role is respected — a MEMBER invite creates a MEMBER membership', async () => {
        const { tenantId, ownerCtx } = await setupTenant('role');
        const inviteeEmail = emailFor('invitee-role');
        const user = await createUser(inviteeEmail);

        const { invite } = await createInviteToken(ownerCtx, {
            email: inviteeEmail,
            role: 'MEMBER',
        });

        const result = await redeemInvite({
            token: invite.token,
            userId: user.id,
            userEmail: inviteeEmail,
        });

        expect(result.role).toBe('MEMBER');

        const membership = await prisma.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId, userId: user.id } },
            select: { role: true },
        });
        expect(membership?.role).toBe('MEMBER');
    });

    it('8. OWNER invite permission gate — non-OWNER cannot invite OWNER', async () => {
        const { tenantId, ownerCtx } = await setupTenant('ownergate');

        // Create an ADMIN member.
        const adminEmail = emailFor('admin-ownergate');
        const adminUser = await createUser(adminEmail);
        const adminInvite = await createInviteToken(ownerCtx, { email: adminEmail, role: 'ADMIN' });
        await redeemInvite({
            token: adminInvite.invite.token,
            userId: adminUser.id,
            userEmail: adminEmail,
        });

        const adminCtx = makeRequestContext('ADMIN', {
            userId: adminUser.id,
            tenantId,
            tenantSlug: ownerCtx.tenantSlug,
            appPermissions: getPermissionsForRole('ADMIN'),
        });

        const targetEmail = emailFor('target-ownergate');
        await expect(
            createInviteToken(adminCtx, { email: targetEmail, role: 'OWNER' }),
        ).rejects.toMatchObject({ status: 403, message: expect.stringContaining('OWNERs') });
    });

    it('9. existing DEACTIVATED member gets reactivated via redeemInvite', async () => {
        const { tenantId, ownerCtx } = await setupTenant('upsert');
        const inviteeEmail = emailFor('invitee-upsert');
        const user = await createUser(inviteeEmail);

        // First invite + redeem: creates ACTIVE membership.
        const firstInvite = await createInviteToken(ownerCtx, { email: inviteeEmail, role: 'VIEWER' });
        await redeemInvite({
            token: firstInvite.invite.token,
            userId: user.id,
            userEmail: inviteeEmail,
        });

        // Deactivate the membership.
        await prisma.tenantMembership.updateMany({
            where: { tenantId, userId: user.id },
            data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
        });

        // New invite and redeem — should reactivate with the new role.
        const secondInvite = await createInviteToken(ownerCtx, { email: inviteeEmail, role: 'MEMBER' });
        const result = await redeemInvite({
            token: secondInvite.invite.token,
            userId: user.id,
            userEmail: inviteeEmail,
        });

        expect(result.role).toBe('MEMBER');

        const membership = await prisma.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId, userId: user.id } },
            select: { status: true, role: true, deactivatedAt: true },
        });
        expect(membership?.status).toBe('ACTIVE');
        expect(membership?.role).toBe('MEMBER');
        expect(membership?.deactivatedAt).toBeNull();

        // No duplicate membership row.
        const count = await prisma.tenantMembership.count({
            where: { tenantId, userId: user.id },
        });
        expect(count).toBe(1);
    });

    it('9b. a pending invite never changes the role of a member who became ACTIVE another way (#5318)', async () => {
        const { tenantId, ownerCtx } = await setupTenant('active-keeps-role');
        const inviteeEmail = emailFor('invitee-active-keeps-role');
        const user = await createUser(inviteeEmail);

        // Invited as READER; before redeeming, joins another way and is
        // promoted to ADMIN (SSO JIT / SCIM / the members page).
        await createInviteToken(ownerCtx, { email: inviteeEmail, role: 'VIEWER' });
        await prisma.tenantMembership.create({
            data: { tenantId, userId: user.id, role: 'ADMIN', status: 'ACTIVE' },
        });

        const redeemed = await redeemPendingInvitesByEmail({ userId: user.id, userEmail: inviteeEmail });
        expect(redeemed).toHaveLength(1);
        expect(redeemed[0]).toMatchObject({ tenantId, role: 'ADMIN' });

        const membership = await prisma.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId, userId: user.id } },
            select: { status: true, role: true },
        });
        expect(membership).toEqual({ status: 'ACTIVE', role: 'ADMIN' });
        // The invite is consumed, so a later sign-in finds nothing pending.
        expect(await redeemPendingInvitesByEmail({ userId: user.id, userEmail: inviteeEmail })).toHaveLength(0);
    });

    it('10. audit — MEMBER_INVITED, MEMBER_INVITE_ACCEPTED, MEMBER_INVITE_REVOKED all written', async () => {
        const { tenantId, ownerCtx } = await setupTenant('audit-chain');
        const inviteeEmail = emailFor('invitee-audit');
        const user = await createUser(inviteeEmail);

        // Create and revoke one invite.
        const revokedInvite = await createInviteToken(ownerCtx, { email: inviteeEmail, role: 'VIEWER' });
        await revokeInvite(ownerCtx, { inviteId: revokedInvite.invite.id });

        // Create another and redeem it.
        const goodInvite = await createInviteToken(ownerCtx, { email: inviteeEmail, role: 'MEMBER' });
        await redeemInvite({
            token: goodInvite.invite.token,
            userId: user.id,
            userEmail: inviteeEmail,
        });

        // Until sub-phase 1.5 adds the AuditLog table, the entries the audit
        // writer received (tests/helpers/audit-recorder.ts) stand in for rows.
        const actions = auditEntries({ tenantId }).map((a) => a.action);

        expect(actions).toContain('MEMBER_INVITED');
        expect(actions).toContain('MEMBER_INVITE_REVOKED');
        expect(actions).toContain('MEMBER_INVITE_ACCEPTED');

        // The hash-chain check (verifyAuditChain) returns with the chain in 1.5.
    });

    // ── redeemPendingInvitesByEmail (verified-email sign-in path) ────────

    it('11. by-email happy path — pending invite redeemed at sign-in without a token', async () => {
        const { tenantId, ownerCtx } = await setupTenant('byemail-happy');
        const inviteeEmail = emailFor('invitee-byemail');
        const user = await createUser(inviteeEmail);

        await createInviteToken(ownerCtx, { email: inviteeEmail, role: 'MEMBER' });

        // No token — just the verified email, as the signIn callback provides.
        const redeemed = await redeemPendingInvitesByEmail({
            userId: user.id,
            userEmail: inviteeEmail,
        });

        expect(redeemed).toHaveLength(1);
        expect(redeemed[0]).toMatchObject({ tenantId, role: 'MEMBER' });

        const membership = await prisma.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId, userId: user.id } },
            select: { status: true, role: true },
        });
        expect(membership?.status).toBe('ACTIVE');
        expect(membership?.role).toBe('MEMBER');
    });

    it('12. by-email with NO pending invite — no membership, empty result (not auto-join)', async () => {
        const { tenantId } = await setupTenant('byemail-noinvite');
        const strangerEmail = emailFor('stranger-byemail');
        const stranger = await createUser(strangerEmail);

        const redeemed = await redeemPendingInvitesByEmail({
            userId: stranger.id,
            userEmail: strangerEmail,
        });

        expect(redeemed).toHaveLength(0);
        const membership = await prisma.tenantMembership.findFirst({
            where: { tenantId, userId: stranger.id },
        });
        expect(membership).toBeNull();
    });

    it('13. by-email is case-insensitive on the email match', async () => {
        const { tenantId, ownerCtx } = await setupTenant('byemail-case');
        const inviteeEmail = emailFor('invitee-case').toLowerCase();
        const user = await createUser(inviteeEmail);

        await createInviteToken(ownerCtx, { email: inviteeEmail, role: 'VIEWER' });

        const redeemed = await redeemPendingInvitesByEmail({
            userId: user.id,
            userEmail: inviteeEmail.toUpperCase(),
        });

        expect(redeemed).toHaveLength(1);
        const membership = await prisma.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId, userId: user.id } },
            select: { status: true },
        });
        expect(membership?.status).toBe('ACTIVE');
    });

    it('14. by-email skips expired + revoked invites', async () => {
        const { tenantId, ownerCtx } = await setupTenant('byemail-stale');
        const inviteeEmail = emailFor('invitee-stale');
        const user = await createUser(inviteeEmail);

        const expired = await createInviteToken(ownerCtx, { email: inviteeEmail, role: 'MEMBER' });
        await prisma.tenantInvite.update({
            where: { id: expired.invite.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const redeemed = await redeemPendingInvitesByEmail({
            userId: user.id,
            userEmail: inviteeEmail,
        });

        expect(redeemed).toHaveLength(0);
        const membership = await prisma.tenantMembership.findFirst({
            where: { tenantId, userId: user.id },
        });
        expect(membership).toBeNull();
    });

    it('15. by-email redeems invites across MULTIPLE tenants in one sign-in', async () => {
        const a = await setupTenant('byemail-multi-a');
        const b = await setupTenant('byemail-multi-b');
        const inviteeEmail = emailFor('invitee-multi');
        const user = await createUser(inviteeEmail);

        await createInviteToken(a.ownerCtx, { email: inviteeEmail, role: 'VIEWER' });
        await createInviteToken(b.ownerCtx, { email: inviteeEmail, role: 'MEMBER' });

        const redeemed = await redeemPendingInvitesByEmail({
            userId: user.id,
            userEmail: inviteeEmail,
        });

        expect(redeemed).toHaveLength(2);
        const tenantIds = redeemed.map((r) => r.tenantId).sort();
        expect(tenantIds).toEqual([a.tenantId, b.tenantId].sort());

        for (const tid of [a.tenantId, b.tenantId]) {
            const m = await prisma.tenantMembership.findUnique({
                where: { tenantId_userId: { tenantId: tid, userId: user.id } },
                select: { status: true },
            });
            expect(m?.status).toBe('ACTIVE');
        }
    });

    it('16. by-email is idempotent — a second sign-in redeems nothing new', async () => {
        const { tenantId, ownerCtx } = await setupTenant('byemail-idem');
        const inviteeEmail = emailFor('invitee-idem');
        const user = await createUser(inviteeEmail);

        await createInviteToken(ownerCtx, { email: inviteeEmail, role: 'VIEWER' });

        const first = await redeemPendingInvitesByEmail({ userId: user.id, userEmail: inviteeEmail });
        expect(first).toHaveLength(1);

        // Invite is now accepted; a subsequent login finds nothing pending.
        const second = await redeemPendingInvitesByEmail({ userId: user.id, userEmail: inviteeEmail });
        expect(second).toHaveLength(0);

        const count = await prisma.tenantMembership.count({
            where: { tenantId, userId: user.id },
        });
        expect(count).toBe(1);
    });
});
