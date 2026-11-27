/**
 * What the page views read on the server (sub-phase 4.1a): the request
 * context (`getTenantCtx`, the same gates the API asks), a tree with its top
 * level and the writes it offers (`pageAffordances`, the predicates the
 * usecases assert), or a page with its breadcrumb, and the trees a page may
 * move to (the workspace's and every live, unarchived project the caller
 * sees). A caller without `pages.view`, an unknown or invisible project and
 * an unknown, deleted or invisible page are a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { mayReadPages } from '@/app-layer/policies/page.policies';
import { mayReadWorkConfig } from '@/app-layer/policies/work-config.policies';
import type { RequestContext } from '@/app-layer/types';
import { getPage, getPageTree } from '@/app-layer/usecases/page';
import { listProjects } from '@/app-layer/usecases/project';
import { isAppError } from '@/lib/errors/types';
import type { PageAffordances, PageChildren, PageDetail, PageScope, PageTreeOption } from '@/lib/pages/types';

async function or404<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}

/** The workspace's tree and every live, unarchived project the caller sees, by name. */
async function moveTrees(ctx: RequestContext, workspaceLabel: string): Promise<PageTreeOption[]> {
    const projects = mayReadWorkConfig(ctx) ? await listProjects(ctx) : [];
    return [
        { key: { kind: 'workspace' }, label: workspaceLabel },
        ...projects.map((p) => ({ key: { kind: 'project' as const, projectId: p.id }, label: `${p.name} (${p.keyPrefix})` })),
    ];
}

export interface PageTreePageData {
    scope: PageScope;
    children: PageChildren;
    affordances: PageAffordances;
    trees: PageTreeOption[];
}

/** Workspace pages (`keyPrefix` absent) or a project's Pages, by its key prefix. */
export async function pageTreePageContext(tenantSlug: string, keyPrefix: string | null, workspaceLabel: string): Promise<PageTreePageData> {
    return or404(async () => {
        const ctx = await getTenantCtx({ tenantSlug });
        if (!mayReadPages(ctx)) notFound();
        let ref: Parameters<typeof getPageTree>[1] = { kind: 'workspace' };
        if (keyPrefix !== null) {
            if (!mayReadWorkConfig(ctx)) notFound();
            const project = (await listProjects(ctx, { includeArchived: true })).find((p) => p.keyPrefix === keyPrefix);
            if (!project) notFound();
            ref = { kind: 'project', projectId: project.id };
        }
        const tree = await getPageTree(ctx, ref);
        return { ...tree, trees: await moveTrees(ctx, workspaceLabel) };
    });
}

export async function pagePageContext(tenantSlug: string, pageId: string, workspaceLabel: string): Promise<{ detail: PageDetail; trees: PageTreeOption[] }> {
    return or404(async () => {
        const ctx = await getTenantCtx({ tenantSlug });
        if (!mayReadPages(ctx)) notFound();
        const detail = await getPage(ctx, pageId);
        return { detail, trees: await moveTrees(ctx, workspaceLabel) };
    });
}
