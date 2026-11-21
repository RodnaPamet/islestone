/**
 * Context builders for work with NO signed-in user — jobs, sweeps, webhooks.
 *
 * Split out of `context.ts` for a load-bearing reason, not tidiness.
 * `context.ts` reads the session (`@/lib/auth/session`), which reaches
 * `@/auth`, which builds the NextAuth provider array at module scope. That
 * chain is fine in a Next request but fatal in the BullMQ worker, a plain Node
 * process where `next/headers` does not resolve and
 * `next-auth/providers/google` interops to a namespace rather than a callable.
 * inflect-compliance measured both at once:
 *
 *     ERR_MODULE_NOT_FOUND  file:///app/node_modules/next/headers   (at boot)
 *     TypeError: Google is not a function                    (at job execution)
 *
 * So the rule this module exists to hold: **nothing here may import
 * `@/lib/auth`, `@/auth`, or anything else that reaches them.** The
 * request-facing builders (`getTenantCtx`, `getOrgCtx`) stay in `context.ts`
 * where the session import belongs. `tests/guards/worker-import-graph.test.ts`
 * holds it for everything the worker reaches.
 *
 * The builders are NOT interchangeable and must not be collapsed:
 *
 *   buildSystemContext          the actor IS the machine. No real User row.
 *   buildTenantSystemJobContext the machine, but a row it writes needs a NOT
 *                               NULL `User` foreign key: the workspace's
 *                               SYSTEM user (`ensureTenantSystemUser`), never
 *                               a borrowed member.
 *   resolveMemberContext        act WITH a named user's real authority —
 *                               resolves their membership so a demoted or
 *                               removed principal loses it. Returns null as a
 *                               REFUSAL; falling back to a system context
 *                               there re-opens the escalation it exists to
 *                               close. (`resolveMemberContextWithReason` is
 *                               the same resolution with the refusal named.)
 *   resolveInitiatorContext     the same, for a job that does what one member
 *                               ASKED for (a manual job run). Keeps the
 *                               caller's request id and sets no `tenantSlug`.
 *
 * Copied from inflect-compliance `src/app-layer/context-system.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. Not ported: `buildDelegatedJobContext`
 * and the borrowed-actor picker (the system user replaced borrowing a member,
 * inflect #4400), and `resolveKeyInitiatorContext` (API keys, sub-phase 5.2).
 * `canAudit` is gone from the coarse flags, a custom role's grants are
 * `grantsJson`, and the system user's raw INSERT names Islestone's `User`
 * columns.
 */
import type { MembershipStatus, Role } from '@prisma/client';
import { computePermissions } from '@/lib/tenant-context';
import type { Permissions } from '@/lib/tenant-context';
import {
    effectiveRoleOfMembership,
    getPermissionsForRole,
    permissionsForMembership,
} from '@/lib/permissions';
import type { PermissionSet } from '@/lib/permissions';
import prisma from '@/lib/prisma';
import { AUDIT_APPEND_TX_OPTIONS } from '@/lib/db/concurrency-limits';
import {
    TENANT_SYSTEM_USER_NAME,
    tenantSystemUserEmail,
    tenantSystemUserEmailHash,
    tenantSystemUserId,
} from '@/lib/tenant-system-user';
import { logEvent } from './events/audit';
import type { RequestContext } from './types';


/**
 * The `userId` written on rows a background job creates.
 *
 * Every job previously spelled this inline as the literal `'system'`,
 * which is not a real `User.id` — so an audit row naming it resolves to
 * nobody, and a reviewer reading the trail cannot tell a platform sweep
 * from a person. It now travels with `actorType: 'JOB'`, which is what
 * makes the row self-describing.
 *
 * It is not a `User.id`, and `AuditLog.userId` is a foreign key to `User.id`:
 * in inflect-compliance every audit insert naming it was rejected until the
 * sentinel was mapped to NULL at the audit write seam (`auditUserIdOrNull` in
 * `lib/audit/audit-writer.ts`), which is where the column is.
 */
export const SYSTEM_PRINCIPAL = 'system';


