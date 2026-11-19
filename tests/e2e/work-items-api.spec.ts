/**
 * The work-item API end to end, through the real edge, session and CSRF
 * posture (sub-phase 2.2): an owner signed in to an isolated workspace
 * creates a team, a project and two items over HTTP, resolves one by key,
 * meets the version check (428 without `If-Match`, 409 with a stale one), and
 * cannot reach the API of a workspace it is not a member of. Isolated
 * tenants only (roadmap H2: no shared mutable state between tests).
 */
import { expect, test } from './fixtures';

test.describe('work-item API', () => {
    test('an owner creates and edits work items over HTTP, with the version check', async ({ authedPage, isolatedTenant }) => {
        const api = authedPage.request;
        const base = `/api/t/${isolatedTenant.tenantSlug}`;

        const team = await api.post(`${base}/teams`, { data: { name: 'E2E team' } });
        expect(team.status()).toBe(201);
        const teamId = (await team.json()).id as string;

        const project = await api.post(`${base}/projects`, { data: { teamId, name: 'E2E', keyPrefix: 'E2E' } });
        expect(project.status()).toBe(201);
        const projectId = (await project.json()).id as string;

        const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string; name: string }>;
        expect(types.map((t) => t.name)).toEqual(['Feature', 'Bug', 'Chore']);

        const created = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[1]!.id, title: 'First bug' } });
        expect(created.status()).toBe(201);
        const item = (await created.json()) as { id: string; key: string; version: number };
        expect(item.key).toBe('E2E-1');

        const byKey = await api.get(`${base}/work-items/by-key/e2e-1`);
        expect(byKey.status()).toBe(200);
        expect((await byKey.json()).item.id).toBe(item.id);

        const list = await api.get(`${base}/work-items?projectId=${projectId}`);
        expect((await list.json()).items).toHaveLength(1);

        expect((await api.patch(`${base}/work-items/${item.id}`, { data: { title: 'No version' } })).status()).toBe(428);
        const ok = await api.patch(`${base}/work-items/${item.id}`, { data: { title: 'Renamed' }, headers: { 'If-Match': '"1"' } });
        expect(ok.status()).toBe(200);
        const stale = await api.patch(`${base}/work-items/${item.id}`, { data: { title: 'Stale' }, headers: { 'If-Match': '"1"' } });
        expect(stale.status()).toBe(409);
        expect((await stale.json()).error.details.version).toBe(2);
    });

    test('another workspace\'s work-item API is refused at the edge', async ({ authedPage }) => {
        const res = await authedPage.request.get('/api/t/not-my-workspace/work-items');
        expect([403, 404]).toContain(res.status());
    });
});
