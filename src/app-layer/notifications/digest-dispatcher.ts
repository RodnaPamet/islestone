/**
 * Digest Dispatcher — Owner-Grouped Notification Dispatch
 *
 * Takes DueItem[] from monitoring jobs, groups items by owner/tenant,
 * resolves recipient emails, builds digest templates, and enqueues
 * through the existing NotificationOutbox with deduplication.
 *
 * Architecture:
 *   Monitor → DueItem[] → DigestDispatcher → NotificationOutbox → processOutbox → Email
 *
 * Grouping rules:
 *   1. Group by tenantId first (tenant isolation)
 *   2. Within tenant, group by ownerUserId
 *   3. Items without ownerUserId go to tenant admins
 *   4. One digest email per owner per category per day
 *
 * Deduplication:
 *   dedupeKey = {tenantId}:{category}:{hashForLookup(email)}:{scope}:{YYYY-MM-DD}
 *   Since the key includes the date, the same digest is sent at most once per day per recipient.
 *
 * Copied from inflect-compliance `src/app-layer/notifications/digest-dispatcher.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e. One category (`DUE_DIGEST`)
 * over work items; the template is react-email and async; the dedupe key
 * hashes the recipient as `enqueue.ts` does; the insert is
 * `createMany({ skipDuplicates: true })` (inflect #5061). Sub-phase 2.7's due
 * monitor is its first caller.
 *
 * @module app-layer/notifications/digest-dispatcher
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/observability/logger';
import { hashForLookup } from '@/lib/security/encryption';
import type { DueItem } from '../jobs/types';
import { isNotificationsEnabled } from './settings';
import { buildDueDigestEmail, type DigestAudience, type EmailTemplateResult } from './templates';

// ─── Types ──────────────────────────────────────────────────────────

/** The digest categories, each an `EmailNotificationType`. */
export type DigestCategory = 'DUE_DIGEST';

export interface DispatchDigestOptions {
    /** The category of digest to send */
    category: DigestCategory;
    /** DueItems from the monitoring job */
    items: DueItem[];
    /** Override current time (for testing) */
    now?: Date;
}

export interface DispatchDigestResult {
    /** Number of digest emails enqueued */
    enqueued: number;
    /** Number of digests skipped (duplicate / disabled) */
    skipped: number;
    /** Number of items that had no resolvable recipient */
    unroutable: number;
    /** Total items processed */
    totalItems: number;
    /** Number of items suppressed due to tenant notifications disabled */
    suppressed: number;
    /**
     * Items belonging to a soft-deleted tenant. Deliberately NOT folded into
     * `suppressed`: one means an admin turned notifications off, the other means
     * the workspace is gone, and an operator reading one number could not tell
     * which had happened.
     */
    removedTenantItems: number;
    /** Per-tenant breakdown */
    tenants: Record<string, { enqueued: number; skipped: number; suppressed?: boolean; removed?: boolean }>;
}

export interface RecipientInfo {
    userId: string;
    email: string;
    name: string;
}

// ─── Recipient Resolution ───────────────────────────────────────────

/** Map key for a resolved recipient — a user is only ever a recipient OF a tenant. */
const recipientKey = (tenantId: string, userId: string) => `${tenantId}:${userId}`;

/**
 * Resolve (tenant, user) pairs to email addresses, for users who are STILL
 * MEMBERS of that tenant.
 *
 * The membership join is the whole point. Owner ids reach this function from
 * entity columns — a work item's assignee — and they are not cleared when a
 * membership is deactivated (`deactivateTenantMember` writes only `status` +
 * `deactivatedAt`). In inflect-compliance this was once a bare
 * `prisma.user.findMany({ where: { id: { in: userIds } } })`, so a departed
 * employee kept receiving that tenant's deadlines — item names, due dates and
 * links — nightly, forever.
 *
 * RLS is not a backstop here and cannot be one: `User` is a global model with
 * no `tenantId` and no row-level policies, and this runs on the unscoped
 * client outside `runInTenantContext`. The predicate below IS the control —
 * the same one `resolveTenantAdmins` has always had.
 *
 * Keyed per (tenant, user), not per user: the same person can be ACTIVE in one
 * tenant and DEACTIVATED in another, and a userId-only key would collapse those
 * into one entry and leak the second tenant's deadlines to them.
 *
 * Still ONE query, not one per tenant — a read inside the caller's loop would
 * trip the N+1 guardrail.
 */
