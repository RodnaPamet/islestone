/**
 * A workspace for the work-item rendered tests (sub-phase 2.3): a fresh SWR
 * cache, the tenant provider for a role, the view configuration (one team
 * with the default workflow, one project, three types, two labels), a sonner
 * toaster, and a `fetch` routed by method and path, recording every request
 * so a test can assert what was sent (`If-Match`, bodies) and answer each
 * route as the real API would.
 *
 * Written fresh for Islestone.
 */
import { render, type RenderResult } from '@testing-library/react';
import type { Role } from '@prisma/client';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { SWRConfig } from 'swr';

import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { getPermissionsForRole } from '@/lib/permissions';
import { TenantProvider } from '@/lib/tenant-context-provider';
import type { Member, WorkItemDetailData, WorkItemRow, WorkItemViewConfig } from '@/lib/work-items/types';

export const SLUG = 'acme';
export const API = `/api/t/${SLUG}`;
export const TEAM = 'team-1';
export const PROJECT = 'proj-1';

export const STATES = [
    { id: 'st-backlog', teamId: TEAM, name: 'Backlog', category: 'BACKLOG', isDefault: false },
    { id: 'st-todo', teamId: TEAM, name: 'Todo', category: 'UNSTARTED', isDefault: true },
    { id: 'st-progress', teamId: TEAM, name: 'In progress', category: 'STARTED', isDefault: false },
    { id: 'st-done', teamId: TEAM, name: 'Done', category: 'DONE', isDefault: false },
    { id: 'st-cancelled', teamId: TEAM, name: 'Cancelled', category: 'CANCELLED', isDefault: false },
] as const;

export const CONFIG: WorkItemViewConfig = {
    projects: [{ id: PROJECT, teamId: TEAM, name: 'Islands', keyPrefix: 'ISL', archived: false }],
    teams: [{ id: TEAM, name: 'Core' }],
    states: STATES.map((s) => ({ ...s })),
    types: [
        { id: 'ty-feature', name: 'Feature', icon: null, color: null },
        { id: 'ty-bug', name: 'Bug', icon: null, color: null },
    ],
    labels: [
        { id: 'lb-ui', teamId: null, name: 'UI', color: null },
        { id: 'lb-api', teamId: TEAM, name: 'API', color: null },
    ],
};

export const MEMBERS: Member[] = [
    { id: 'u-ada', name: 'Ada Lovelace', email: 'ada@example.com', image: null },
    { id: 'u-bob', name: 'Bob Builder', email: 'bob@example.com', image: null },
];

export function row(n: number, over: Partial<WorkItemRow> = {}): WorkItemRow {
    return {
        id: `wi-${n}`,
        key: `ISL-${n}`,
        number: n,
        title: `Item ${n}`,
        projectId: PROJECT,
        teamId: TEAM,
        typeId: 'ty-feature',
        stateId: 'st-todo',
        stateCategory: 'UNSTARTED',
        priority: 'NONE',
        assigneeId: null,
        createdByUserId: 'u-ada',
        parentId: null,
        sortKey: `a${n}`,
        startDate: null,
        dueDate: null,
        version: 1,
        labelIds: [],
        createdAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-01T10:00:00.000Z',
        ...over,
    };
}

export function detail(r: WorkItemRow, over: Partial<WorkItemDetailData> = {}): WorkItemDetailData {
    const state = STATES.find((s) => s.id === r.stateId)!;
    return {
        ...r,
        description: 'The description.',
        createdByUserId: 'u-ada',
        project: { id: PROJECT, keyPrefix: 'ISL', name: 'Islands', archivedAt: null },
        state: { id: state.id, name: state.name, category: state.category },
        type: { id: r.typeId, name: 'Feature' },
        parent: null,
        labels: [],
        counts: { subItems: 0, comments: 0, watchers: 0 },
        ...over,
    };
}

export interface Recorded {
    method: string;
    path: string;
    search: URLSearchParams;
    body: unknown;
    ifMatch: string | null;
}

type Reply = { status?: number; body?: unknown };
export type Answer = Reply | ((req: Recorded) => Reply | Promise<Reply>);

/** A routing `fetch`: `routes['GET /work-items']` answers by method and path (search ignored). */
export function installFetch(routes: Record<string, Answer>) {
    const calls: Recorded[] = [];
    const fn = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost');
        const method = (init?.method ?? 'GET').toUpperCase();
        const path = url.pathname.startsWith(API) ? url.pathname.slice(API.length) : url.pathname;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const rec: Recorded = {
            method,
            path,
            search: url.searchParams,
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
            ifMatch: headers['If-Match'] ?? null,
        };
        calls.push(rec);
        const route = routes[`${method} ${path}`];
        const answer = typeof route === 'function' ? await route(rec) : route;
        const status = answer?.status ?? (route ? 200 : 404);
        const body = answer?.body ?? (route ? {} : { error: { code: 'NOT_FOUND', message: 'Not found' } });
        // jsdom has no `Response`: a minimal one with what api-client reads.
        return {
            ok: status >= 200 && status < 300,
            status,
            url: url.toString(),
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
    return { calls, fn };
}

/** A promise the test resolves when it wants the server to answer. */
export function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

export function page(items: WorkItemRow[]) {
    return { items, pageInfo: { hasNextPage: false } };
}

export function renderWorkspace(
    ui: ReactNode,
    opts: { role?: Role; userId?: string; config?: WorkItemViewConfig } = {},
): RenderResult {
    const role = opts.role ?? 'OWNER';
    return render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}>
            <TenantProvider
                value={{
                    userId: opts.userId ?? 'u-ada',
                    tenantId: 'tenant-1',
                    tenantSlug: SLUG,
                    tenantName: 'Acme',
                    role,
                    membershipRole: role,
                    permissions: {
                        canRead: true,
                        canWrite: role !== 'VIEWER' && role !== 'GUEST',
                        canAdmin: role === 'OWNER' || role === 'ADMIN',
                        canExport: role !== 'GUEST',
                    },
                    appPermissions: getPermissionsForRole(role),
                }}
            >
                <WorkConfigProvider config={opts.config ?? CONFIG}>
                    <main>{ui}</main>
                </WorkConfigProvider>
            </TenantProvider>
            <Toaster />
        </SWRConfig>,
    );
}
