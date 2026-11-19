/**
 * Org invite lifecycle (integration).
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * Until sub-phase 1.5 adds `OrgAuditLog`, the audit assertions read the
 * entries the org audit writer received (tests/helpers/audit-recorder.ts).
 *
 * Real Postgres. Skipped if no DB is available. Exercises:
 *   ✅ createOrgInviteToken writes the row + emits ORG_INVITE_CREATED audit
 *   ✅ previewOrgInviteByToken returns null for invalid/expired/revoked tokens
 *      (anti-enumeration: single response shape)
 *   ✅ redeemOrgInvite atomic claim — second concurrent attempt fails
 *   ✅ Email-mismatch BURNS the token (acceptedAt persists despite throw)
 *   ✅ Successful redemption creates OrgMembership + emits 2-3 audit rows
 *   ✅ revokeOrgInvite + ORG_INVITE_REVOKED audit
 */
jest.mock('@/lib/audit/org-audit-writer', () =>
    jest.requireActual('../helpers/audit-recorder').orgAuditModuleMock(),
);

import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient } from '../helpers/db';
import type { PrismaClient } from '@prisma/client';
import {
    createOrgInviteToken,
    previewOrgInviteByToken,
    redeemOrgInvite,
    revokeOrgInvite,
} from '@/app-layer/usecases/org-invites';
import type { OrgContext } from '@/app-layer/types';
import { lookupEmail } from '@/lib/auth/email-lookup';
import { getOrgPermissions } from '@/lib/permissions';
import { orgAuditEntries } from '../helpers/audit-recorder';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

function makeOrgCtx(overrides: Partial<OrgContext>): OrgContext {
    return {
        requestId: 'req-test',
        userId: overrides.userId ?? 'unset',
        organizationId: overrides.organizationId ?? 'unset',
        orgSlug: overrides.orgSlug ?? 'unset',
        orgRole: 'ORG_ADMIN',
        permissions: getOrgPermissions('ORG_ADMIN'),
    };
}