async function resolveRecipients(
    pairs: Array<{ tenantId: string; userId: string }>,
): Promise<Map<string, RecipientInfo>> {
    if (pairs.length === 0) return new Map();

    const memberships = await prisma.tenantMembership.findMany({
        where: {
            status: 'ACTIVE',
            OR: pairs.map(({ tenantId, userId }) => ({ tenantId, userId })),
        },
        select: {
            tenantId: true,
            user: { select: { id: true, email: true, name: true } },
        },
    });

    const result = new Map<string, RecipientInfo>();
    for (const m of memberships) {
        if (m.user.email) {
            result.set(recipientKey(m.tenantId, m.user.id), {
                userId: m.user.id,
                email: m.user.email,
                name: m.user.name ?? m.user.email.split('@')[0] ?? m.user.email,
            });
        }
    }

    // Recipient shrinkage is otherwise silent: the caller counts a dropped
    // owner as `unroutable`, which is indistinguishable from "this user was
    // deleted". Log the count so an operator can tell a healthy offboarding
    // from a broken lookup.
    const dropped = pairs.length - result.size;
    if (dropped > 0) {
        logger.info('digest recipients dropped — no active membership', {
            component: 'digest-dispatcher',
            requested: pairs.length,
            resolved: result.size,
            dropped,
        });
    }

    return result;
}

/**
 * Resolve tenant admins as fallback recipients for unowned items.
 *
 * OWNER is included, not just ADMIN. Epic 1 made OWNER strictly superior to
 * ADMIN — it holds every admin flag plus `tenant_lifecycle` and
 * `owner_management` — so a role filter of `'ADMIN'` alone excluded the most
 * privileged member of the tenant. A tenant whose only privileged member is an
 * OWNER (the shape every tenant starts in: `createTenantWithOwner` mints an
 * OWNER and nothing else) resolved ZERO fallback recipients, and every unowned
 * item was counted `unroutable` and silently dropped. No digest at all.
 */
async function resolveTenantAdmins(
    tenantId: string,
): Promise<RecipientInfo[]> {
    const memberships = await prisma.tenantMembership.findMany({
        where: {
            tenantId,
            role: { in: ['OWNER', 'ADMIN'] },
            status: 'ACTIVE',
        },
        select: {
            user: {
                select: { id: true, email: true, name: true },
            },
        },
        take: 10, // Cap to avoid spamming large admin teams
    });

    return memberships
        .filter(m => m.user.email)
        .map(m => ({
            userId: m.user.id,
            email: m.user.email,
            name: m.user.name ?? m.user.email.split('@')[0] ?? m.user.email,
        }));
}

/**
 * Resolve the LIVE tenants among a set of ids, with the slug each link needs.
 *
 * Two jobs in one query, because they answer the same question. This replaces a
 * per-tenant `findUnique` for the slug and adds the `deletedAt` predicate: a
 * monitor filters `deletedAt` on the ENTITIES it scans (work items), and a
 * workspace soft-delete does not cascade to them, so a removed workspace with
 * one overdue work item would mail its admins — and a workspace's memberships
 * survive its deletion. So the dispatcher checks workspace liveness itself
 * (`tests/guards/cross-tenant-recipient-liveness.test.ts`).
 */
async function resolveLiveTenants(tenantIds: Iterable<string>): Promise<Map<string, string>> {
    const ids = [...tenantIds];
    if (ids.length === 0) return new Map();
    const rows = await prisma.tenant.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, slug: true },
    });
    return new Map(rows.map(t => [t.id, t.slug]));
}

