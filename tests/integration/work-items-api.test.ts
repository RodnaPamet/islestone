/**
 * The work-item API, route by route, against a real Postgres (sub-phase 2.2,
 * roadmap H2's permission matrix seed).
 *
 *   - Every route file under work-items, projects, teams, work-item-types,
 *     labels, and the others in `ROOTS` (recipient lists since 2.7e) is driven here, and the suite fails if one is not
 *     (the population is read from git).
 *   - A VIEWER is refused every write with a 403 and an `AUTHZ_DENIED` audit
 *     row; a MEMBER is admitted. The one write a VIEWER makes is its own
 *     PERSONAL saved view (owner decision 60), driven on its own below; the
 *     matrix drives the saved-view routes at a shared view, which it is refused.
 *     (Also a self-watch, driven on its own.)
 *   - A GUEST membership (written with the raw client: GUEST is not
 *     assignable until 8.4) holds no key (owner decision 204), so every route
 *     here refuses it with a 403 and an `AUTHZ_DENIED` row naming its key:
 *     it reads no item, list, count, project or configuration.
 *   - `If-Match` gives 428 without a version on a title edit and 409 with a
 *     stale one.
 *
 * `getTenantCtx` is replaced by a context for the role under test (the
 * session and edge are 1.4's, tested there); everything below it is real.
 */
import * as path from 'node:path';

import { NextRequest } from 'next/server';
import type { PrismaClient, Role } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));

import { createProject } from '@/app-layer/usecases/project';
import { createCycle } from '@/app-layer/usecases/cycle';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createGoal } from '@/app-layer/usecases/goal';
import { createInitiative } from '@/app-layer/usecases/initiative';
import { saveProjectAsTemplate } from '@/app-layer/usecases/project-template';
import { createWorkItemTemplate } from '@/app-layer/usecases/work-item-template';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { addComment } from '@/app-layer/usecases/work-item-collab';
import { createLabel } from '@/app-layer/usecases/label';
import { addWorkItemRelation } from '@/app-layer/usecases/work-item-relations';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';
import { createCustomField } from '@/app-layer/usecases/custom-field';
import { createSavedView } from '@/app-layer/usecases/saved-view';
import { createRecipientList } from '@/app-layer/usecases/recipient-list';