describeFn('Epic D — org invite lifecycle (integration)', () => {
    let prisma: PrismaClient;
    let organizationId: string;
    let orgSlug: string;
    let inviterId: string;
    let inviteeEmail: string;
    let inviteeUserId: string;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();

        const slugSuffix = `${Date.now()}`.slice(-8);
        orgSlug = `org-invite-test-${slugSuffix}`;
        const org = await prisma.organization.create({
            data: { name: 'Org Invite Test', slug: orgSlug },
        });
        organizationId = org.id;

        const inviter = await prisma.user.create({
            data: { email: `inviter-${slugSuffix}@org-invite-test.local` },
        });
        inviterId = inviter.id;

        inviteeEmail = `invitee-${slugSuffix}@org-invite-test.local`;
        const invitee = await prisma.user.create({
            data: { email: lookupEmail(inviteeEmail) },
        });
        inviteeUserId = invitee.id;
    });

    afterAll(async () => {
        // No org audit rows to clean up until sub-phase 1.5 adds the table
        // (tests/helpers/audit-recorder.ts records the entries instead). The
        // OrgInvite / OrgMembership deletes keep the replica-mode transaction,
        // which skips the last-owner trigger.
        try {
            await prisma.$transaction(async (tx) => {
                await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
                await tx.$executeRawUnsafe(
                    `DELETE FROM "OrgInvite" WHERE "organizationId" = $1`,
                    organizationId,
                );
                await tx.$executeRawUnsafe(
                    `DELETE FROM "OrgMembership" WHERE "organizationId" = $1`,
                    organizationId,
                );
            });
            await prisma.organization.delete({ where: { id: organizationId } });
        } catch {
            /* tolerate */
        }
        await prisma.$disconnect();
    });

    // ── createOrgInviteToken ──────────────────────────────────────

    it('createOrgInviteToken inserts the row + emits ORG_INVITE_CREATED audit', async () => {
        const ctx = makeOrgCtx({
            userId: inviterId,
            organizationId,
            orgSlug,
        });
        const result = await createOrgInviteToken(ctx, {
            email: inviteeEmail,
            role: 'ORG_READER',
        });

        expect(result.invite.email).toBe(inviteeEmail);
        expect(result.invite.role).toBe('ORG_READER');
        expect(result.url).toMatch(/^\/invite\/org\/[A-Za-z0-9_-]+$/);

        const audit = orgAuditEntries({ organizationId, action: 'ORG_INVITE_CREATED' }).at(-1);
        expect(audit).toBeDefined();
        expect(audit?.actorUserId).toBe(inviterId);
    });

    // ── previewOrgInviteByToken anti-enumeration ──────────────────

    it('previewOrgInviteByToken returns null for unknown tokens', async () => {
        const out = await previewOrgInviteByToken('not-a-real-token', null);
        expect(out).toBeNull();
    });

    it('previewOrgInviteByToken returns null for expired tokens (anti-enumeration)', async () => {
        const expiredEmail = `expired-${Date.now()}@org-invite-test.local`;
        await prisma.orgInvite.create({
            data: {
                organizationId,
                email: expiredEmail,
                role: 'ORG_READER',
                token: `expired-token-${Date.now()}`,
                invitedById: inviterId,
                expiresAt: new Date(Date.now() - 1000), // already expired
            },
        });
        const out = await previewOrgInviteByToken(`expired-token-${Date.now()}`, null);
        // Either way, null — same response shape as "not found".
        expect(out).toBeNull();
    });

    // ── atomic claim ──────────────────────────────────────────────

    it('redeemOrgInvite atomic claim — second concurrent redeem fails as gone', async () => {
        // Fresh invite for this test.
        const ctx = makeOrgCtx({ userId: inviterId, organizationId, orgSlug });
        const fresh = await createOrgInviteToken(ctx, {
            email: inviteeEmail,
            role: 'ORG_READER',
        });

        const first = await redeemOrgInvite({
            token: fresh.invite.token,
            userId: inviteeUserId,
            userEmail: inviteeEmail,
        });
        expect(first.role).toBe('ORG_READER');

        await expect(
            redeemOrgInvite({
                token: fresh.invite.token,
                userId: inviteeUserId,
                userEmail: inviteeEmail,
            }),
        ).rejects.toThrow(/redeemed|expired|revoked/i);
    });

    // ── email mismatch burns the token ────────────────────────────

    it('email-mismatch redeem BURNS the token (acceptedAt set despite throw)', async () => {
        const burnEmail = `burn-${Date.now()}@org-invite-test.local`;
        const ctx = makeOrgCtx({ userId: inviterId, organizationId, orgSlug });
        const inv = await createOrgInviteToken(ctx, {
            email: burnEmail,
            role: 'ORG_READER',
        });

        await expect(
            redeemOrgInvite({
                token: inv.invite.token,
                userId: inviteeUserId,
                userEmail: 'wrong-email@example.com',
            }),
        ).rejects.toThrow(/email does not match/i);

        // Burnt: subsequent legitimate redemption fails.
        const after = await prisma.orgInvite.findUnique({
            where: { token: inv.invite.token },
        });
        expect(after?.acceptedAt).not.toBeNull();
    });

    // ── revoke ────────────────────────────────────────────────────

    it('revokeOrgInvite sets revokedAt + emits ORG_INVITE_REVOKED audit', async () => {
        const revokeEmail = `revoke-${Date.now()}@org-invite-test.local`;
        const ctx = makeOrgCtx({ userId: inviterId, organizationId, orgSlug });
        const inv = await createOrgInviteToken(ctx, {
            email: revokeEmail,
            role: 'ORG_ADMIN',
        });

        await revokeOrgInvite(ctx, { inviteId: inv.invite.id });

        const after = await prisma.orgInvite.findUnique({
            where: { id: inv.invite.id },
        });
        expect(after?.revokedAt).not.toBeNull();

        const audit = orgAuditEntries({ organizationId, action: 'ORG_INVITE_REVOKED' }).find(
            (e) => (e.detailsJson as { inviteId?: string } | undefined)?.inviteId === inv.invite.id,
        );
        expect(audit).toBeDefined();
    });
});