// ─── Dedupe Key Builder ─────────────────────────────────────────────

/**
 * The scope segment of a dedupe key — which of a recipient's two possible
 * digests this is.
 *
 * `'digest'` is the recipient's OWN items; `'unowned'` is the tenant-wide
 * fallback for items with no owner. They need separate keys because an admin
 * can legitimately receive both on the same day, and the key is unique.
 *
 * THIS SEPARATION WAS A BUG FIX in inflect-compliance: with one shared key,
 * an admin who also owned items had the second (unowned) digest dropped by the
 * unique index and counted as `skipped`, indistinguishable from "already sent
 * today", so the admins most engaged with the workspace never saw the unowned
 * items.
 */
export type DigestScope = 'digest' | 'unowned';

/**
 * Build a dedupe key for digest emails.
 * Format: {tenantId}:{category}:{hashForLookup(email)}:{scope}:{YYYY-MM-DD}
 *
 * The key is scoped to the date, so the same digest is sent at most
 * once per day per recipient per category per scope.
 *
 * The recipient is HASHED, as in `enqueue.ts` `buildDedupeKey` (inflect
 * #3577): a raw address in a uniquely-indexed column is the same personal
 * data in a second place, which an erasure or a DSAR would miss, and the
 * outbox encrypts `toEmail` itself.
 */
export function buildDigestDedupeKey(
    tenantId: string,
    category: DigestCategory,
    email: string,
    date: Date = new Date(),
    scope: DigestScope = 'digest',
): string {
    const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
    return `${tenantId}:${category}:${hashForLookup(email)}:${scope}:${day}`;
}

// ─── Template Selector ──────────────────────────────────────────────

async function buildDigestEmail(
    category: DigestCategory,
    recipientName: string,
    tenantSlug: string,
    items: DueItem[],
    audience: DigestAudience,
): Promise<EmailTemplateResult> {
    switch (category) {
        case 'DUE_DIGEST':
            return buildDueDigestEmail({ recipientName, tenantSlug, items, audience });
        default: {
            const _exhaustive: never = category;
            throw new Error(`Unknown digest category: ${String(_exhaustive)}`);
        }
    }
}

// ─── Grouping ───────────────────────────────────────────────────────

interface GroupedItems {
    /** Items grouped by tenantId → ownerUserId → DueItem[] */
    byOwner: Map<string, Map<string, DueItem[]>>;
    /** Items without ownerUserId, grouped by tenantId */
    unowned: Map<string, DueItem[]>;
}

function groupItems(items: DueItem[]): GroupedItems {
    const byOwner = new Map<string, Map<string, DueItem[]>>();
    const unowned = new Map<string, DueItem[]>();

    for (const item of items) {
        if (item.ownerUserId) {
            if (!byOwner.has(item.tenantId)) {
                byOwner.set(item.tenantId, new Map());
            }
            const tenantMap = byOwner.get(item.tenantId)!;
            if (!tenantMap.has(item.ownerUserId)) {
                tenantMap.set(item.ownerUserId, []);
            }
            tenantMap.get(item.ownerUserId)!.push(item);
        } else {
            if (!unowned.has(item.tenantId)) {
                unowned.set(item.tenantId, []);
            }
            unowned.get(item.tenantId)!.push(item);
        }
    }

    return { byOwner, unowned };
}

// ─── Main Dispatch Function ─────────────────────────────────────────

/**
 * Dispatch grouped digest notifications for DueItems.
 *
 * 1. Groups items by tenant → owner
 * 2. Resolves recipient emails
 * 3. Builds digest template per recipient
 * 4. Enqueues through NotificationOutbox with deduplication
 *
 * Idempotent: safe to call multiple times per day — duplicates
 * are silently skipped via the outbox dedupeKey unique constraint.
 */