import { gitFiles } from '../helpers/git-files';
import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wapi${Date.now().toString(36)}`;
const ROOT = path.resolve(__dirname, '../..');
const ROOTS = ['work-items', 'projects', 'teams', 'work-item-types', 'labels', 'users', 'views', 'cycles', 'project-templates', 'recipient-lists'];

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface Ids {
    item: string;
    other: string;
    comment: string;
    link: string;
    relation: string;
    label: string;
    project: string;
    team: string;
    state: string;
    type: string;
    member: string;
    key: string;
    field: string;
    option: string;
    view: string;
    cycle: string;
    milestone: string;
    goal: string;
    initiative: string;
    itemTemplate: string;
    projectTemplate: string;
    workspaceList: string;
    projectList: string;
}

/** One request per route and method: the template, a body, and whether it reads an item. */
interface Call {
    file: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: (i: Ids) => string;
    params: (i: Ids) => Record<string, string>;
    body?: (i: Ids) => unknown;
    /** A read of one visible item. */
    itemRead?: boolean;
    /** A list or count over items. */
    itemList?: boolean;
    /** Does the route write? */
    write: boolean;
    /** The key the route takes. */
    key: string;
}

const W = 'src/app/api/t/[tenantSlug]/work-items';
const P = (i: Ids, extra: Record<string, string> = {}) => ({ tenantSlug: TAG, ...extra, ...(i ? {} : {}) });
const CALLS: Call[] = [
    { file: `${W}/route.ts`, method: 'GET', path: () => '/work-items', params: (i) => P(i), itemList: true, write: false, key: 'work_items.view' },
    { file: `${W}/route.ts`, method: 'POST', path: () => '/work-items', params: (i) => P(i), body: (i) => ({ projectId: i.project, typeId: i.type, title: 'api created' }), write: true, key: 'work_items.create' },
    { file: `${W}/deleted/route.ts`, method: 'GET', path: () => '/work-items/deleted', params: (i) => P(i), write: true, key: 'work_items.delete' },
    { file: `${W}/metrics/route.ts`, method: 'GET', path: () => '/work-items/metrics', params: (i) => P(i), itemList: true, write: false, key: 'work_items.view' },
    // Roadmap 3.1b: the timeline (the list's filters, the engine's answer).
    { file: `${W}/timeline/route.ts`, method: 'GET', path: (i) => `/work-items/timeline?projectId=${i.project}`, params: (i) => P(i), itemList: true, write: false, key: 'work_items.view' },
    // Roadmap 3.3a: the calendar view (the list's filters, a window of dates).
    { file: `${W}/calendar/route.ts`, method: 'GET', path: (i) => `/work-items/calendar?projectId=${i.project}&from=2026-01-01&to=2026-02-11`, params: (i) => P(i), itemList: true, write: false, key: 'work_items.view' },
    { file: `${W}/by-key/[key]/route.ts`, method: 'GET', path: (i) => `/work-items/by-key/${i.key}`, params: (i) => P(i, { key: i.key }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/bulk/assign/route.ts`, method: 'POST', path: () => '/work-items/bulk/assign', params: (i) => P(i), body: (i) => ({ workItemIds: [i.other], assigneeId: null }), write: true, key: 'work_items.assign' },
    { file: `${W}/bulk/state/route.ts`, method: 'POST', path: () => '/work-items/bulk/state', params: (i) => P(i), body: (i) => ({ workItemIds: [i.other], stateCategory: 'STARTED' }), write: true, key: 'work_items.edit' },
    { file: `${W}/bulk/due/route.ts`, method: 'POST', path: () => '/work-items/bulk/due', params: (i) => P(i), body: (i) => ({ workItemIds: [i.other], dueDate: '2031-01-02' }), write: true, key: 'work_items.edit' },
    // Roadmap 3.1c: a change of dates from the timeline (a stale version is a 409, never a 403).
    {
        file: `${W}/bulk/dates/route.ts`, method: 'POST', path: () => '/work-items/bulk/dates', params: (i) => P(i),
        body: (i) => ({ dragged: { id: i.other, version: 1, startDate: '2031-01-02', dueDate: '2031-01-03' }, pushed: [] }), write: true, key: 'work_items.edit',
    },
    { file: `${W}/bulk/delete/route.ts`, method: 'POST', path: () => '/work-items/bulk/delete', params: (i) => P(i), body: () => ({ workItemIds: ['nothing-here'] }), write: true, key: 'work_items.delete' },
    { file: `${W}/[workItemId]/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/route.ts`, method: 'PATCH', path: (i) => `/work-items/${i.other}`, params: (i) => P(i, { workItemId: i.other }), body: () => ({ priority: 'LOW' }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/route.ts`, method: 'DELETE', path: () => '/work-items/none', params: (i) => P(i, { workItemId: 'none' }), write: true, key: 'work_items.delete' },
    { file: `${W}/[workItemId]/state/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/state`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ stateId: i.state }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/assign/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/assign`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ assigneeId: i.member }), write: true, key: 'work_items.assign' },
    { file: `${W}/[workItemId]/restore/route.ts`, method: 'POST', path: () => '/work-items/none/restore', params: (i) => P(i, { workItemId: 'none' }), write: true, key: 'work_items.delete' },
    { file: `${W}/[workItemId]/activity/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}/activity`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/sub-items/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}/sub-items?progress=1`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/move/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/move`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ position: { afterId: i.item } }), write: true, key: 'work_items.edit' },
    // Sub-phase 2.3: a board drop (state and place in one request).
    { file: `${W}/[workItemId]/move/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/move`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ stateId: i.state, position: { beforeId: i.item } }), write: true, key: 'work_items.edit' },
    // Sub-phase 2.3: the member roster the pickers read.
    { file: 'src/app/api/t/[tenantSlug]/users/assignable/route.ts', method: 'GET', path: () => '/users/assignable', params: (i) => P(i), write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/comments/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}/comments`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/comments/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/comments`, params: (i) => P(i, { workItemId: i.other }), body: () => ({ body: 'hello' }), write: true, key: 'work_items.comment' },
    { file: `${W}/[workItemId]/comments/[commentId]/route.ts`, method: 'PATCH', path: (i) => `/work-items/${i.item}/comments/${i.comment}`, params: (i) => P(i, { workItemId: i.item, commentId: i.comment }), body: () => ({ body: 'edited' }), write: true, key: 'work_items.comment' },
    { file: `${W}/[workItemId]/comments/[commentId]/route.ts`, method: 'DELETE', path: () => '/work-items/none/comments/none', params: (i) => P(i, { workItemId: 'none', commentId: 'none' }), write: true, key: 'work_items.comment' },
    { file: `${W}/[workItemId]/watchers/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}/watchers`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/watchers/route.ts`, method: 'POST', path: (i) => `/work-items/${i.item}/watchers`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/watchers/route.ts`, method: 'DELETE', path: (i) => `/work-items/${i.item}/watchers`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/watchers/[userId]/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/watchers/${i.member}`, params: (i) => P(i, { workItemId: i.other, userId: i.member }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/watchers/[userId]/route.ts`, method: 'DELETE', path: (i) => `/work-items/${i.other}/watchers/${i.member}`, params: (i) => P(i, { workItemId: i.other, userId: i.member }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/links/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}/links`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/links/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/links`, params: (i) => P(i, { workItemId: i.other }), body: () => ({ type: 'URL', location: 'https://example.com/x' }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/links/[linkId]/route.ts`, method: 'DELETE', path: () => '/work-items/none/links/none', params: (i) => P(i, { workItemId: 'none', linkId: 'none' }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/relations/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}/relations`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/relations/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/relations`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ type: 'RELATES', toId: i.item }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/relations/[relationId]/route.ts`, method: 'DELETE', path: () => '/work-items/none/relations/none', params: (i) => P(i, { workItemId: 'none', relationId: 'none' }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/labels/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/labels`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ labelIds: [i.label] }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/labels/[labelId]/route.ts`, method: 'DELETE', path: () => '/work-items/none/labels/none', params: (i) => P(i, { workItemId: 'none', labelId: 'none' }), write: true, key: 'work_items.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/route.ts', method: 'GET', path: () => '/projects', params: (i) => P(i), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/projects/route.ts', method: 'POST', path: () => '/projects', params: (i) => P(i), body: (i) => ({ teamId: i.team, name: 'API', keyPrefix: `AP${Math.floor(Math.random() * 9e7)}`.slice(0, 10) }), write: true, key: 'projects.create' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/route.ts', method: 'GET', path: (i) => `/projects/${i.project}`, params: (i) => P(i, { projectId: i.project }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/route.ts', method: 'PATCH', path: (i) => `/projects/${i.project}`, params: (i) => P(i, { projectId: i.project }), body: () => ({ name: 'Renamed project' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/route.ts', method: 'DELETE', path: () => '/projects/none', params: (i) => P(i, { projectId: 'none' }), write: true, key: 'projects.archive' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/archive/route.ts', method: 'POST', path: () => '/projects/none/archive', params: (i) => P(i, { projectId: 'none' }), body: () => ({ archived: true }), write: true, key: 'projects.archive' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/restore/route.ts', method: 'POST', path: () => '/projects/none/restore', params: (i) => P(i, { projectId: 'none' }), write: true, key: 'projects.archive' },
    { file: 'src/app/api/t/[tenantSlug]/teams/route.ts', method: 'GET', path: () => '/teams', params: (i) => P(i), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/teams/route.ts', method: 'POST', path: () => '/teams', params: (i) => P(i), body: () => ({ name: `API team ${Math.random()}` }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/route.ts', method: 'GET', path: (i) => `/teams/${i.team}`, params: (i) => P(i, { teamId: i.team }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/route.ts', method: 'PATCH', path: (i) => `/teams/${i.team}`, params: (i) => P(i, { teamId: i.team }), body: () => ({ name: `Core ${Math.random()}` }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/route.ts', method: 'DELETE', path: () => '/teams/none', params: (i) => P(i, { teamId: 'none' }), write: true, key: 'admin.manage' },
    // Roadmap 3.1a: a team's working calendar (decision 193).
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/working-calendar/route.ts', method: 'GET', path: (i) => `/teams/${i.team}/working-calendar`, params: (i) => P(i, { teamId: i.team }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/working-calendar/route.ts', method: 'PUT', path: (i) => `/teams/${i.team}/working-calendar`, params: (i) => P(i, { teamId: i.team }), body: () => ({ timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5] }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/working-calendar/route.ts', method: 'DELETE', path: () => '/teams/none/working-calendar', params: (i) => P(i, { teamId: 'none' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/working-calendar/holidays/route.ts', method: 'POST', path: () => '/teams/none/working-calendar/holidays', params: (i) => P(i, { teamId: 'none' }), body: () => ({ holidays: [{ day: '2040-01-01', name: 'New Year' }] }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/working-calendar/holidays/[holidayId]/route.ts', method: 'DELETE', path: (i) => `/teams/${i.team}/working-calendar/holidays/none`, params: (i) => P(i, { teamId: i.team, holidayId: 'none' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/workflow-states/route.ts', method: 'GET', path: (i) => `/teams/${i.team}/workflow-states`, params: (i) => P(i, { teamId: i.team }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/workflow-states/route.ts', method: 'POST', path: (i) => `/teams/${i.team}/workflow-states`, params: (i) => P(i, { teamId: i.team }), body: () => ({ name: `QA ${Math.random()}`, category: 'STARTED' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/workflow-states/[stateId]/route.ts', method: 'PATCH', path: (i) => `/teams/${i.team}/workflow-states/${i.state}`, params: (i) => P(i, { teamId: i.team, stateId: i.state }), body: () => ({ name: 'In progress' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/workflow-states/[stateId]/route.ts', method: 'DELETE', path: (i) => `/teams/${i.team}/workflow-states/none`, params: (i) => P(i, { teamId: i.team, stateId: 'none' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/work-item-types/route.ts', method: 'GET', path: () => '/work-item-types', params: (i) => P(i), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/work-item-types/route.ts', method: 'POST', path: () => '/work-item-types', params: (i) => P(i), body: () => ({ name: `Type ${Math.random()}`, icon: 'bug', color: '#ff0000' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/work-item-types/[typeId]/route.ts', method: 'PATCH', path: (i) => `/work-item-types/${i.type}`, params: (i) => P(i, { typeId: i.type }), body: () => ({ color: 'brand-500' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/labels/route.ts', method: 'GET', path: () => '/labels', params: (i) => P(i), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/labels/route.ts', method: 'POST', path: () => '/labels', params: (i) => P(i), body: () => ({ name: `Label ${Math.random()}` }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/labels/[labelId]/route.ts', method: 'PATCH', path: (i) => `/labels/${i.label}`, params: (i) => P(i, { labelId: i.label }), body: () => ({ color: '#00ff00' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/labels/[labelId]/route.ts', method: 'DELETE', path: () => '/labels/none', params: (i) => P(i, { labelId: 'none' }), write: true, key: 'admin.manage' },
    // Sub-phase 2.4: custom fields and saved views.
    { file: `${W}/[workItemId]/custom-fields/[fieldId]/route.ts`, method: 'PUT', path: (i) => `/work-items/${i.other}/custom-fields/${i.field}`, params: (i) => P(i, { workItemId: i.other, fieldId: i.field }), body: (i) => ({ value: i.option }), write: true, key: 'work_items.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/custom-fields/route.ts', method: 'GET', path: (i) => `/projects/${i.project}/custom-fields`, params: (i) => P(i, { projectId: i.project }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/custom-fields/route.ts', method: 'POST', path: (i) => `/projects/${i.project}/custom-fields`, params: (i) => P(i, { projectId: i.project }), body: () => ({ name: `Field ${Math.random()}`, type: 'NUMBER' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/custom-fields/[fieldId]/route.ts', method: 'PATCH', path: (i) => `/projects/${i.project}/custom-fields/${i.field}`, params: (i) => P(i, { projectId: i.project, fieldId: i.field }), body: () => ({ name: 'Stage' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/custom-fields/[fieldId]/options/route.ts', method: 'POST', path: (i) => `/projects/${i.project}/custom-fields/${i.field}/options`, params: (i) => P(i, { projectId: i.project, fieldId: i.field }), body: () => ({ name: `Opt ${Math.random()}` }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/custom-fields/[fieldId]/options/[optionId]/route.ts', method: 'PATCH', path: (i) => `/projects/${i.project}/custom-fields/${i.field}/options/${i.option}`, params: (i) => P(i, { projectId: i.project, fieldId: i.field, optionId: i.option }), body: () => ({ color: '#123456' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/custom-fields/[fieldId]/options/[optionId]/route.ts', method: 'DELETE', path: (i) => `/projects/${i.project}/custom-fields/${i.field}/options/none`, params: (i) => P(i, { projectId: i.project, fieldId: i.field, optionId: 'none' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/views/route.ts', method: 'GET', path: () => '/views', params: (i) => P(i), write: false, key: 'views.view' },
    // A SHARED view: a VIEWER holds views.create but not views.share (decision 60), so the usecase refuses it, audited.
    { file: 'src/app/api/t/[tenantSlug]/views/route.ts', method: 'POST', path: () => '/views', params: (i) => P(i), body: () => ({ name: 'Ours', visibility: 'SHARED', config: { filters: {} } }), write: true, key: 'views.create' },
    { file: 'src/app/api/t/[tenantSlug]/views/[viewId]/route.ts', method: 'GET', path: (i) => `/views/${i.view}`, params: (i) => P(i, { viewId: i.view }), write: false, key: 'views.view' },
    { file: 'src/app/api/t/[tenantSlug]/views/[viewId]/route.ts', method: 'PATCH', path: (i) => `/views/${i.view}`, params: (i) => P(i, { viewId: i.view }), body: () => ({ name: 'Renamed view' }), write: true, key: 'views.edit' },
    // The MEMBER's shared view: a VIEWER is not its creator and holds no views.share (decisions 59, 60).
    { file: 'src/app/api/t/[tenantSlug]/views/[viewId]/route.ts', method: 'DELETE', path: (i) => `/views/${i.view}`, params: (i) => P(i, { viewId: i.view }), write: true, key: 'views.edit' },
    // Sub-phase 2.5a: cycles.
    { file: `${W}/[workItemId]/cycle/route.ts`, method: 'PUT', path: (i) => `/work-items/${i.other}/cycle`, params: (i) => P(i, { workItemId: i.other }), body: () => ({ cycleId: null }), write: true, key: 'work_items.edit' },
    { file: 'src/app/api/t/[tenantSlug]/cycles/route.ts', method: 'GET', path: () => '/cycles', params: (i) => P(i), write: false, key: 'cycles.view' },
    { file: 'src/app/api/t/[tenantSlug]/cycles/route.ts', method: 'POST', path: () => '/cycles', params: (i) => P(i), body: (i) => ({ teamId: i.team, startsOn: '2040-01-01', endsOn: '2040-01-14' }), write: true, key: 'cycles.manage' },
    { file: 'src/app/api/t/[tenantSlug]/cycles/[cycleId]/route.ts', method: 'GET', path: (i) => `/cycles/${i.cycle}`, params: (i) => P(i, { cycleId: i.cycle }), write: false, key: 'cycles.view' },
    { file: 'src/app/api/t/[tenantSlug]/cycles/[cycleId]/route.ts', method: 'PATCH', path: (i) => `/cycles/${i.cycle}`, params: (i) => P(i, { cycleId: i.cycle }), body: () => ({ name: 'Renamed cycle' }), write: true, key: 'cycles.manage' },
    { file: 'src/app/api/t/[tenantSlug]/cycles/[cycleId]/route.ts', method: 'DELETE', path: () => '/cycles/none', params: (i) => P(i, { cycleId: 'none' }), write: true, key: 'cycles.manage' },
    { file: 'src/app/api/t/[tenantSlug]/cycles/[cycleId]/burn-up/route.ts', method: 'GET', path: (i) => `/cycles/${i.cycle}/burn-up`, params: (i) => P(i, { cycleId: i.cycle }), write: false, key: 'cycles.view' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/cycle-schedule/route.ts', method: 'GET', path: (i) => `/teams/${i.team}/cycle-schedule`, params: (i) => P(i, { teamId: i.team }), write: false, key: 'cycles.view' },
    // Sub-phase 2.5d: repeats (the item has no due date, so a MEMBER's PUT is a 409, never a 403).
    { file: `${W}/[workItemId]/recurrence/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}/recurrence`, params: (i) => P(i, { workItemId: i.item }), write: false, key: 'work_items.view', itemRead: true },
    { file: `${W}/[workItemId]/recurrence/route.ts`, method: 'PUT', path: (i) => `/work-items/${i.other}/recurrence`, params: (i) => P(i, { workItemId: i.other }), body: () => ({ frequency: 'WEEKLY' }), write: true, key: 'work_items.create' },
    { file: `${W}/[workItemId]/recurrence/route.ts`, method: 'DELETE', path: (i) => `/work-items/${i.other}/recurrence`, params: (i) => P(i, { workItemId: i.other }), write: true, key: 'work_items.edit' },
    // Sub-phase 2.5c: templates.
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/work-item-templates/route.ts', method: 'GET', path: (i) => `/projects/${i.project}/work-item-templates`, params: (i) => P(i, { projectId: i.project }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/work-item-templates/route.ts', method: 'POST', path: (i) => `/projects/${i.project}/work-item-templates`, params: (i) => P(i, { projectId: i.project }), body: () => ({ name: `Template ${Math.random()}`, title: 'From the API' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/work-item-templates/[templateId]/route.ts', method: 'PATCH', path: (i) => `/projects/${i.project}/work-item-templates/${i.itemTemplate}`, params: (i) => P(i, { projectId: i.project, templateId: i.itemTemplate }), body: () => ({ dueInDays: 3 }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/work-item-templates/[templateId]/route.ts', method: 'DELETE', path: (i) => `/projects/${i.project}/work-item-templates/none`, params: (i) => P(i, { projectId: i.project, templateId: 'none' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/project-templates/route.ts', method: 'GET', path: () => '/project-templates', params: (i) => P(i), write: false, key: 'projects.create' },
    { file: 'src/app/api/t/[tenantSlug]/project-templates/route.ts', method: 'POST', path: () => '/project-templates', params: (i) => P(i), body: (i) => ({ fromProjectId: i.project, name: `Saved ${Math.random()}` }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/project-templates/[templateId]/route.ts', method: 'PATCH', path: (i) => `/project-templates/${i.projectTemplate}`, params: (i) => P(i, { templateId: i.projectTemplate }), body: () => ({ archived: false }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/project-templates/[templateId]/route.ts', method: 'DELETE', path: () => '/project-templates/none', params: (i) => P(i, { templateId: 'none' }), write: true, key: 'admin.manage' },
    // Sub-phase 2.4b: waiting on.
    { file: `${W}/[workItemId]/waiting-on/route.ts`, method: 'PUT', path: (i) => `/work-items/${i.other}/waiting-on`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ userId: i.member }), write: true, key: 'work_items.edit' },
    // Sub-phase 2.4b-c: the marked answer (the item's type hides the answer, so a MEMBER's mark is a 400, never a 403) and the Question type.
    { file: `${W}/[workItemId]/answer/route.ts`, method: 'PUT', path: (i) => `/work-items/${i.item}/answer`, params: (i) => P(i, { workItemId: i.item }), body: (i) => ({ commentId: i.comment }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/answer/route.ts`, method: 'DELETE', path: (i) => `/work-items/${i.item}/answer`, params: (i) => P(i, { workItemId: i.item }), write: true, key: 'work_items.edit' },
    { file: 'src/app/api/t/[tenantSlug]/work-item-types/question-preset/route.ts', method: 'POST', path: () => '/work-item-types/question-preset', params: (i) => P(i), body: () => ({ name: `Question ${Math.random()}` }), write: true, key: 'admin.manage' },
    // Sub-phase 2.8a: review steps. The step-level calls name no step ('none': a 404 past the key); the
    // full matrix, with rounds, named reviewers, standing and the assignee, is tests/integration/review-api.test.ts.
    { file: `${W}/[workItemId]/review/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}/review`, params: (i) => P(i, { workItemId: i.item }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/review/steps/route.ts`, method: 'PUT', path: (i) => `/work-items/${i.other}/review/steps`, params: (i) => P(i, { workItemId: i.other }), body: () => ({ steps: [] }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/review/send/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/review/send`, params: (i) => P(i, { workItemId: i.other }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/review/withdraw/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/review/withdraw`, params: (i) => P(i, { workItemId: i.other }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/review/steps/[stepId]/respond/route.ts`, method: 'POST', path: (i) => `/work-items/${i.item}/review/steps/none/respond`, params: (i) => P(i, { workItemId: i.item, stepId: 'none' }), body: () => ({ outcome: 'SIGNED_OFF' }), itemRead: true, write: false, key: 'work_items.view' },
    { file: `${W}/[workItemId]/review/steps/[stepId]/skip/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/review/steps/none/skip`, params: (i) => P(i, { workItemId: i.other, stepId: 'none' }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/review/steps/[stepId]/reviewers/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/review/steps/none/reviewers`, params: (i) => P(i, { workItemId: i.other, stepId: 'none' }), body: (i) => ({ userId: i.member }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/review/steps/[stepId]/reviewers/[userId]/route.ts`, method: 'DELETE', path: (i) => `/work-items/${i.other}/review/steps/none/reviewers/${i.member}`, params: (i) => P(i, { workItemId: i.other, stepId: 'none', userId: i.member }), write: true, key: 'work_items.edit' },
    // Sub-phase 2.4b-b: field sets (OPTIONAL removes a rule, so the calls leave nothing behind).
    { file: 'src/app/api/t/[tenantSlug]/work-item-types/[typeId]/fields/route.ts', method: 'GET', path: (i) => `/work-item-types/${i.type}/fields`, params: (i) => P(i, { typeId: i.type }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/work-item-types/[typeId]/fields/route.ts', method: 'PUT', path: (i) => `/work-item-types/${i.type}/fields`, params: (i) => P(i, { typeId: i.type }), body: () => ({ field: 'dueDate', requirement: 'OPTIONAL' }), write: true, key: 'admin.manage' },
    // Sub-phase 2.8c: a type's default review steps and its Done check.
    { file: 'src/app/api/t/[tenantSlug]/work-item-types/[typeId]/review-steps/route.ts', method: 'GET', path: (i) => `/work-item-types/${i.type}/review-steps`, params: (i) => P(i, { typeId: i.type }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/work-item-types/[typeId]/review-steps/route.ts', method: 'PUT', path: (i) => `/work-item-types/${i.type}/review-steps`, params: (i) => P(i, { typeId: i.type }), body: () => ({ reviewRequiredForDone: false, steps: [] }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/type-fields/route.ts', method: 'GET', path: (i) => `/projects/${i.project}/type-fields`, params: (i) => P(i, { projectId: i.project }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/type-fields/route.ts', method: 'PUT', path: (i) => `/projects/${i.project}/type-fields`, params: (i) => P(i, { projectId: i.project }), body: (i) => ({ typeId: i.type, customFieldId: i.field, requirement: 'OPTIONAL' }), write: true, key: 'projects.edit' },
    // Sub-phase 2.5b: milestones.
    { file: `${W}/[workItemId]/milestone/route.ts`, method: 'PUT', path: (i) => `/work-items/${i.other}/milestone`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ milestoneId: i.milestone }), write: true, key: 'work_items.edit' },
    // Sub-phase 3.2a: an item's goal, its ancestry and a project's initiative.
    { file: `${W}/[workItemId]/goal/route.ts`, method: 'PUT', path: (i) => `/work-items/${i.other}/goal`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ goalId: i.goal }), write: true, key: 'work_items.edit' },
    { file: `${W}/[workItemId]/ancestry/route.ts`, method: 'GET', path: (i) => `/work-items/${i.item}/ancestry`, params: (i) => P(i, { workItemId: i.item }), write: false, key: 'work_items.view' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/initiative/route.ts', method: 'PUT', path: (i) => `/projects/${i.project}/initiative`, params: (i) => P(i, { projectId: i.project }), body: (i) => ({ initiativeId: i.initiative }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/milestones/route.ts', method: 'GET', path: (i) => `/projects/${i.project}/milestones`, params: (i) => P(i, { projectId: i.project }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/milestones/route.ts', method: 'POST', path: (i) => `/projects/${i.project}/milestones`, params: (i) => P(i, { projectId: i.project }), body: () => ({ name: `Milestone ${Math.random()}` }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/milestones/[milestoneId]/route.ts', method: 'PATCH', path: (i) => `/projects/${i.project}/milestones/${i.milestone}`, params: (i) => P(i, { projectId: i.project, milestoneId: i.milestone }), body: () => ({ dueDate: '2040-03-01' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/milestones/[milestoneId]/route.ts', method: 'DELETE', path: (i) => `/projects/${i.project}/milestones/none`, params: (i) => P(i, { projectId: i.project, milestoneId: 'none' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/teams/[teamId]/cycle-schedule/route.ts', method: 'PUT', path: (i) => `/teams/${i.team}/cycle-schedule`, params: (i) => P(i, { teamId: i.team }), body: () => ({ enabled: false, lengthWeeks: 2, firstStartsOn: '2040-02-06', upcomingCount: 2, rollover: 'NEXT_CYCLE' }), write: true, key: 'cycles.manage' },
    // Sub-phase 2.6a: a project's intake (its other routes are driven in intake-api.test.ts).
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/intake/route.ts', method: 'PUT', path: (i) => `/projects/${i.project}/intake`, params: (i) => P(i, { projectId: i.project }), body: () => ({ enabled: false }), write: true, key: 'intake.manage' },
    // Sub-phase 2.6c: a new address for the project's intake (409 while it has none; the flow is in intake-email.test.ts).
    // Sub-phase 2.7e: recipient lists, split by scope (decision 140).
    { file: 'src/app/api/t/[tenantSlug]/recipient-lists/route.ts', method: 'GET', path: () => '/recipient-lists', params: (i) => P(i), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/recipient-lists/route.ts', method: 'POST', path: () => '/recipient-lists', params: (i) => P(i), body: () => ({ name: `List ${Math.random()}` }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/recipient-lists/[listId]/route.ts', method: 'GET', path: (i) => `/recipient-lists/${i.workspaceList}`, params: (i) => P(i, { listId: i.workspaceList }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/recipient-lists/[listId]/route.ts', method: 'PATCH', path: (i) => `/recipient-lists/${i.workspaceList}`, params: (i) => P(i, { listId: i.workspaceList }), body: () => ({ description: 'Who signs off' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/recipient-lists/[listId]/members/route.ts', method: 'PUT', path: (i) => `/recipient-lists/${i.workspaceList}/members`, params: (i) => P(i, { listId: i.workspaceList }), body: (i) => ({ userIds: [i.member] }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/recipient-lists/[listId]/members/route.ts', method: 'PATCH', path: (i) => `/recipient-lists/${i.workspaceList}/members`, params: (i) => P(i, { listId: i.workspaceList }), body: (i) => ({ add: [i.member] }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/recipient-lists/[listId]/archive/route.ts', method: 'POST', path: () => '/recipient-lists/none/archive', params: (i) => P(i, { listId: 'none' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/recipient-lists/[listId]/restore/route.ts', method: 'POST', path: () => '/recipient-lists/none/restore', params: (i) => P(i, { listId: 'none' }), write: true, key: 'admin.manage' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/recipient-lists/route.ts', method: 'GET', path: (i) => `/projects/${i.project}/recipient-lists`, params: (i) => P(i, { projectId: i.project }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/recipient-lists/route.ts', method: 'POST', path: (i) => `/projects/${i.project}/recipient-lists`, params: (i) => P(i, { projectId: i.project }), body: () => ({ name: `List ${Math.random()}` }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/recipient-lists/[listId]/route.ts', method: 'GET', path: (i) => `/projects/${i.project}/recipient-lists/${i.projectList}`, params: (i) => P(i, { projectId: i.project, listId: i.projectList }), write: false, key: 'projects.view' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/recipient-lists/[listId]/route.ts', method: 'PATCH', path: (i) => `/projects/${i.project}/recipient-lists/${i.projectList}`, params: (i) => P(i, { projectId: i.project, listId: i.projectList }), body: () => ({ description: 'Desk' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/recipient-lists/[listId]/members/route.ts', method: 'PUT', path: (i) => `/projects/${i.project}/recipient-lists/${i.projectList}/members`, params: (i) => P(i, { projectId: i.project, listId: i.projectList }), body: (i) => ({ userIds: [i.member] }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/recipient-lists/[listId]/members/route.ts', method: 'PATCH', path: (i) => `/projects/${i.project}/recipient-lists/${i.projectList}/members`, params: (i) => P(i, { projectId: i.project, listId: i.projectList }), body: (i) => ({ add: [i.member] }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/recipient-lists/[listId]/archive/route.ts', method: 'POST', path: (i) => `/projects/${i.project}/recipient-lists/none/archive`, params: (i) => P(i, { projectId: i.project, listId: 'none' }), write: true, key: 'projects.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/recipient-lists/[listId]/restore/route.ts', method: 'POST', path: (i) => `/projects/${i.project}/recipient-lists/none/restore`, params: (i) => P(i, { projectId: i.project, listId: 'none' }), write: true, key: 'projects.edit' },
    { file: `${W}/[workItemId]/watchers/recipient-list/route.ts`, method: 'POST', path: (i) => `/work-items/${i.other}/watchers/recipient-list`, params: (i) => P(i, { workItemId: i.other }), body: (i) => ({ listId: i.projectList }), write: true, key: 'work_items.edit' },
    { file: 'src/app/api/t/[tenantSlug]/projects/[projectId]/intake/email-address/route.ts', method: 'POST', path: (i) => `/projects/${i.project}/intake/email-address`, params: (i) => P(i, { projectId: i.project }), write: true, key: 'intake.manage' },
];

function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(`http://localhost/api/t/${TAG}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

async function handlerFor(call: Call): Promise<Handler> {
    const mod = (await import(`../../${call.file}`)) as Record<string, Handler>;
    const handler = mod[call.method];
    if (!handler) throw new Error(`${call.file} exports no ${call.method}`);
    return handler;
}

describeFn('the work-item API', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    const users: Partial<Record<Role, string>> = {};
    const ids = {} as Ids;

    const ctxFor = (role: Role): RequestContext =>
        makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: users[role]!, requestId: `${TAG}-${role}-${Math.random()}` });

    async function call(role: Role, c: Call, headers: Record<string, string> = {}) {
        getTenantCtxMock.mockResolvedValue(ctxFor(role));
        const handler = await handlerFor(c);
        const res = await handler(request(c.method, c.path(ids), c.body?.(ids), headers), { params: Promise.resolve(c.params(ids)) });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        for (const role of ['OWNER', 'MEMBER', 'VIEWER', 'GUEST'] as Role[]) {
            const u = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${TAG}@example.test` } });
            // GUEST is written with the raw client: no writer assigns it before 8.4.
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            users[role] = u.id;
        }
        const owner = ctxFor('OWNER');
        const team = await createTeam(owner, { name: 'API' });
        const project = await createProject(owner, { teamId: team.id, name: 'API', keyPrefix: 'API' });
        const type = (await listWorkItemTypes(owner))[0]!;
        const item = await createWorkItem(owner, { projectId: project.id, typeId: type.id, title: 'the item' });
        const other = await createWorkItem(owner, { projectId: project.id, typeId: type.id, title: 'the other' });
        await createWorkItem(owner, { projectId: project.id, typeId: type.id, title: 'a sub-item', parentId: item.id });
        // Authored by the MEMBER, so the member's edit is the author's.
        const comment = await addComment(ctxFor('MEMBER'), item.id, { body: 'a comment' });
        const label = await createLabel(owner, { name: 'api label' });
        const relation = await addWorkItemRelation(owner, item.id, { type: 'BLOCKS', toId: other.id });
        const field = await createCustomField(owner, project.id, { name: 'Stage gate', type: 'SELECT', options: [{ name: 'Alpha' }, { name: 'Beta' }] });
        const view = await createSavedView(ctxFor('MEMBER'), { name: 'Shared by a member', visibility: 'SHARED', layout: 'LIST', config: { filters: {}, sort: 'manual', laneBy: 'none' } });
        const cycle = await createCycle(owner, { teamId: team.id, startsOn: '2039-01-03', endsOn: '2039-01-16' });
        const milestone = await createMilestone(owner, project.id, { name: 'API milestone' });
        const goal = await createGoal(owner, { title: 'API goal' });
        const initiative = await createInitiative(owner, { name: 'API initiative', goalId: goal.id });
        const itemTemplate = await createWorkItemTemplate(owner, project.id, { name: 'API template', title: 'From a template' });
        const projectTemplate = await saveProjectAsTemplate(owner, { fromProjectId: project.id, name: 'API project template' });
        const workspaceList = await createRecipientList(owner, null, { name: 'API leads', userIds: [users.MEMBER!] });
        const projectList = await createRecipientList(owner, project.id, { name: 'API desk', userIds: [users.MEMBER!, users.VIEWER!] });
        Object.assign(ids, {
            workspaceList: workspaceList.id,
            projectList: projectList.id,
            itemTemplate: itemTemplate.id,
            projectTemplate: projectTemplate.id,
            cycle: cycle.id,
            milestone: milestone.id,
            goal: goal.id,
            initiative: initiative.id,
            field: field.id,
            option: field.options[0]!.id,
            view: view.id,
            item: item.id,
            other: other.id,
            comment: comment.id,
            link: 'none',
            relation: relation.id,
            label: label.id,
            project: project.id,
            team: team.id,
            state: team.workflowStates.find((s) => s.name === 'In progress')!.id,
            type: type.id,
            member: users.MEMBER!,
            key: item.key,
        });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('drives every work route file and method (the population is read from git)', () => {
        const files = gitFiles(ROOT).filter((f) => ROOTS.some((r) => f.startsWith(`src/app/api/t/[tenantSlug]/${r}/`)) && f.endsWith('/route.ts'));
        expect(files.length).toBeGreaterThan(30);
        const driven = new Set(CALLS.map((c) => c.file));
        expect(files.filter((f) => !driven.has(f))).toEqual([]);
        for (const f of files) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const src = require('node:fs').readFileSync(path.join(ROOT, f), 'utf8') as string;
            for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
                if (new RegExp(`export const ${m}\\b`).test(src)) {
                    expect({ f, m, driven: CALLS.some((c) => c.file === f && c.method === m) }).toEqual({ f, m, driven: true });
                }
            }
        }
    });

    it.each(CALLS.filter((c) => c.write).map((c) => [`${c.method} ${c.file.replace('src/app/api/t/[tenantSlug]/', '')}`, c] as const))(
        'a VIEWER is refused %s with a 403 and an AUTHZ_DENIED row',
        async (_name, c) => {
            const before = await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } });
            const res = await call('VIEWER', c);
            expect(res.status).toBe(403);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } })).toBe(before + 1);
        },
    );

    it.each(
        CALLS.filter((c) => c.key.startsWith('work_items.') && !['work_items.delete'].includes(c.key)).map(
            (c) => [`${c.method} ${c.file.replace('src/app/api/t/[tenantSlug]/', '')}`, c] as const,
        ),
    )('a MEMBER is admitted to %s (never a 403)', async (_name, c) => {
        const res = await call('MEMBER', c);
        expect(res.status).not.toBe(403);
        expect(res.status).toBeLessThan(500);
    });

    it.each(CALLS.map((c) => [`${c.method} ${c.file.replace('src/app/api/t/[tenantSlug]/', '')}`, c] as const))(
        'a GUEST is refused %s with a 403 and an AUTHZ_DENIED row naming the key (decision 204)',
        async (_name, c) => {
            const before = await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entity: 'Permission', entityId: c.key } });
            const res = await call('GUEST', c);
            expect(res.status).toBe(403);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entity: 'Permission', entityId: c.key } })).toBe(before + 1);
        },
    );

    it('what a GUEST is refused exists: an OWNER reads the list, the timeline, the projects and the sub-item', async () => {
        const list = await call('OWNER', CALLS.find((c) => c.file.endsWith('work-items/route.ts') && c.method === 'GET')!);
        expect((list.body.items as unknown[]).length).toBeGreaterThan(0);
        const timeline = await call('OWNER', CALLS.find((c) => c.file.endsWith('timeline/route.ts'))!);
        expect((timeline.body.rows as unknown[]).length).toBeGreaterThan(0);
        const projects = await call('OWNER', CALLS.find((c) => c.file.endsWith('projects/route.ts') && c.method === 'GET')!);
        expect((projects.body as unknown as unknown[]).length).toBeGreaterThan(0);
        const sub = await call('OWNER', CALLS.find((c) => c.file.endsWith('sub-items/route.ts'))!);
        expect((sub.body.items as unknown[]).length).toBe(1);
    });

    it('PATCH without If-Match on a title is a 428; with a stale version a 409 carrying the current row; with the right one a 200', async () => {
        const patch: Call = { ...CALLS.find((c) => c.method === 'PATCH' && c.file.endsWith('[workItemId]/route.ts'))!, body: () => ({ title: 'renamed via api' }) };
        expect((await call('OWNER', patch)).status).toBe(428);
        const stale = await call('OWNER', patch, { 'if-match': '"1"' });
        expect(stale.status).toBe(409);
        const details = (stale.body.error as { details: { version: number; item: { id: string } } }).details;
        expect(details.item.id).toBe(ids.other);
        const ok = await call('OWNER', patch, { 'if-match': `"${details.version}"` });
        expect(ok.status).toBe(200);
        expect(ok.body).toMatchObject({ title: 'renamed via api', version: details.version + 1 });
        expect((await call('OWNER', patch, { 'if-match': 'banana' })).status).toBe(400);
    });

    it('a VIEWER saves, renames and deletes its own personal view through the API, and switching it to SHARED is an audited 403 (decision 60)', async () => {
        const viewsRoute = 'src/app/api/t/[tenantSlug]/views/route.ts';
        const viewRoute = 'src/app/api/t/[tenantSlug]/views/[viewId]/route.ts';
        const created = await call('VIEWER', {
            file: viewsRoute,
            method: 'POST',
            path: () => '/views',
            params: (i) => P(i),
            body: () => ({ name: 'Viewer view', config: { filters: {} } }),
            write: true,
            key: 'views.create',
        });
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({ name: 'Viewer view', visibility: 'PERSONAL', mine: true });
        const viewId = created.body.id as string;
        const one = (method: 'PATCH' | 'DELETE', body?: unknown): Call => ({
            file: viewRoute,
            method,
            path: () => `/views/${viewId}`,
            params: (i) => P(i, { viewId }),
            body: body === undefined ? undefined : () => body,
            write: true,
            key: 'views.edit',
        });
        expect(await call('VIEWER', one('PATCH', { name: 'Viewer view, renamed' }))).toMatchObject({ status: 200, body: { name: 'Viewer view, renamed', visibility: 'PERSONAL' } });
        const deniedBefore = await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entityId: viewId } });
        expect((await call('VIEWER', one('PATCH', { visibility: 'SHARED' }))).status).toBe(403);
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entityId: viewId } })).toBe(deniedBefore + 1);
        expect((await call('VIEWER', one('DELETE'))).status).toBe(200);
        const actions = (await prisma.auditLog.findMany({ where: { tenantId, entityId: viewId, userId: users.VIEWER! }, select: { action: true } })).map((r) => r.action);
        expect(actions).toEqual(expect.arrayContaining(['SAVED_VIEW_CREATED', 'SAVED_VIEW_UPDATED', 'SAVED_VIEW_DELETED']));
    });

    it('a VIEWER may watch an item themselves, but adding someone else is an audited 403', async () => {
        const self = await call('VIEWER', CALLS.find((c) => c.method === 'POST' && c.file.endsWith('watchers/route.ts'))!);
        expect(self.status).toBe(200);
        const other = await call('VIEWER', CALLS.find((c) => c.method === 'POST' && c.file.endsWith('watchers/[userId]/route.ts'))!);
        expect(other.status).toBe(403);
        const rows = await prisma.auditLog.findMany({ where: { tenantId, action: 'WORK_ITEM_WATCHER_ADDED' } });
        expect(rows.some((r) => (r.metadataJson as { self?: boolean } | null)?.self === true)).toBe(true);
    });

    describe('comments (owner decision, 2026-11-19): the author edits; the author or an admin deletes', () => {
        const commentCall = (method: 'PATCH' | 'DELETE', commentId: string): Call => ({
            file: `${W}/[workItemId]/comments/[commentId]/route.ts`,
            method,
            path: (i) => `/work-items/${i.item}/comments/${commentId}`,
            params: (i) => P(i, { workItemId: i.item, commentId }),
            body: method === 'PATCH' ? () => ({ body: 'rewritten' }) : undefined,
            write: true,
            key: 'work_items.comment',
        });
        const membersComment = async () => (await addComment(ctxFor('MEMBER'), ids.item, { body: 'the member wrote this' })).id;

        it('an admin edit of another person\'s comment is a 403 with an AUTHZ_DENIED row, and the words stand', async () => {
            const commentId = await membersComment();
            const before = await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entity: 'Comment', entityId: commentId } });
            const res = await call('OWNER', commentCall('PATCH', commentId));
            expect(res.status).toBe(403);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entity: 'Comment', entityId: commentId } })).toBe(before + 1);
            const row = await prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
            expect(row.editedAt).toBeNull();
        });

        it('an admin deleting someone else\'s comment is audited as moderation, naming the author', async () => {
            const commentId = await membersComment();
            const res = await call('OWNER', commentCall('DELETE', commentId));
            expect(res).toMatchObject({ status: 200, body: { deleted: true, basis: 'moderation' } });
            const audit = await prisma.auditLog.findFirst({ where: { tenantId, entityId: commentId, action: 'COMMENT_MODERATED' } });
            expect(audit?.metadataJson).toMatchObject({ basis: 'moderation', authorUserId: users.MEMBER });
            expect(audit?.userId).toBe(users.OWNER);
        });

        it('the author edits and deletes their own comment', async () => {
            const commentId = await membersComment();
            expect((await call('MEMBER', commentCall('PATCH', commentId))).status).toBe(200);
            expect((await prisma.comment.findUniqueOrThrow({ where: { id: commentId } })).editedAt).not.toBeNull();
            const del = await call('MEMBER', commentCall('DELETE', commentId));
            expect(del).toMatchObject({ status: 200, body: { basis: 'author' } });
            expect(await prisma.auditLog.count({ where: { tenantId, entityId: commentId, action: 'COMMENT_EDITED' } })).toBe(1);
            expect(await prisma.auditLog.count({ where: { tenantId, entityId: commentId, action: 'COMMENT_DELETED' } })).toBe(1);
        });

        it('a member who is not the author may not delete it (403, AUTHZ_DENIED)', async () => {
            const commentId = (await addComment(ctxFor('OWNER'), ids.item, { body: 'the owner wrote this' })).id;
            const res = await call('MEMBER', commentCall('DELETE', commentId));
            expect(res.status).toBe(403);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entity: 'Comment', entityId: commentId } })).toBe(1);
        });
    });

    it('the roster gives every member the active members, in the pickers\' shape and no more', async () => {
        const res = await call('VIEWER', CALLS.find((c) => c.file.endsWith('users/assignable/route.ts'))!);
        expect(res.status).toBe(200);
        const roster = res.body as unknown as Array<Record<string, unknown>>;
        expect(roster.map((m) => m.id).sort()).toEqual(Object.values(users).sort());
        for (const m of roster) expect(Object.keys(m).sort()).toEqual(['email', 'id', 'image', 'name']);
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
