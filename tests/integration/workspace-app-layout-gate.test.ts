/**
 * The workspace app layout (`src/app/t/[tenantSlug]/(app)/layout.tsx`) is the
 * security boundary of every shell page (sub-phase 1.7). Against a real
 * database, with two workspaces:
 *
 *   - a member of workspace A gets A's shell, with A's context in the
 *     provider and nothing of B's;
 *   - the same member asking for workspace B, which they are not in, gets a
 *     404 — never B's shell — and so does a slug that names no workspace;
 *   - a session that still owes workspace A its MFA code is sent to A's
 *     challenge, outside the layout;
 *   - no session is sent to sign in.
 *
 * The session (`auth()`) is the one thing stubbed: it is NextAuth's cookie
 * decode, and the facts it carries are what the test is about. The shell's
 * client components are stubbed too; their rendering is the rendered suite's
 * job, and the layout hands them only what it resolved.
 */
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import type { ReactElement, ReactNode } from 'react';

import { createTenantWithOwner } from '../helpers/tenant-fixture';
import { prismaTestClient, resetDatabase } from '../helpers/db';

import { DB_AVAILABLE } from './db-helper';

const mockAuth = jest.fn();
jest.mock('@/auth', () => ({ auth: () => mockAuth() }));
jest.mock('next/navigation', () => ({
    notFound: () => {
        throw new Error('NEXT_NOT_FOUND');
    },
    redirect: (url: string) => {
        throw new Error(`NEXT_REDIRECT ${url}`);
    },
}));
jest.mock('next/cache', () => ({ unstable_noStore: () => {} }));
jest.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
jest.mock('@/components/layout/AppShell', () => ({ AppShell: () => null }));
jest.mock('@/components/layout/ClientProviders', () => ({ ClientProviders: () => null }));
jest.mock('@/components/nav/NavigationTracker', () => ({ NavigationTracker: () => null }));

import WorkspaceAppLayout from '@/app/t/[tenantSlug]/(app)/layout';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `shell-${randomUUID().slice(0, 8)}`;

describeFn('workspace app layout — the workspace gate (integration)', () => {
    let prisma: PrismaClient;
    let a: { id: string; slug: string };
    let b: { id: string; slug: string };
    let ownerA: string;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const ta = await createTenantWithOwner({ name: 'Acme', slug: `${TAG}-a`, ownerEmail: `${TAG}-a@example.test`, requestId: 'r' });
        const tb = await createTenantWithOwner({ name: 'Globex', slug: `${TAG}-b`, ownerEmail: `${TAG}-b@example.test`, requestId: 'r' });
        a = ta.tenant;
        b = tb.tenant;
        ownerA = ta.ownerUserId;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    function sessionFor(userId: string, opts: { mfaPendingTenantIds?: string[] } = {}) {
        return {
            user: {
                id: userId,
                email: `${TAG}-a@example.test`,
                name: 'Ada',
                image: null,
                role: 'OWNER',
                memberships: [{ slug: a.slug, role: 'OWNER', tenantId: a.id }],
                orgMemberships: [],
                mfaPendingTenantIds: opts.mfaPendingTenantIds ?? [],
            },
        };
    }

    function layout(slug: string) {
        return WorkspaceAppLayout({ children: null as ReactNode, params: Promise.resolve({ tenantSlug: slug }) });
    }

    it("renders a member's own workspace with that workspace's context", async () => {
        mockAuth.mockResolvedValue(sessionFor(ownerA));
        const element = (await layout(a.slug)) as ReactElement<{ value: Record<string, unknown> }>;
        expect(element.props.value).toEqual(
            expect.objectContaining({
                userId: ownerA,
                tenantId: a.id,
                tenantSlug: a.slug,
                tenantName: 'Acme',
                role: 'OWNER',
                membershipRole: 'OWNER',
            }),
        );
        expect(JSON.stringify(element.props.value)).not.toContain(b.id);
    });

    it("is a 404 for another workspace's slug, not that workspace's shell", async () => {
        mockAuth.mockResolvedValue(sessionFor(ownerA));
        await expect(layout(b.slug)).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('is a 404 for a slug that names no workspace', async () => {
        mockAuth.mockResolvedValue(sessionFor(ownerA));
        await expect(layout(`${TAG}-nowhere`)).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it("sends a session that owes the workspace its MFA code to that workspace's challenge", async () => {
        mockAuth.mockResolvedValue(sessionFor(ownerA, { mfaPendingTenantIds: [a.id] }));
        await expect(layout(a.slug)).rejects.toThrow(`NEXT_REDIRECT /t/${a.slug}/auth/mfa`);
    });

    it('sends no session to sign in', async () => {
        mockAuth.mockResolvedValue(null);
        await expect(layout(a.slug)).rejects.toThrow(`NEXT_REDIRECT /login?next=${encodeURIComponent(`/t/${a.slug}`)}`);
    });
});