export async function dispatchDigest(
    options: DispatchDigestOptions,
): Promise<DispatchDigestResult> {
    const { category, items, now = new Date() } = options;

    if (items.length === 0) {
        return {
            enqueued: 0,
            skipped: 0,
            unroutable: 0,
            suppressed: 0,
            removedTenantItems: 0,
            totalItems: 0,
            tenants: {},
        };
    }

    const { byOwner, unowned } = groupItems(items);
    let enqueued = 0;
    let skipped = 0;
    let unroutable = 0;
    let suppressed = 0;
    const tenants: DispatchDigestResult['tenants'] = {};

    // Collect all unique tenant IDs
    const allTenantIds = new Set<string>();
    for (const item of items) allTenantIds.add(item.tenantId);

    // ── Removed tenants ─────────────────────────────────────────────
    // FIRST, before any other read, because every later question is only worth
    // asking about a workspace that still exists. A removed tenant's items are
    // not "suppressed" in the notifications-disabled sense either — that is an
    // admin's setting, this is a gone workspace — so they are counted apart.
    const slugs = await resolveLiveTenants(allTenantIds);
    let removedTenantItems = 0;
    for (const tenantId of allTenantIds) {
        if (slugs.has(tenantId)) continue;
        const tenantItemCount = items.filter(i => i.tenantId === tenantId).length;
        removedTenantItems += tenantItemCount;
        tenants[tenantId] = { enqueued: 0, skipped: 0, removed: true };
        logger.warn('digest skipped — tenant is removed', {
            component: 'digest-dispatcher',
            category,
            tenantId,
            itemCount: tenantItemCount,
        });
    }

    // ── Tenant notification eligibility check ───────────────────────
    // Enforce the same isNotificationsEnabled rule used by enqueue.ts.
    // Disabled tenants are skipped entirely — no digest email is sent.
    const eligibleTenants = new Set<string>();
    for (const tenantId of allTenantIds) {
        if (!slugs.has(tenantId)) continue; // removed above
        const enabled = await isNotificationsEnabled(prisma, tenantId);
        if (enabled) {
            eligibleTenants.add(tenantId);
        } else {
            // Count suppressed items for this tenant
            const tenantItemCount = items.filter(i => i.tenantId === tenantId).length;
            suppressed += tenantItemCount;
            tenants[tenantId] = { enqueued: 0, skipped: 0, suppressed: true };
            logger.info('digest suppressed — notifications disabled for tenant', {
                component: 'digest-dispatcher',
                category,
                tenantId,
                itemCount: tenantItemCount,
            });
        }
    }

    // Collect (tenant, user) pairs for batch resolution. Iterating `entries`
    // rather than `values` keeps the tenant, which is what lets the lookup
    // require an ACTIVE membership IN THAT TENANT.
    //
    // AFTER the two filters above, not before: resolving the owners of a removed
    // or muted tenant is a read whose answer can only be thrown away, and it
    // made `resolveRecipients` log a "recipients dropped" warning about users
    // nobody was going to mail.
    const ownerPairs: Array<{ tenantId: string; userId: string }> = [];
    for (const [tenantId, tenantMap] of byOwner) {
        if (!eligibleTenants.has(tenantId)) continue;
        for (const userId of tenantMap.keys()) {
            ownerPairs.push({ tenantId, userId });
        }
    }
    const recipients = await resolveRecipients(ownerPairs);

    // Process owned items (grouped by user)
    for (const [tenantId, tenantMap] of byOwner) {
        if (!eligibleTenants.has(tenantId)) continue; // Notifications disabled
        if (!tenants[tenantId]) tenants[tenantId] = { enqueued: 0, skipped: 0 };
        const tenantSlug = slugs.get(tenantId) ?? tenantId;

        for (const [userId, userItems] of tenantMap) {
            const recipient = recipients.get(recipientKey(tenantId, userId));
            if (!recipient) {
                // Either the user is gone, or — the common case — they are no
                // longer an active member of THIS tenant. Their items are not
                // re-routed to admins: `groupItems` already classified them as
                // owned, and an offboarded owner's deadlines becoming admin
                // mail on the night of deactivation would be its own surprise.
                unroutable += userItems.length;
                logger.warn('digest recipient not resolvable', {
                    component: 'digest-dispatcher',
                    category,
                    tenantId,
                    userId,
                    itemCount: userItems.length,
                });
                continue;
            }

            const result = await enqueueDigest(
                tenantId, category, recipient, tenantSlug, userItems, now, 'OWNER',
            );
            if (result) {
                enqueued++;
                tenants[tenantId].enqueued++;
            } else {
                skipped++;
                tenants[tenantId].skipped++;
            }
        }
    }

    // Process unowned items → send to tenant admins
    for (const [tenantId, unownedItems] of unowned) {
        if (!eligibleTenants.has(tenantId)) continue; // Notifications disabled
        if (!tenants[tenantId]) tenants[tenantId] = { enqueued: 0, skipped: 0 };
        const tenantSlug = slugs.get(tenantId) ?? tenantId;
        const admins = await resolveTenantAdmins(tenantId);

        if (admins.length === 0) {
            unroutable += unownedItems.length;
            logger.warn('no tenant admins for unowned items', {
                component: 'digest-dispatcher',
                category,
                tenantId,
                itemCount: unownedItems.length,
            });
            continue;
        }

        // One consolidated unowned digest per admin, addressed as what it is.
        // Not folded into the admin's personal digest: see `DigestScope`.
        for (const admin of admins) {
            const result = await enqueueDigest(
                tenantId, category, admin, tenantSlug, unownedItems, now, 'TENANT_ADMIN',
            );
            if (result) {
                enqueued++;
                tenants[tenantId].enqueued++;
            } else {
                skipped++;
                tenants[tenantId].skipped++;
            }
        }
    }

    logger.info('digest dispatch completed', {
        component: 'digest-dispatcher',
        category,
        totalItems: items.length,
        enqueued,
        skipped,
        suppressed,
        removedTenantItems,
        unroutable,
    });

    return {
        enqueued, skipped, unroutable, suppressed, removedTenantItems,
        totalItems: items.length, tenants,
    };
}

