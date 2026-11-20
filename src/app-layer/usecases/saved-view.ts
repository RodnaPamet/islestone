/**
 * Saved views (sub-phase 2.4; ADR 0006 "View"; docs/porting/maps/2.4.md):
 * a scope (the workspace's Work items page or one project), the filters, the
 * board's swimlanes, the sort, the layout and the visible columns, PERSONAL
 * (its creator's) or SHARED (every member who sees its scope).
 *
 * Who may do what is `saved-view.policies.ts` (existing `views.*` keys only).
 * A project-scoped view needs a visible, live project; reading never shows
 * another person's personal view (the repository's own `where`). The config
 * is validated by `SavedViewConfigSchema` on every write and its search text
 * sanitised. Every write is audited; an admin's delete of someone else's
 * shared view is `SAVED_VIEW_MODERATED` (owner decision 59). A refusal decided
 * here, past the route's key (a VIEWER saving or switching to a shared view,
 * decision 60; anyone changing a view not theirs), writes the same
 * `AUTHZ_DENIED` entry a `requirePermission` denial writes.
 *
 * Written fresh for Islestone.
 */
import type { Prisma, SavedViewVisibility, ViewLayout } from '@prisma/client';

import { logEvent } from '../events/audit';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { SAVED_VIEW_LIST_CAP, SavedViewRepository, type SavedViewRow, type SavedViewScopeFilter } from '../repositories/SavedViewRepository';
import {
    assertCanReadSavedViews,
    mayChangeSavedView,
    maySaveSavedView,
    savedViewDeleteBasis,
} from '../policies/saved-view.policies';
import { visibleProjects } from '../policies/project-visibility';
import type { RequestContext } from '../types';
import { appendAuditEntryOrQueue } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db-context';
import { badRequest, forbidden, notFound } from '@/lib/errors/types';
import { SavedViewConfigSchema, type SavedViewConfig } from '@/lib/schemas/saved-view';
import { sanitizePlainText } from '@/lib/security/sanitize';

