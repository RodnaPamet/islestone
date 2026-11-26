/**
 * Calendar sync's three tables (roadmap 3.3b; ADR 0011): the workspace's
 * settings row, members' connections and the record of each pushed event.
 * Every query names the workspace (`tenantId`) on top of row-level security,
 * and every connection read a member makes names the member. The token column
 * is written and read through the encryption extension (decision 238); it is
 * selected only by `tokenOf`.
 *
 * Written fresh for Islestone, after inflect-compliance's
 * `user-calendar-connection.ts` and `tenant-calendar-consent.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (their writes: upsert per member
 * and provider, a rotation that never revives a revoked row, a revocation
 * that destroys the token and keeps the row).
 */
import type { CalendarConnectionState, CalendarProvider, CalendarSyncedEventKind, CalendarSyncedEventState, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';

import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The most rows one connection's run reads (1,000 items and 200 milestones, plus the ones on their way out). */
export const SYNCED_EVENTS_TAKE = 5_000;

export const connectionSelect = {
    id: true,
    tenantId: true,
    userId: true,
    provider: true,
    state: true,
    scopesGranted: true,
    externalCalendarId: true,
    revokedReason: true,
    lastSyncedAt: true,
    connectedAt: true,
} satisfies Prisma.CalendarConnectionSelect;
export type ConnectionRow = Prisma.CalendarConnectionGetPayload<{ select: typeof connectionSelect }>;

export const syncedEventSelect = {
    id: true,
    kind: true,
    workItemId: true,
    milestoneId: true,
    remoteEventId: true,
    clientEventId: true,
    pushedDueDate: true,
    contentHash: true,
    state: true,
} satisfies Prisma.CalendarSyncedEventSelect;
export type SyncedEventRow = Prisma.CalendarSyncedEventGetPayload<{ select: typeof syncedEventSelect }>;

export class CalendarSyncRepository {
    // ─── Settings ────────────────────────────────────────────────────

    static async settings(db: PrismaTx, ctx: Ctx) {
        return db.tenantCalendarSettings.findUnique({ where: { tenantId: ctx.tenantId } });
    }

    /** Read the row FOR UPDATE (creating it, off), so concurrent changes to the switch and the consent serialise. */
    static async lockSettings(db: PrismaTx, ctx: Ctx) {
        await db.tenantCalendarSettings.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId }, update: {} });
        await db.$queryRaw`SELECT 1 FROM "TenantCalendarSettings" WHERE "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        return db.tenantCalendarSettings.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } });
    }

    static async updateSettings(
        db: PrismaTx,
        ctx: Ctx,
        data: Partial<{
            syncEnabled: boolean;
            microsoftExternalTenantId: string | null;
            microsoftConsentGrantedAt: Date | null;
            microsoftConsentGrantedByUserId: string | null;
            microsoftConsentRevokedAt: Date | null;
        }>,
    ) {
        return db.tenantCalendarSettings.update({ where: { tenantId: ctx.tenantId }, data: { ...data, version: { increment: 1 } } });
    }

    // ─── Connections ─────────────────────────────────────────────────

    static async connectionsOfUser(db: PrismaTx, ctx: Ctx, userId: string): Promise<ConnectionRow[]> {
        return db.calendarConnection.findMany({ where: { tenantId: ctx.tenantId, userId }, orderBy: { provider: 'asc' }, take: 2, select: connectionSelect });
    }

    static async connectionOfUser(db: PrismaTx, ctx: Ctx, userId: string, provider: CalendarProvider): Promise<ConnectionRow | null> {
        return db.calendarConnection.findUnique({ where: { tenantId_userId_provider: { tenantId: ctx.tenantId, userId, provider } }, select: connectionSelect });
    }

    static async connection(db: PrismaTx, ctx: Ctx, id: string): Promise<ConnectionRow | null> {
        return db.calendarConnection.findFirst({ where: { id, tenantId: ctx.tenantId }, select: connectionSelect });
    }

    /** The decrypted token blob of one connection, or null. */
    static async tokenOf(db: PrismaTx, ctx: Ctx, id: string): Promise<string | null> {
        const row = await db.calendarConnection.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { tokenEncrypted: true } });
        return row?.tokenEncrypted ?? null;
    }

    /** How many connections the workspace has by provider and state (Settings shows counts, never who). */
    static async countsByProvider(db: PrismaTx, ctx: Ctx) {
        return db.calendarConnection.groupBy({ by: ['provider', 'state'], where: { tenantId: ctx.tenantId }, _count: { _all: true }, orderBy: [{ provider: 'asc' }, { state: 'asc' }] });
    }

    /** The CONNECTED connections of the named members (the push after a change, decision 233). */
    static async connectedOfUsers(db: PrismaTx, ctx: Ctx, userIds: readonly string[]) {
        if (userIds.length === 0) return [];
        return db.calendarConnection.findMany({
            where: { tenantId: ctx.tenantId, userId: { in: [...userIds] }, state: 'CONNECTED' },
            orderBy: { id: 'asc' },
            take: userIds.length * 2,
            select: { id: true },
        });
    }

    /**
     * The CONNECTED connections of the assignees of the named items, deleted
     * items included (a push after a change to those items, decision 233).
     * One statement: the items by primary key, joined to their assignee's
     * connections.
     */
    static async connectedOfAssignees(db: PrismaTx, ctx: Ctx, workItemIds: readonly string[]): Promise<Array<{ id: string }>> {
        if (workItemIds.length === 0) return [];
        return db.$queryRaw<Array<{ id: string }>>`
            SELECT DISTINCT c."id"
              FROM "WorkItem" w
              JOIN "CalendarConnection" c ON c."tenantId" = w."tenantId" AND c."userId" = w."assigneeId"
             WHERE w."tenantId" = ${ctx.tenantId}
               AND w."id" = ANY(${[...workItemIds]}::text[])
               AND c."state" = 'CONNECTED'
             LIMIT ${workItemIds.length * 2}`;
    }

    /** Every connection of the workspace in a state, bounded (a switch turned off, a change every member's calendar may show). */
    static async connectionIdsInState(db: PrismaTx, ctx: Ctx, states: readonly CalendarConnectionState[], take: number, provider?: CalendarProvider) {
        return db.calendarConnection.findMany({
            where: { tenantId: ctx.tenantId, state: { in: [...states] }, ...(provider ? { provider } : {}) },
            orderBy: { id: 'asc' },
            take,
            select: { id: true },
        });
    }

    /** Create or replace the member's connection: a reconnect replaces the token and clears a revocation. */
    static async upsertConnected(
        db: PrismaTx,
        ctx: Ctx,
        data: { userId: string; provider: CalendarProvider; tokenEncrypted: string; scopesGranted: string[]; externalCalendarId: string },
    ): Promise<ConnectionRow> {
        return db.calendarConnection.upsert({
            where: { tenantId_userId_provider: { tenantId: ctx.tenantId, userId: data.userId, provider: data.provider } },
            create: { tenantId: ctx.tenantId, ...data, state: 'CONNECTED' },
            update: {
                tokenEncrypted: data.tokenEncrypted,
                scopesGranted: data.scopesGranted,
                externalCalendarId: data.externalCalendarId,
                state: 'CONNECTED',
                revokedReason: null,
                syncCursor: null,
                connectedAt: new Date(),
            },
            select: connectionSelect,
        });
    }

    /** A rotated token: only on a CONNECTED row, so a refresh in flight never revives a revoked one. */
    static async setToken(db: PrismaTx, ctx: Ctx, id: string, tokenEncrypted: string, allowDisconnecting = false): Promise<number> {
        const states: CalendarConnectionState[] = allowDisconnecting ? ['CONNECTED', 'DISCONNECTING'] : ['CONNECTED'];
        const r = await db.calendarConnection.updateMany({ where: { id, tenantId: ctx.tenantId, state: { in: states } }, data: { tokenEncrypted } });
        return r.count;
    }

    /** Terminal: the provider refused the token. Destroys it; keeps the row and its synced events (PENDING_DELETE until a reconnect). */
    static async markRevoked(db: PrismaTx, ctx: Ctx, id: string, reason: 'ACCESS_WITHDRAWN' | 'GRANT_INVALID'): Promise<number> {
        const r = await db.calendarConnection.updateMany({
            where: { id, tenantId: ctx.tenantId, state: 'CONNECTED' },
            data: { state: 'REVOKED', revokedReason: reason, tokenEncrypted: null },
        });
        return r.count;
    }

    static async markDisconnecting(db: PrismaTx, ctx: Ctx, ids: readonly string[]): Promise<number> {
        if (ids.length === 0) return 0;
        const r = await db.calendarConnection.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, state: { not: 'DISCONNECTING' } },
            data: { state: 'DISCONNECTING', revokedReason: null },
        });
        return r.count;
    }

    static async setCalendarId(db: PrismaTx, ctx: Ctx, id: string, externalCalendarId: string | null): Promise<void> {
        await db.calendarConnection.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { externalCalendarId } });
    }

    static async touchSynced(db: PrismaTx, ctx: Ctx, id: string, at: Date): Promise<void> {
        await db.calendarConnection.updateMany({ where: { id, tenantId: ctx.tenantId, state: 'CONNECTED' }, data: { lastSyncedAt: at } });
    }

    /** The teardown's last step: the token destroyed with the row. Refused by the FK while a synced event remains. */
    static async deleteConnection(db: PrismaTx, ctx: Ctx, id: string): Promise<number> {
        const r = await db.calendarConnection.deleteMany({ where: { id, tenantId: ctx.tenantId, state: 'DISCONNECTING' } });
        return r.count;
    }

    // ─── Synced events ───────────────────────────────────────────────

    static async syncedEvents(db: PrismaTx, ctx: Ctx, connectionId: string): Promise<SyncedEventRow[]> {
        return db.calendarSyncedEvent.findMany({
            where: { tenantId: ctx.tenantId, connectionId },
            orderBy: { id: 'asc' },
            take: SYNCED_EVENTS_TAKE,
            select: syncedEventSelect,
        });
    }

    static async countSyncedEvents(db: PrismaTx, ctx: Ctx, connectionId: string): Promise<number> {
        return db.calendarSyncedEvent.count({ where: { tenantId: ctx.tenantId, connectionId } });
    }

    /**
     * Record an insert BEFORE it is sent (no remote id, `UNCONFIRMED`), so a
     * crash after the provider created the event leaves a row that the next
     * run looks up before it inserts again.
     */
    static async recordUnconfirmed(
        db: PrismaTx,
        ctx: Ctx,
        data: { connectionId: string; kind: CalendarSyncedEventKind; sourceId: string; clientEventId: string; pushedDueDate: Date; contentHash: string },
    ): Promise<void> {
        const source = data.kind === 'WORK_ITEM' ? { workItemId: data.sourceId } : { milestoneId: data.sourceId };
        const existing = await db.calendarSyncedEvent.findFirst({ where: { tenantId: ctx.tenantId, connectionId: data.connectionId, ...source }, select: { id: true } });
        if (existing) {
            await db.calendarSyncedEvent.update({
                where: { id: existing.id },
                data: { remoteEventId: '', pushedDueDate: data.pushedDueDate, contentHash: data.contentHash, state: 'FAILED', lastError: 'UNCONFIRMED' },
            });
            return;
        }
        await db.calendarSyncedEvent.create({
            data: {
                tenantId: ctx.tenantId,
                connectionId: data.connectionId,
                kind: data.kind,
                ...source,
                clientEventId: data.clientEventId,
                pushedDueDate: data.pushedDueDate,
                contentHash: data.contentHash,
                state: 'FAILED',
                lastError: 'UNCONFIRMED',
            },
        });
    }

    static async markPushed(
        db: PrismaTx,
        ctx: Ctx,
        where: { connectionId: string; kind: CalendarSyncedEventKind; sourceId: string },
        data: { remoteEventId: string; remoteVersion: string | null; pushedDueDate: Date; contentHash: string; at: Date },
    ): Promise<void> {
        await db.calendarSyncedEvent.updateMany({
            where: { tenantId: ctx.tenantId, connectionId: where.connectionId, ...sourceOf(where) },
            data: {
                remoteEventId: data.remoteEventId,
                remoteVersion: data.remoteVersion,
                pushedDueDate: data.pushedDueDate,
                contentHash: data.contentHash,
                state: 'PUSHED',
                lastError: null,
                lastPushedAt: data.at,
            },
        });
    }

    static async markState(
        db: PrismaTx,
        ctx: Ctx,
        where: { connectionId: string; kind: CalendarSyncedEventKind; sourceId: string },
        state: CalendarSyncedEventState,
        lastError: 'UNCONFIRMED' | 'PROVIDER_ERROR' | 'NOT_FOUND' | 'REFUSED' | null,
    ): Promise<void> {
        await db.calendarSyncedEvent.updateMany({ where: { tenantId: ctx.tenantId, connectionId: where.connectionId, ...sourceOf(where) }, data: { state, lastError } });
    }

    /** The row goes only after its remote event did. */
    static async drop(db: PrismaTx, ctx: Ctx, where: { connectionId: string; kind: CalendarSyncedEventKind; sourceId: string }): Promise<void> {
        await db.calendarSyncedEvent.deleteMany({ where: { tenantId: ctx.tenantId, connectionId: where.connectionId, ...sourceOf(where) } });
    }

    /** The teardown's last rows, once nothing can reach their events (a refused token or none). */
    static async dropAll(db: PrismaTx, ctx: Ctx, connectionId: string): Promise<number> {
        const r = await db.calendarSyncedEvent.deleteMany({ where: { tenantId: ctx.tenantId, connectionId } });
        return r.count;
    }

    /** Every remaining row of a revoked connection waits for a reconnect: nothing can be deleted remotely without a token. */
    static async markAllPendingDelete(db: PrismaTx, ctx: Ctx, connectionId: string): Promise<number> {
        const r = await db.calendarSyncedEvent.updateMany({ where: { tenantId: ctx.tenantId, connectionId, state: { not: 'PENDING_DELETE' } }, data: { state: 'PENDING_DELETE' } });
        return r.count;
    }

    // ─── What a member's calendar names ──────────────────────────────

    /** The key prefixes of the named projects (an event's link). */
    static async projectKeys(db: PrismaTx, ctx: Ctx, projectIds: readonly string[]): Promise<Map<string, string>> {
        if (projectIds.length === 0) return new Map();
        const rows = await db.project.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...projectIds] }, deletedAt: null, archivedAt: null },
            orderBy: { id: 'asc' },
            take: projectIds.length,
            select: { id: true, keyPrefix: true },
        });
        return new Map(rows.map((r) => [r.id, r.keyPrefix]));
    }
}

function sourceOf(where: { kind: CalendarSyncedEventKind; sourceId: string }) {
    return where.kind === 'WORK_ITEM' ? { workItemId: where.sourceId } : { milestoneId: where.sourceId };
}