/**
 * Build the RequestContext a background job runs under.
 *
 * One builder rather than a hand-rolled context per job (inflect-compliance
 * had thirteen identical copies): a future change to how machine activity is
 * represented — a narrower permission set, a real service principal, a
 * different actor type — happens once.
 *
 * **On the ADMIN role.** These are platform operations, not user
 * requests: a sweep must see every workspace row whoever owns it, and there
 * is no signed-in person whose authority could stand in. So the role stays ADMIN, exactly as before — this function changes
 * NO authority. What it changes is honesty: the audit row now says `JOB`,
 * so machine writes are filterable and a reviewer is not misled into
 * reading a sweep as a human decision.
 *
 * This is deliberately NOT the right tool when a real person is on the
 * hook for the work. If a job acts because a named user owns the policy,
 * the task, or the report, that user's OWN membership should be resolved
 * and their real role used — see `resolveMemberContext`. Reaching for a
 * system context there would launder a READER's request into an ADMIN
 * one, which is the escalation this pair of helpers exists to separate.
 */
export function buildSystemContext(input: {
    tenantId: string;
    /** Stable, greppable job identity — e.g. `notification-outbox-flush`. */
    job: string;
    /** Optional discriminator (a run id, a cloud name) appended to requestId. */
    discriminator?: string;
    tenantSlug?: string;
    /**
     * Override the whole request id. Only for a job that already has a
     * durable run identifier worth keeping in the trail — otherwise let it be
     * derived, so every job's id has the same greppable shape.
     */
    requestId?: string;
    /**
     * Override the principal: the workspace's system user
     * (`buildTenantSystemJobContext`).
     */
    principal?: string;
    /**
     * The COARSE permission flags. Defaults to full read/write/admin. Pass
     * explicitly for a job that needs less (a read-only snapshot):
     * defaulting it into the full set would silently WIDEN a job's
     * authority, which is the opposite of the point.
     */
    permissions?: RequestContext['permissions'];
}): RequestContext {
    const suffix = input.discriminator ? `-${input.discriminator}` : '';
    return {
        requestId: input.requestId ?? `${input.job}-${input.tenantId}${suffix}`,
        userId: input.principal ?? SYSTEM_PRINCIPAL,
        actorType: 'JOB',
        tenantId: input.tenantId,
        tenantSlug: input.tenantSlug,
        role: 'ADMIN',
        permissions: input.permissions ?? {
            canRead: true,
            canWrite: true,
            canAdmin: true,
            canExport: false,
        },
        appPermissions: getPermissionsForRole('ADMIN'),
    };
}

/**
 * Make sure the workspace's SYSTEM user exists, and return its id
 * (inflect-compliance #4400).
 *
 * Created lazily, the first time a job needs it, rather than at tenant
 * creation: that covers every tenant-creation path, including ones written
 * later, with no backfill. Idempotent and race-free, because `ON CONFLICT DO
 * NOTHING` covers both the id and the unique `emailHash`.
 *
 * Raw SQL on purpose. `prisma.user.create` goes through the PII extension,
 * which would derive `emailHash` from the email as an HMAC, the one value
 * this row's hash must never be. The email and name are stored as
 * plaintext in the columns that otherwise hold ciphertext: the PII read path
 * passes through a value with no `v1:`/`v2:` envelope, and neither is
 * personal data.
 *
 * No foreign key to `Tenant`. Production never hard-deletes a tenant; a test
 * that does leaves an inert row behind, rather than a cascade into the rows
 * this user authored. The row's shape, and its inability to sign in or hold
 * standing anywhere, are CHECK constraints (migration
 * `20261119150000_notifications_and_system_user`).
 *
 * THE CREATION IS AUDITED (owner decision, 2026-11-19). The call that inserts
 * the row writes one `SYSTEM_USER_CREATED` entry to the workspace's chain, as
 * the system user itself (`actorType: 'JOB'`), in the SAME transaction, so the
 * row and its record commit together or not at all. A call that finds the row
 * already there (`ON CONFLICT DO NOTHING` inserted nothing) writes nothing: a
 * concurrent first call waits on the unique index until the winner commits,
 * then sees the row, so there is exactly one entry per workspace. A workspace
 * that does not exist refuses at the entry's foreign key, and the insert rolls
 * back with it.
 */