// ─── Outbox Enqueue ─────────────────────────────────────────────────

/**
 * Enqueue a single digest email into the outbox.
 * Returns the record if created, null if deduplicated.
 */
async function enqueueDigest(
    tenantId: string,
    category: DigestCategory,
    recipient: RecipientInfo,
    tenantSlug: string,
    items: DueItem[],
    now: Date,
    audience: DigestAudience,
): Promise<{ id: string; dedupeKey: string } | null> {
    // The scope is DERIVED from the audience rather than passed separately, so
    // the copy and the key can never disagree — a TENANT_ADMIN mail that landed
    // on the `:digest:` key would still collide with the reader's own digest.
    const scope: DigestScope = audience === 'TENANT_ADMIN' ? 'unowned' : 'digest';
    const dedupeKey = buildDigestDedupeKey(tenantId, category, recipient.email, now, scope);
    const { subject, bodyText, bodyHtml }: EmailTemplateResult = await buildDigestEmail(
        category, recipient.name, tenantSlug, items, audience,
    );

    // ON CONFLICT DO NOTHING (inflect #5061), as `enqueueEmail` does: a
    // duplicate is a skip, not a caught P2002.
    const { count } = await prisma.notificationOutbox.createMany({
        data: [
            {
                tenantId,
                type: category,
                toEmail: recipient.email,
                subject,
                bodyText,
                bodyHtml,
                dedupeKey,
            },
        ],
        skipDuplicates: true,
    });
    if (count === 0) {
        logger.debug('digest skipped — duplicate', {
            component: 'digest-dispatcher',
            category,
            dedupeKey,
        });
        return null;
    }
    const record = await prisma.notificationOutbox.findUnique({
        where: { dedupeKey },
        select: { id: true },
    });
    return record ? { id: record.id, dedupeKey } : null;
}