export function toSavedViewDto(row: SavedViewRow, ctx: Pick<RequestContext, 'userId'>) {
    const config = SavedViewConfigSchema.safeParse(row.configJson);
    return {
        id: row.id,
        name: row.name,
        visibility: row.visibility,
        projectId: row.projectId,
        project: row.project ? { keyPrefix: row.project.keyPrefix, name: row.project.name } : null,
        layout: row.layout,
        // A stored config that no longer parses (a later schema) reads as the
        // defaults rather than failing the whole list.
        config: config.success ? config.data : SavedViewConfigSchema.parse({}),
        createdByUserId: row.createdByUserId,
        mine: row.createdByUserId === ctx.userId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export type SavedViewDto = ReturnType<typeof toSavedViewDto>;

function cleanName(raw: string): string {
    const name = sanitizePlainText(raw).replace(/[\r\n\t]+/g, ' ').trim();
    if (!name) throw badRequest('A view needs a name.');
    return name.slice(0, 64);
}

/** The config as stored: parsed, the search text sanitised. */
function cleanConfig(config: SavedViewConfig): Prisma.InputJsonValue {
    const parsed = SavedViewConfigSchema.parse(config);
    const out: SavedViewConfig = { ...parsed };
    const q = parsed.q ? sanitizePlainText(parsed.q).trim() : '';
    if (q) out.q = q;
    else delete out.q;
    if (out.direction === undefined) delete out.direction;
    if (out.columns === undefined) delete out.columns;
    return out as Prisma.InputJsonValue;
}

/**
 * The views the caller can see: `projectId` for one project's, `null` for
 * the workspace's, `undefined` for every scope (the Views page). Capped; one
 * past the cap marks truncation.
 */
export async function listSavedViews(ctx: RequestContext, scope: SavedViewScopeFilter) {
    assertCanReadSavedViews(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const rows = await SavedViewRepository.list(db, ctx, v, scope);
        return {
            views: rows.slice(0, SAVED_VIEW_LIST_CAP).map((r) => toSavedViewDto(r, ctx)),
            truncated: rows.length > SAVED_VIEW_LIST_CAP,
        };
    });
}

export async function getSavedView(ctx: RequestContext, id: string) {
    assertCanReadSavedViews(ctx);
    return runInTenantContext(ctx, async (db) => {
        const view = await SavedViewRepository.getReadable(db, ctx, await visibleProjects(ctx, db), id);
        if (!view) throw notFound('View not found');
        return toSavedViewDto(view, ctx);
    });
}

export interface CreateSavedViewInput {
    name: string;
    visibility: SavedViewVisibility;
    projectId?: string | null;
    layout: ViewLayout;
    config: SavedViewConfig;
}

type SavedViewRefusal =
    | 'SAVED_VIEW_SAVE_NOT_PERMITTED'
    | 'SAVED_VIEW_SHARE_NOT_PERMITTED'
    | 'SAVED_VIEW_CHANGE_NOT_PERMITTED'
    | 'SAVED_VIEW_CHANGE_CREATOR_ONLY'
    | 'SAVED_VIEW_DELETE_CREATOR_OR_ADMIN';

/**
 * A refusal decided here, after the route's key admitted the caller: the same
 * hash-chained `AUTHZ_DENIED` entry a `requirePermission` denial writes (in a
 * transaction of its own, so the request's rollback keeps it), then a 403.
 */
async function refuseSavedView(ctx: RequestContext, viewId: string, verb: 'save' | 'change' | 'delete', reason: SavedViewRefusal, message: string): Promise<never> {
    await appendAuditEntryOrQueue({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.apiKeyId ? 'API_KEY' : 'USER',
        entity: 'SavedView',
        entityId: viewId,
        action: 'AUTHZ_DENIED',
        details: `Saved view ${verb} refused`,
        detailsJson: { category: 'access', event: 'authz_denied', reason, role: ctx.role },
        requestId: ctx.requestId,
        metadataJson: { role: ctx.role, verb },
    });
    throw forbidden(message);
}

export async function createSavedView(ctx: RequestContext, input: CreateSavedViewInput): Promise<SavedViewDto> {
    if (!maySaveSavedView(ctx, input.visibility)) {
        const sharing = input.visibility === 'SHARED' && maySaveSavedView(ctx, 'PERSONAL');
        await refuseSavedView(
            ctx,
            'new',
            'save',
            sharing ? 'SAVED_VIEW_SHARE_NOT_PERMITTED' : 'SAVED_VIEW_SAVE_NOT_PERMITTED',
            sharing ? 'You do not have permission to share views.' : 'You do not have permission to save views.',
        );
    }
    const name = cleanName(input.name);
    const configJson = cleanConfig(input.config);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const projectId = input.projectId ?? null;
        if (projectId) {
            const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
            if (!project) throw notFound('Project not found');
        }
        const view = await SavedViewRepository.create(db, ctx, { name, visibility: input.visibility, projectId, layout: input.layout, configJson });
        await logEvent(db, ctx, {
            action: 'SAVED_VIEW_CREATED',
            entityType: 'SavedView',
            entityId: view.id,
            details: `Saved ${input.visibility === 'SHARED' ? 'shared' : 'personal'} view ${name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'SavedView', operation: 'created' },
            metadata: { visibility: input.visibility, projectId, layout: input.layout },
        });
        return toSavedViewDto(view, ctx);
    });
}

export interface UpdateSavedViewInput {
    name?: string;
    visibility?: SavedViewVisibility;
    layout?: ViewLayout;
    config?: SavedViewConfig;
}

export async function updateSavedView(ctx: RequestContext, id: string, input: UpdateSavedViewInput): Promise<SavedViewDto> {
    assertCanReadSavedViews(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const view = await SavedViewRepository.getReadable(db, ctx, v, id);
        if (!view) throw notFound('View not found');
        if (!mayChangeSavedView(ctx, view, input.visibility)) {
            const own = view.createdByUserId === ctx.userId;
            await refuseSavedView(
                ctx,
                view.id,
                'change',
                own ? 'SAVED_VIEW_CHANGE_NOT_PERMITTED' : 'SAVED_VIEW_CHANGE_CREATOR_ONLY',
                own ? 'You do not have permission to change this view.' : 'Only the person who saved a view can change it.',
            );
        }
        const data: { name?: string; visibility?: SavedViewVisibility; layout?: ViewLayout; configJson?: Prisma.InputJsonValue } = {};
        if (input.name !== undefined) data.name = cleanName(input.name);
        if (input.visibility !== undefined && input.visibility !== view.visibility) data.visibility = input.visibility;
        if (input.layout !== undefined) data.layout = input.layout;
        if (input.config !== undefined) data.configJson = cleanConfig(input.config);
        const changedFields = Object.keys(data);
        if (changedFields.length > 0) {
            await SavedViewRepository.update(db, ctx, view.id, data);
            await logEvent(db, ctx, {
                action: 'SAVED_VIEW_UPDATED',
                entityType: 'SavedView',
                entityId: view.id,
                details: `Changed view ${view.name}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'SavedView', operation: 'updated', changedFields },
                metadata: { visibility: data.visibility ?? view.visibility, projectId: view.projectId },
            });
        }
        const after = await SavedViewRepository.getReadable(db, ctx, v, view.id);
        return toSavedViewDto(after!, ctx);
    });
}

export async function deleteSavedView(ctx: RequestContext, id: string) {
    assertCanReadSavedViews(ctx);
    return runInTenantContext(ctx, async (db) => {
        const view = await SavedViewRepository.getReadable(db, ctx, await visibleProjects(ctx, db), id);
        if (!view) throw notFound('View not found');
        const basis = savedViewDeleteBasis(ctx, view);
        if (!basis) {
            await refuseSavedView(ctx, view.id, 'delete', 'SAVED_VIEW_DELETE_CREATOR_OR_ADMIN', 'Only the person who saved a view, or a workspace admin for a shared view, can delete it.');
        }
        await SavedViewRepository.delete(db, ctx, view.id);
        await logEvent(db, ctx, {
            action: basis === 'moderation' ? 'SAVED_VIEW_MODERATED' : 'SAVED_VIEW_DELETED',
            entityType: 'SavedView',
            entityId: view.id,
            details: basis === 'moderation' ? `Removed a shared view, ${view.name}, saved by another member` : `Deleted view ${view.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'SavedView', operation: 'deleted' },
            metadata: { visibility: view.visibility, projectId: view.projectId, createdByUserId: view.createdByUserId },
        });
        return { deleted: true, moderated: basis === 'moderation' };
    });
}