export async function ensureTenantSystemUser(tenantId: string): Promise<string> {
    const id = tenantSystemUserId(tenantId);
    await prisma.$transaction(async (tx) => {
        const inserted = await tx.$executeRaw`
            INSERT INTO "User" ("id", "email", "emailHash", "name", "emailVerified", "updatedAt")
            VALUES (${id}, ${tenantSystemUserEmail(tenantId)}, ${tenantSystemUserEmailHash(tenantId)},
                    ${TENANT_SYSTEM_USER_NAME}, now(), now())
            ON CONFLICT DO NOTHING`;
        if (inserted === 0) return;
        const ctx = buildSystemContext({ tenantId, job: 'tenant-system-user', principal: id });
        await logEvent(
            tx,
            ctx,
            {
                action: 'SYSTEM_USER_CREATED',
                entityType: 'User',
                entityId: id,
                details: 'The workspace system user was created for background jobs that act for nobody',
                detailsJson: {
                    category: 'entity_lifecycle',
                    entityName: 'User',
                    operation: 'created',
                    summary: 'workspace system user created',
                },
            },
            { withinTransaction: true },
        );
    }, AUDIT_APPEND_TX_OPTIONS);
    return id;
}


/**
 * Context for a job that writes as the workspace's SYSTEM user (#4400).
 *
 * For a job whose row needs a NOT NULL `User` foreign key (a work item's
 * creator, sub-phase 2.1, is the first caller): it names no person. The row now
 * names no person, the audit trail reads `actorType: 'JOB'` with the system
 * user's id, and the authority is the job's own, exactly what
 * `buildSystemContext` grants.
 *
 * Not for work a named person is accountable for. That still resolves their
 * membership (`resolveMemberContext`).
 */
export async function buildTenantSystemJobContext(input: {
    tenantId: string;
    job: string;
    tenantSlug?: string;
    discriminator?: string;
    /** Keep the calling pass's request id, so its rows and the task's correlate. */
    requestId?: string;
}): Promise<RequestContext> {
    return buildSystemContext({ ...input, principal: await ensureTenantSystemUser(input.tenantId) });
}

/**
 * Resolve the RequestContext for a job acting ON BEHALF OF a named user.
 *
 * Some background work has a real accountable person: the assignee a
 * reminder is raised for, the requester of a scheduled report. In
 * inflect-compliance such jobs kept that user's `userId` — good, the audit row
 * names the right person — while pinning `role: 'ADMIN'`, which is not: a
 * READER had an ADMIN-authority write committed under their name.
 *
 * This resolves the membership instead, so:
 *   • a demoted or removed principal loses the authority they had;
 *   • a custom role that withholds a flag keeps withholding it here;
 *   • an INVITED / DEACTIVATED / REMOVED membership resolves to `null`.
 *
 * Returning `null` is a REFUSAL, and the caller must treat it as one.
 * Falling back to a system context on `null` would re-open the same door
 * from the other side — the write would still happen, just anonymously.
 * The right response is to skip that principal's item and say so.
 *
 * Reuses `computePermissions` and `parsePermissionsJson`, the same rule
 * `resolveTenantContext` applies to a request, so the two cannot drift.
 *
 * A caller that must SAY why it was refused reads the same resolution through
 * `resolveMemberContextWithReason`; this is that function with the reason
 * dropped, so the two cannot disagree about who is refused.
 */
export async function resolveMemberContext(input: {
    tenantId: string;
    userId: string;
    job: string;
    discriminator?: string;
}): Promise<RequestContext | null> {
    const resolved = await resolveMemberContextWithReason(input);
    return resolved.ok ? resolved.ctx : null;
}

/**
 * `resolveMemberContext`'s answer, with the refusal named.
 *
 * `NOT_A_MEMBER` is a membership row that does not exist, which is what
 * removing somebody from a tenant leaves (`removeTenantMember` deletes the
 * row). `NOT_ACTIVE` is a row whose status is anything but ACTIVE, carried so
 * the record can say which.
 */
export type MemberContextResolution =
    | { ok: true; ctx: RequestContext }
    | { ok: false; reason: 'NOT_A_MEMBER' }
    | { ok: false; reason: 'NOT_ACTIVE'; status: MembershipStatus };

/**
 * `resolveMemberContext` for a caller that records WHY a principal was
 * refused. One query, one resolution; a refusal is still a refusal, and this
 * function never falls back to anything.
 */
export async function resolveMemberContextWithReason(input: {
    tenantId: string;
    userId: string;
    job: string;
    discriminator?: string;
}): Promise<MemberContextResolution> {
    const membership = await prisma.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
        include: { customRole: true, tenant: { select: { slug: true } } },
    });
    if (!membership) return { ok: false, reason: 'NOT_A_MEMBER' };
    if (membership.status !== 'ACTIVE') {
        return { ok: false, reason: 'NOT_ACTIVE', status: membership.status };
    }

    const effectiveRole = effectiveRoleOfMembership(membership);
    const suffix = input.discriminator ? `-${input.discriminator}` : '';
    return {
        ok: true,
        ctx: {
            requestId: `${input.job}-${input.tenantId}${suffix}`,
            userId: input.userId,
            tenantId: input.tenantId,
            tenantSlug: membership.tenant?.slug,
            role: effectiveRole,
            permissions: computePermissions(effectiveRole),
            appPermissions: permissionsForMembership(membership),
        },
    };
}

/**
 * The authority a job carries for the member who STARTED it: exactly the
 * role, coarse flags and granular set a request from that member gets.
 *
 * A request's rule (`resolveTenantContext`): the role is the custom role's
 * base when the membership has one (a GUEST membership stays GUEST,
 * decision 204: `effectiveRoleOfMembership`), the coarse flags are `computePermissions`
 * of that role, and the granular set is `permissionsForMembership` — the custom
 * role's JSON parsed over its base. Only the link is read, never the custom
 * role's `isActive`: a request applies a soft-deleted role a membership is
 * still linked to, and so does this. (`deleteCustomRole` clears the links in
 * the same write, so such a link takes legacy data or a race.)
 * `initiator-context.test.ts` holds this equal to `resolveTenantContext`.
 *
 * So a custom role restricts the job exactly as it restricted the request that
 * queued it, and a role changed while the job sat in the queue applies when it
 * runs. (In inflect-compliance these jobs read `getPermissionsForRole` until
 * #4362, so a custom role that withheld a permission was ignored by the work
 * it had queued.)
 */
export function initiatorAuthority(membership: {
    role: Role;
    customRole: { baseRole: Role; grantsJson: unknown } | null;
}): { role: Role; permissions: Permissions; appPermissions: PermissionSet } {
    const role = effectiveRoleOfMembership(membership);
    return {
        role,
        permissions: computePermissions(role),
        appPermissions: permissionsForMembership(membership),
    };
}

/**
 * Resolve the context for a job that does what one named member asked for:
 * the initiator of a manual job run.
 *
 * Returns `null` when that member has no ACTIVE membership in the tenant, or the
 * tenant is soft-deleted. That is a REFUSAL, exactly as for
 * `resolveMemberContext`: the caller stops, and never falls back to a system
 * context.
 *
 * Differs from `resolveMemberContext` only in what these jobs always carried:
 * the caller's own `requestId`, and no `tenantSlug`.
 */
export async function resolveInitiatorContext(input: {
    tenantId: string;
    userId: string;
    requestId: string;
}): Promise<RequestContext | null> {
    const membership = await prisma.tenantMembership.findFirst({
        // A soft-deleted tenant refuses too (inflect #5305). Its memberships
        // are left in place by the delete, so without this a job a member
        // queued from a session before the delete would write into a tenant
        // that is meant to be inaccessible everywhere.
        where: {
            userId: input.userId,
            tenantId: input.tenantId,
            status: 'ACTIVE',
            tenant: { deletedAt: null },
        },
        select: {
            role: true,
            customRole: { select: { baseRole: true, grantsJson: true } },
        },
    });
    if (!membership) return null;
    return {
        requestId: input.requestId,
        userId: input.userId,
        tenantId: input.tenantId,
        ...initiatorAuthority(membership),
    };
}
