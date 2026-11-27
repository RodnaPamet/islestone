/**
 * Drives the H2 permission matrix (`table.ts`) against a real Postgres
 * (owner decisions 175 and 176; `docs/porting/maps/H2.md`, part 3).
 *
 * One workspace per suite file holds every role: OWNER, ADMIN, MEMBER,
 * VIEWER, GUEST (written with the raw client: no writer assigns GUEST before
 * 8.4), a MEMBER carrying the custom role `member-no-edit` and a VIEWER
 * carrying `viewer-plus-comment`, both made and assigned through the
 * custom-role usecases, plus three plain members the rows act on (Ann, Rae,
 * Sam). The shared world (a team, projects, an item, its configuration) is
 * built once; a row that consumes its subject names a fixture, built fresh
 * for every cell.
 *
 * Every call goes through the real route handler and the real
 * `getTenantCtx`: only NextAuth's cookie decode (`auth()`) is replaced, by a
 * session for the caller (mocked in each suite file), so membership, the
 * custom role's grants, `requirePermission`, the usecases and row-level
 * security are all the product's own. The job queue is replaced by an
 * in-memory one (each suite file mocks it), so the matrix needs no Redis.
 *
 * Each cell asserts its status and its audit evidence: the request carries
 * an `x-request-id`, which `getTenantCtx` makes the context's request id, so
 * the `AUTHZ_DENIED` rows of exactly that request are read back.
 */
import { createHmac } from 'node:crypto';

import { NextRequest } from 'next/server';
import type { PrismaClient, Role } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createCustomRole, assignCustomRole } from '@/app-layer/usecases/custom-roles';
import { createCustomField, addCustomFieldOption } from '@/app-layer/usecases/custom-field';
import { createCycle } from '@/app-layer/usecases/cycle';
import { createGoal, deleteGoal } from '@/app-layer/usecases/goal';
import { createInitiative, deleteInitiative } from '@/app-layer/usecases/initiative';
import { blockSender } from '@/app-layer/usecases/intake-blocked-senders';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { declineIntakeRequest, sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createLabel } from '@/app-layer/usecases/label';
import { startMfaEnrollment, verifyMfaEnrollment } from '@/app-layer/usecases/mfa-enrollment';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject, deleteProject, setProjectArchived } from '@/app-layer/usecases/project';
import { saveProjectAsTemplate } from '@/app-layer/usecases/project-template';
import { archiveRecipientList, createRecipientList } from '@/app-layer/usecases/recipient-list';
import { setWorkItemRecurrence } from '@/app-layer/usecases/recurrence';
import { getWorkItemReview, sendWorkItemReview, setWorkItemReviewSteps } from '@/app-layer/usecases/review';
import { createSavedView } from '@/app-layer/usecases/saved-view';
import { createTeam, updateTeam } from '@/app-layer/usecases/team';
import { createInviteToken } from '@/app-layer/usecases/tenant-invites';
import { addTimeEntry, startTimer } from '@/app-layer/usecases/time-entry';
import { approveTimesheet, submitTimesheet } from '@/app-layer/usecases/timesheet';
import { setTimeOffDays } from '@/app-layer/usecases/time-off';
import { setMemberCapacity } from '@/app-layer/usecases/workload-capacity';
import { assignWorkItem, createWorkItem, deleteWorkItem } from '@/app-layer/usecases/work-item';
import { markWorkItemAnswer } from '@/app-layer/usecases/work-item-answer';
import { addComment, addWatcher, addWorkItemLabels, addWorkItemLink } from '@/app-layer/usecases/work-item-collab';
import { addWorkItemRelation } from '@/app-layer/usecases/work-item-relations';
import { createWorkItemTemplate } from '@/app-layer/usecases/work-item-template';
import { addQuestionType, listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkflowState } from '@/app-layer/usecases/workflow-state';
import { addTeamHolidays, addWorkspaceHolidays, setTeamWorkingCalendar } from '@/app-layer/usecases/working-calendar';
import { enqueue } from '@/app-layer/jobs/queue';
import { verifyAuditChain } from '@/lib/audit';
import { getPermissionsForRole } from '@/lib/permissions';
import { SetRecurrenceSchema } from '@/lib/schemas/recurrence';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { makeRequestContext } from '../../helpers/make-context';

import { MATRIX, MATRIX_ROLES, TENANT_API_ROOT, day, monday, nextWeekMonday, outcomeOf, pastWeek, type FixtureName, type MatrixRole, type MatrixRoot, type MatrixRow, type Subject } from './table';

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** The mocked `auth()` each suite file wires: it returns whatever the harness sets. */
export interface AuthMock {
    mockImplementation(fn: () => Promise<unknown>): unknown;
}

/** The membership role each matrix role holds (the custom roles sit on MEMBER and VIEWER). */
const MEMBERSHIP_ROLE: Record<MatrixRole, Role> = {
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    MEMBER: 'MEMBER',
    VIEWER: 'VIEWER',
    GUEST: 'GUEST',
    MEMBER_NO_EDIT: 'MEMBER',
    VIEWER_PLUS_COMMENT: 'VIEWER',
};
const HELPERS = ['ANN', 'RAE', 'SAM'] as const;

export interface World {
    tenantId: string;
    slug: string;
    users: Record<MatrixRole | (typeof HELPERS)[number], string>;
    subject: Record<string, string>;
}

let seq = 0;
const nextSeq = () => String(++seq);

/** The route's URL path and its parameters, from the row and the subject. */
export function requestTarget(row: MatrixRow, s: Subject, slug: string): { path: string; params: Record<string, string> } {
    const overrides = row.params?.(s) ?? {};
    const params: Record<string, string> = { tenantSlug: slug };
    const dir = row.route.replace(/\/?route\.ts$/, '');
    const path = dir
        .split('/')
        .filter((seg) => seg.length > 0)
        .map((seg) => {
            const m = /^\[(\w+)\]$/.exec(seg);
            if (!m) return seg;
            const name = m[1]!;
            const value = overrides[name] ?? s[name];
            if (value === undefined) throw new Error(`${row.method} ${row.route}: no value for [${name}] in the subject`);
            params[name] = value;
            return encodeURIComponent(value);
        })
        .join('/');
    return { path: `/api/t/${slug}/${path}`, params };
}

export function setUpMatrixWorld(tag: string): { world: () => World; prisma: () => PrismaClient } {
    let prisma: PrismaClient;
    const w = {} as World;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        w.slug = tag;
        w.tenantId = (await createTenantWithDek({ name: tag, slug: tag })).id;
        w.users = {} as World['users'];
        for (const who of [...MATRIX_ROLES, ...HELPERS]) {
            const u = await prisma.user.create({ data: { email: `${who.toLowerCase()}-${tag}@example.test`, name: who } });
            const role: Role = (MATRIX_ROLES as readonly string[]).includes(who) ? MEMBERSHIP_ROLE[who as MatrixRole] : 'MEMBER';
            await prisma.tenantMembership.create({ data: { tenantId: w.tenantId, userId: u.id, role } });
            w.users[who] = u.id;
        }
        const owner = ctxAs(w, 'OWNER');

        // The two custom roles (decision 175), through the custom-role usecases.
        const memberGrants = getPermissionsForRole('MEMBER');
        memberGrants.work_items.edit = false;
        const viewerGrants = getPermissionsForRole('VIEWER');
        viewerGrants.work_items.comment = true;
        const narrow = await createCustomRole(owner, { name: 'member-no-edit', baseRole: 'MEMBER', grantsJson: memberGrants });
        const widen = await createCustomRole(owner, { name: 'viewer-plus-comment', baseRole: 'VIEWER', grantsJson: viewerGrants });
        for (const [who, roleId] of [['MEMBER_NO_EDIT', narrow.id], ['VIEWER_PLUS_COMMENT', widen.id]] as const) {
            const m = await prisma.tenantMembership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: w.tenantId, userId: w.users[who] } } });
            await assignCustomRole(owner, m.id, roleId);
        }

        const team = await createTeam(owner, { name: 'Matrix' });
        // The matrix team estimates in points (3.4a), so the estimate route answers a write.
        await updateTeam(owner, team.id, { estimateUnit: 'POINTS' });
        const project = await createProject(owner, { teamId: team.id, name: 'Matrix', keyPrefix: 'MTX' });
        const other = await createProject(owner, { teamId: team.id, name: 'Matrix other', keyPrefix: 'MTO' });
        const archived = await createProject(owner, { teamId: team.id, name: 'Matrix archived', keyPrefix: 'MTA' });
        const type = (await listWorkItemTypes(owner))[0]!;
        const item = await createWorkItem(owner, { projectId: project.id, typeId: type.id, title: 'the matrix zebra item' });
        await createWorkItem(owner, { projectId: project.id, typeId: type.id, title: 'a sub-item', parentId: item.id });
        const archivedItem = await createWorkItem(owner, { projectId: archived.id, typeId: type.id, title: 'in an archived project' });
        await setProjectArchived(owner, archived.id, true);
        const label = await createLabel(owner, { name: 'matrix label' });
        const field = await createCustomField(owner, project.id, { name: 'Stage gate', type: 'SELECT', options: [{ name: 'Alpha' }, { name: 'Beta' }] });
        const view = await createSavedView(ctxAs(w, 'ANN'), { name: 'Shared by Ann', visibility: 'SHARED', layout: 'LIST', config: { filters: {}, sort: 'manual', laneBy: 'none' } });
        const cycle = await createCycle(owner, { teamId: team.id, startsOn: '2049-01-04', endsOn: '2049-01-17' });
        const milestone = await createMilestone(owner, project.id, { name: 'Matrix milestone' });
        const itemTemplate = await createWorkItemTemplate(owner, project.id, { name: 'Matrix template', title: 'From a template' });
        const projectTemplate = await saveProjectAsTemplate(owner, { fromProjectId: project.id, name: 'Matrix project template' });
        const workspaceList = await createRecipientList(owner, null, { name: 'Matrix leads', userIds: [w.users.ANN] });
        const projectList = await createRecipientList(owner, project.id, { name: 'Matrix desk', userIds: [w.users.ANN, w.users.RAE] });
        await setProjectIntake(owner, project.id, { enabled: true, emailEnabled: true });
        await setProjectIntake(owner, other.id, { enabled: true });
        const form = await createIntakeForm(owner, { projectId: project.id, name: 'Matrix form', definition: { fields: [] }, published: true });
        const request = await sendIntakeRequest(ctxAs(w, 'ANN'), form.id, { title: 'seeded', answers: {} });
        const question = await addQuestionType(owner, { name: 'Matrix question' });
        const goal = await createGoal(owner, { title: 'Matrix goal' });
        const initiative = await createInitiative(owner, { name: 'Matrix initiative', goalId: goal.id });

        Object.assign(w, {
            subject: {
                tenantSlug: tag,
                workItemId: item.id,
                sharedItemId: item.id,
                key: item.key,
                searchTerm: 'zebra',
                archivedItemId: archivedItem.id,
                projectId: project.id,
                otherProjectId: other.id,
                archivedProjectId: archived.id,
                teamId: team.id,
                startedStateId: team.workflowStates.find((s) => s.category === 'STARTED')!.id,
                typeId: type.id,
                questionTypeId: question.id,
                labelId: label.id,
                fieldId: field.id,
                optionId: field.options[0]!.id,
                viewId: view.id,
                cycleId: cycle.id,
                milestoneId: milestone.id,
                goalId: goal.id,
                initiativeId: initiative.id,
                templateId: itemTemplate.id,
                projectTemplateId: projectTemplate.id,
                workspaceListId: workspaceList.id,
                projectListId: projectList.id,
                formId: form.id,
                requestId: request.id,
                annId: w.users.ANN,
                raeId: w.users.RAE,
                samId: w.users.SAM,
                viewerGrants: JSON.stringify(getPermissionsForRole('VIEWER')),
            },
        });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    return { world: () => w, prisma: () => prisma };
}

/** A fixture context for a person: their own id, a role that may do the setup (OWNER unless named). */
function ctxAs(w: World, who: MatrixRole | (typeof HELPERS)[number], role?: Role): RequestContext {
    const r: Role = role ?? ((MATRIX_ROLES as readonly string[]).includes(who) ? (who === 'MEMBER_NO_EDIT' ? 'MEMBER' : who === 'VIEWER_PLUS_COMMENT' ? 'VIEWER' : (who as Role)) : 'MEMBER');
    return makeRequestContext(r, { tenantId: w.tenantId, tenantSlug: w.slug, userId: w.users[who], requestId: `fixture-${nextSeq()}` });
}

async function freshItem(w: World, extra: Record<string, unknown> = {}): Promise<string> {
    const item = await createWorkItem(ctxAs(w, 'OWNER'), { projectId: w.subject.projectId!, typeId: w.subject.typeId!, title: `fresh ${nextSeq()}`, ...extra });
    return item.id;
}

async function openStep(w: World, itemId: string, memberIds: string[], sender: RequestContext): Promise<string> {
    const owner = ctxAs(w, 'OWNER');
    await setWorkItemReviewSteps(owner, itemId, { steps: [{ name: 'Check', mode: 'ALL', dueInWorkingDays: 2, memberIds, recipientListIds: [] }] });
    await sendWorkItemReview(sender, itemId);
    return (await getWorkItemReview(owner, itemId)).rounds[0]!.steps[0]!.id;
}

/** "Timesheets need approval" on for the matrix's workspace (3.4c). */
async function approvalOn(w: World, prisma: PrismaClient): Promise<void> {
    await prisma.tenantTimeSettings.upsert({ where: { tenantId: w.tenantId }, create: { tenantId: w.tenantId, approvalRequired: true }, update: { approvalRequired: true } });
}

/** Build a row's fresh subject for one caller. */
async function buildFixture(name: FixtureName, w: World, prisma: PrismaClient, caller: MatrixRole): Promise<Record<string, string>> {
    const owner = ctxAs(w, 'OWNER');
    const s = w.subject;
    const me = w.users[caller];
    const guest = caller === 'GUEST';
    switch (name) {
        case 'item':
            return { workItemId: await freshItem(w, { assigneeId: w.users.ANN }) };
        case 'itemWithDue':
            return { workItemId: await freshItem(w, { dueDate: '2051-06-01' }) };
        case 'itemWithRecurrence': {
            const id = await freshItem(w, { dueDate: '2051-06-01' });
            await setWorkItemRecurrence(owner, id, SetRecurrenceSchema.parse({ frequency: 'WEEKLY' }));
            return { workItemId: id };
        }
        case 'deletedItem': {
            const id = await freshItem(w);
            await deleteWorkItem(owner, id);
            return { workItemId: id };
        }
        case 'itemWithLink': {
            const id = await freshItem(w);
            const link = await addWorkItemLink(owner, id, { type: 'URL', location: 'https://example.com/fixture' });
            return { workItemId: id, linkId: link.id };
        }
        case 'itemWithRelation': {
            const id = await freshItem(w);
            const rel = await addWorkItemRelation(owner, id, { type: 'RELATES', toId: s.sharedItemId! });
            return { workItemId: id, relationId: (rel as { id: string }).id };
        }
        case 'itemWithLabel': {
            const id = await freshItem(w);
            await addWorkItemLabels(owner, id, [s.labelId!]);
            return { workItemId: id, labelId: s.labelId! };
        }
        case 'itemWatchedByAnn': {
            const id = await freshItem(w);
            await addWatcher(owner, id, w.users.ANN);
            return { workItemId: id, userId: w.users.ANN };
        }
        case 'ownTimeEntry': {
            // Written while the caller could record time (a MEMBER context with their id), on a day of its own.
            const entry = await addTimeEntry(ctxAs(w, caller, 'MEMBER'), { workItemId: s.sharedItemId!, workDate: day(Number(nextSeq())), minutes: 10 });
            return { timeEntryId: entry.id };
        }
        case 'othersTimeEntry': {
            const entry = await addTimeEntry(ctxAs(w, 'ANN'), { workItemId: s.sharedItemId!, workDate: day(Number(nextSeq())), minutes: 10 });
            return { timeEntryId: entry.id };
        }
        // Sub-phase 3.4c: approval on, and a fresh week long past, submitted (and approved) as the fixture says.
        case 'approvalOn': {
            await approvalOn(w, prisma);
            return {};
        }
        case 'annSubmittedTimesheet':
        case 'annApprovedTimesheet': {
            await approvalOn(w, prisma);
            const sheet = await submitTimesheet(ctxAs(w, 'ANN'), { week: pastWeek(Number(nextSeq())) });
            if (name === 'annApprovedTimesheet') await approveTimesheet(owner, sheet.timesheet!.id);
            return { timesheetId: sheet.timesheet!.id };
        }
        case 'ownSubmittedTimesheet': {
            await approvalOn(w, prisma);
            const sheet = await submitTimesheet(ctxAs(w, caller, 'MEMBER'), { week: pastWeek(Number(nextSeq())) });
            return { timesheetId: sheet.timesheet!.id };
        }
        // Sub-phase 3.4d: the workspace's currency set (a rate needs it), and a rate dated in the future (removable).
        case 'currencySet': {
            await prisma.tenantTimeSettings.upsert({ where: { tenantId: w.tenantId }, create: { tenantId: w.tenantId, currency: 'EUR' }, update: { currency: 'EUR' } });
            return {};
        }
        case 'futureRate': {
            const rate = await prisma.billableRate.create({
                data: { tenantId: w.tenantId, level: 'WORKSPACE', hourlyRateMinor: 12_000, effectiveFrom: new Date(Date.UTC(2099, 0, 1) + Number(nextSeq()) * 86_400_000), createdByUserId: w.users.OWNER },
            });
            return { rateId: rate.id };
        }
        case 'ownTimer': {
            await startTimer(ctxAs(w, caller, 'MEMBER'), { workItemId: s.sharedItemId!, timeZone: 'Europe/Sofia' });
            return {};
        }
        case 'ownTimeOff': {
            // Written while the caller could record time off (a MEMBER context with their id), on a date of its own.
            const timeOffDay = day(Number(nextSeq()));
            await setTimeOffDays(ctxAs(w, caller, 'MEMBER'), { days: [{ day: timeOffDay, minutes: null, type: 'SICK' }] });
            return { timeOffDay, timeOffUserId: me };
        }
        case 'annTimeOff': {
            const timeOffDay = day(Number(nextSeq()));
            await setTimeOffDays(ctxAs(w, 'ANN'), { days: [{ day: timeOffDay, minutes: 240, type: 'SICK' }] });
            return { timeOffDay, timeOffUserId: w.users.ANN };
        }
        case 'annOverWeek': {
            // An hours team's project where Ann holds 30h next week twice over (over her 40h) and Rae 1h.
            const k = nextSeq();
            const team = await createTeam(owner, { name: `Hours ${k}` });
            await updateTeam(owner, team.id, { estimateUnit: 'HOURS' });
            const p = await createProject(owner, { teamId: team.id, name: `Load ${k}`, keyPrefix: `WL${letterKey(Number(k))}` });
            const week = nextWeekMonday();
            const friday = new Date(Date.parse(`${week}T00:00:00Z`) + 4 * 86_400_000).toISOString().slice(0, 10);
            for (const [who, minutes] of [[w.users.ANN, 1800], [w.users.ANN, 1800], [w.users.RAE, 60]] as const) {
                await createWorkItem(owner, { projectId: p.id, typeId: s.typeId!, title: `load ${k}`, assigneeId: who, startDate: week, dueDate: friday, estimateMinutes: minutes });
            }
            return { annId: w.users.ANN };
        }
        case 'futureCapacity': {
            const row = await setMemberCapacity(owner, w.users.ANN, { effectiveFrom: monday(Number(nextSeq())), weeklyMinutes: 1200, calendarTeamId: null });
            return { userId: w.users.ANN, capacityId: row.id };
        }
        case 'ownComment': {
            // Written while the caller could comment (a MEMBER context with their id).
            const comment = await addComment(ctxAs(w, caller, 'MEMBER'), s.sharedItemId!, { body: `mine ${nextSeq()}` });
            return { workItemId: s.sharedItemId!, commentId: comment.id };
        }
        case 'othersComment': {
            const comment = await addComment(ctxAs(w, 'ANN'), s.sharedItemId!, { body: `Ann's ${nextSeq()}` });
            return { workItemId: s.sharedItemId!, commentId: comment.id };
        }
        case 'question':
        case 'answered': {
            const id = (await createWorkItem(owner, { projectId: s.projectId!, typeId: s.questionTypeId!, title: `question ${nextSeq()}`, dueDate: '2051-06-01', waitingOnUserId: w.users.ANN })).id;
            const comment = await addComment(ctxAs(w, 'ANN'), id, { body: 'the answer' });
            if (name === 'answered') await markWorkItemAnswer(owner, id, { commentId: comment.id });
            return { workItemId: id, commentId: comment.id };
        }
        case 'reviewPlanned': {
            const id = await freshItem(w, { assigneeId: w.users.ANN });
            await setWorkItemReviewSteps(owner, id, { steps: [{ name: 'Check', mode: 'ALL', dueInWorkingDays: 2, memberIds: [w.users.RAE], recipientListIds: [] }] });
            return { workItemId: id };
        }
        case 'reviewOpen': {
            const id = await freshItem(w, { assigneeId: w.users.ANN });
            return { workItemId: id, stepId: await openStep(w, id, [w.users.RAE], owner), userId: w.users.RAE };
        }
        case 'reviewOpenNamingCaller': {
            const id = await freshItem(w, { assigneeId: w.users.ANN });
            // A GUEST sees no project and cannot be named; its step names Rae alone.
            return { workItemId: id, stepId: await openStep(w, id, guest ? [w.users.RAE] : [me, w.users.RAE], owner) };
        }
        case 'reviewCallerNamedThenAssigned': {
            const id = await freshItem(w, { assigneeId: w.users.ANN });
            const stepId = await openStep(w, id, guest ? [w.users.RAE] : [me, w.users.RAE], owner);
            if (!guest) await assignWorkItem(owner, id, { assigneeId: me });
            return { workItemId: id, stepId };
        }
        case 'reviewSentByCaller': {
            const id = await freshItem(w, { assigneeId: w.users.ANN });
            // Sent in the caller's name (a MEMBER context with their id): the sender has standing.
            return { workItemId: id, stepId: await openStep(w, id, [w.users.RAE], ctxAs(w, caller, 'MEMBER')), userId: w.users.RAE };
        }
        case 'reviewCallerIsAssignee': {
            const id = await freshItem(w, { assigneeId: guest ? w.users.ANN : me });
            return { workItemId: id, stepId: await openStep(w, id, [w.users.RAE], owner) };
        }
        case 'freshProject':
        case 'deletedProject': {
            const k = nextSeq();
            const p = await createProject(owner, { teamId: s.teamId!, name: `Fresh ${k}`, keyPrefix: `FP${letterKey(Number(k))}` });
            if (name === 'deletedProject') await deleteProject(owner, p.id);
            return { projectId: p.id };
        }
        case 'freshOption': {
            const f = await addCustomFieldOption(owner, s.projectId!, s.fieldId!, { name: `Opt ${nextSeq()}` });
            const opt = f.options.find((o) => o.name.startsWith('Opt '))!;
            return { optionId: opt.id };
        }
        case 'freshMilestone':
            return { milestoneId: (await createMilestone(owner, s.projectId!, { name: `M ${nextSeq()}` })).id };
        case 'freshGoal':
        case 'finishedGoal':
        case 'deletedGoal': {
            const g = await createGoal(owner, { title: `G ${nextSeq()}`, status: name === 'finishedGoal' ? 'COMPLETED' : 'PLANNED' });
            if (name === 'deletedGoal') await deleteGoal(owner, g.id);
            return { goalId: g.id };
        }
        case 'freshInitiative':
        case 'finishedInitiative':
        case 'deletedInitiative': {
            const i = await createInitiative(owner, { name: `I ${nextSeq()}`, status: name === 'finishedInitiative' ? 'CANCELLED' : 'PLANNED' });
            if (name === 'deletedInitiative') await deleteInitiative(owner, i.id);
            return { initiativeId: i.id };
        }
        case 'freshItemTemplate':
            return { templateId: (await createWorkItemTemplate(owner, s.projectId!, { name: `T ${nextSeq()}`, title: 'fresh' })).id };
        case 'freshProjectList':
        case 'archivedProjectList': {
            const list = await createRecipientList(owner, s.projectId!, { name: `PL ${nextSeq()}`, userIds: [] });
            if (name === 'archivedProjectList') await archiveRecipientList(owner, s.projectId!, list.id);
            return { listId: list.id };
        }
        case 'freshWorkspaceList':
        case 'archivedWorkspaceList': {
            const list = await createRecipientList(owner, null, { name: `WL ${nextSeq()}`, userIds: [] });
            if (name === 'archivedWorkspaceList') await archiveRecipientList(owner, null, list.id);
            return { listId: list.id };
        }
        case 'freshTeam':
            return { teamId: (await createTeam(owner, { name: `Team ${nextSeq()}` })).id };
        case 'teamWithCalendar':
        case 'teamHoliday': {
            const team = await createTeam(owner, { name: `Calendar team ${nextSeq()}` });
            await setTeamWorkingCalendar(owner, team.id, { timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4, 5] });
            if (name === 'teamWithCalendar') return { teamId: team.id };
            const added = await addTeamHolidays(owner, team.id, { holidays: [{ day: '2070-05-06', name: 'Team day' }] });
            return { teamId: team.id, holidayId: added.calendar.holidays.find((h) => h.day === '2070-05-06')!.id };
        }
        case 'workspaceHoliday': {
            const k = Number(nextSeq());
            const dayKey = new Date(Date.UTC(2080, 0, 1) + k * 86_400_000).toISOString().slice(0, 10);
            const added = await addWorkspaceHolidays(owner, { holidays: [{ day: dayKey, name: `Fixture day ${k}` }] });
            return { holidayId: added.calendar.holidays.find((h) => h.day === dayKey)!.id };
        }
        case 'freshState': {
            const st = await createWorkflowState(owner, s.teamId!, { name: `Spare ${nextSeq()}`, category: 'STARTED' });
            return { stateId: (st as { id: string }).id };
        }
        case 'freshLabel':
            return { labelId: (await createLabel(owner, { name: `L ${nextSeq()}` })).id };
        case 'freshCycle': {
            const k = Number(nextSeq());
            const start = new Date(Date.UTC(2060, 0, 1) + k * 2 * 86_400_000).toISOString().slice(0, 10);
            return { cycleId: (await createCycle(owner, { teamId: s.teamId!, startsOn: start, endsOn: start })).id };
        }
        case 'freshProjectTemplate':
            return { templateId: (await saveProjectAsTemplate(owner, { fromProjectId: s.projectId!, name: `PT ${nextSeq()}` })).id };
        case 'ownView': {
            const v = await createSavedView(ctxAs(w, caller, 'MEMBER'), { name: `Mine ${nextSeq()}`, visibility: 'PERSONAL', layout: 'LIST', config: { filters: {}, sort: 'manual', laneBy: 'none' } });
            return { viewId: v.id };
        }
        case 'freshSharedView': {
            const v = await createSavedView(ctxAs(w, 'ANN'), { name: `Ann's ${nextSeq()}`, visibility: 'SHARED', layout: 'LIST', config: { filters: {}, sort: 'manual', laneBy: 'none' } });
            return { viewId: v.id };
        }
        case 'freshRequest':
        case 'declinedRequest': {
            const r = await sendIntakeRequest(ctxAs(w, 'ANN'), s.formId!, { title: `fresh ${nextSeq()}`, answers: {} });
            if (name === 'freshRequest') return { requestId: r.id, version: String(r.version) };
            const d = await declineIntakeRequest(owner, r.id, { reason: 'OTHER' }, r.version);
            return { requestId: r.id, version: String((d as { version: number }).version) };
        }
        case 'freshBlocked':
            return { blockedId: (await blockSender(owner, { email: `blocked-${nextSeq()}@example.test`, projectId: null })).row.id };
        // Roadmap 3.3b: the workspace's switch on, both sign-in apps configured and a public origin (the
        // connect and the consent answer a provider URL built on them; nothing is fetched).
        case 'calendarSyncOn': {
            process.env.GOOGLE_CLIENT_ID ??= 'matrix-google-client';
            process.env.GOOGLE_CLIENT_SECRET ??= 'matrix-google-secret'; // pragma: allowlist secret
            process.env.MICROSOFT_CLIENT_ID ??= 'matrix-microsoft-client';
            process.env.MICROSOFT_CLIENT_SECRET ??= 'matrix-microsoft-secret'; // pragma: allowlist secret
            process.env.NEXT_PUBLIC_APP_URL ??= 'https://matrix.example.test';
            await prisma.tenantCalendarSettings.upsert({ where: { tenantId: w.tenantId }, create: { tenantId: w.tenantId, syncEnabled: true }, update: { syncEnabled: true } });
            return {};
        }
        // A connection the provider already refused (no token to hold), so a disconnect only tears it down.
        case 'ownCalendarConnection': {
            await prisma.calendarConnection.upsert({
                where: { tenantId_userId_provider: { tenantId: w.tenantId, userId: me, provider: 'GOOGLE' } },
                create: { tenantId: w.tenantId, userId: me, provider: 'GOOGLE', state: 'REVOKED', revokedReason: 'ACCESS_WITHDRAWN' },
                update: {},
            });
            return {};
        }
        // Sync on, and the caller's connection whose Islestone calendar was deleted at the provider (3.3c): "Recreate".
        case 'ownRemovedCalendar': {
            process.env.GOOGLE_CLIENT_ID ??= 'matrix-google-client';
            process.env.GOOGLE_CLIENT_SECRET ??= 'matrix-google-secret'; // pragma: allowlist secret
            process.env.NEXT_PUBLIC_APP_URL ??= 'https://matrix.example.test';
            await prisma.tenantCalendarSettings.upsert({ where: { tenantId: w.tenantId }, create: { tenantId: w.tenantId, syncEnabled: true }, update: { syncEnabled: true } });
            await prisma.calendarConnection.upsert({
                where: { tenantId_userId_provider: { tenantId: w.tenantId, userId: me, provider: 'GOOGLE' } },
                create: { tenantId: w.tenantId, userId: me, provider: 'GOOGLE', state: 'CALENDAR_REMOVED', tokenEncrypted: 'matrix-token-never-read' },
                update: { state: 'CALENDAR_REMOVED', revokedReason: null, tokenEncrypted: 'matrix-token-never-read', externalCalendarId: null },
            });
            return {};
        }
        case 'ownNotification': {
            const row = await prisma.notification.create({ data: { tenantId: w.tenantId, userId: me, title: 'Matrix', body: 'for you' } });
            return { id: row.id };
        }
        case 'othersNotification': {
            const row = await prisma.notification.create({ data: { tenantId: w.tenantId, userId: w.users.ANN, title: 'Matrix', body: "for Ann" } });
            return { id: row.id };
        }
        case 'freshInvite':
            return { inviteId: (await createInviteToken(owner, { email: `fresh-${nextSeq()}@example.test`, role: 'MEMBER' })).invite.id };
        case 'freshMember': {
            const u = await prisma.user.create({ data: { email: `fresh-member-${nextSeq()}-${w.slug}@example.test` } });
            const m = await prisma.tenantMembership.create({ data: { tenantId: w.tenantId, userId: u.id, role: 'MEMBER' } });
            return { membershipId: m.id };
        }
        case 'freshCustomRole':
            return { roleId: (await createCustomRole(owner, { name: `Spare ${nextSeq()}`, baseRole: 'VIEWER', grantsJson: getPermissionsForRole('VIEWER') })).id };
        case 'memberSession': {
            const row = await prisma.userSession.create({
                data: { sessionId: `matrix-session-${nextSeq()}`, userId: w.users.ANN, tenantId: w.tenantId, expiresAt: new Date(Date.now() + 86_400_000) },
            });
            return { sessionId: row.sessionId };
        }
        case 'ownMfaEnrollment':
            await startMfaEnrollment(ctxAs(w, caller));
            return {};
        case 'ownVerifiedMfa': {
            const ctx = ctxAs(w, caller);
            const started = await startMfaEnrollment(ctx);
            await verifyMfaEnrollment(ctx, { code: totpNow(started.secret) });
            return {};
        }
        case 'freshForm': {
            const f = await createIntakeForm(owner, { projectId: s.projectId!, name: `Form ${nextSeq()}`, definition: { fields: [] } });
            return { formId: f.id, version: String(f.version) };
        }
        case 'annMfaEnrollment':
            await startMfaEnrollment(ctxAs(w, 'ANN'));
            return {};
        case 'keyRotationJob':
        case 'dekRotationJob': {
            const job = await enqueue(name === 'keyRotationJob' ? 'key-rotation' : 'tenant-dek-rotation', { tenantId: w.tenantId, initiatedByUserId: w.users.OWNER, requestId: `fixture-${nextSeq()}` });
            return { jobId: String(job.id) };
        }
    }
}

/** The current RFC 6238 code (30 s, 6 digits, SHA-1) for a base32 secret: what an authenticator app shows. */
function totpNow(secret: string): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
    const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
    const mac = createHmac('sha1', key).update(counter).digest();
    const off = mac[mac.length - 1]! & 0xf;
    const code = ((mac.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString();
    return code.padStart(6, '0');
}

function letterKey(n: number): string {
    let out = '';
    let v = n;
    do {
        out = String.fromCharCode(65 + (v % 26)) + out;
        v = Math.floor(v / 26);
    } while (v > 0);
    return out;
}

function sessionFor(w: World, role: MatrixRole) {
    return {
        user: {
            id: w.users[role],
            email: `${role.toLowerCase()}-${w.slug}@example.test`,
            name: role,
            image: null,
            role: MEMBERSHIP_ROLE[role],
            tenantId: w.tenantId,
            memberships: [{ slug: w.slug, role: MEMBERSHIP_ROLE[role], tenantId: w.tenantId }],
            orgMemberships: [],
            mfaPendingTenantIds: [],
        },
        expires: new Date(Date.now() + 3_600_000).toISOString(),
    };
}

export interface CallResult {
    status: number;
    text: string;
    reason: unknown;
    denials: { entity: string; entityId: string }[];
}

/** Call one row as one role, through the real handler; read back the request's AUTHZ_DENIED rows. */
export async function callAs(row: MatrixRow, role: MatrixRole, w: World, prisma: PrismaClient, auth: AuthMock): Promise<{ result: CallResult; subject: Subject }> {
    const fresh = row.fixture ? await buildFixture(row.fixture, w, prisma, role) : {};
    const subject: Subject = { ...w.subject, ...fresh, seq: nextSeq() };
    const { path, params } = requestTarget(row, subject, w.slug);
    const query = row.query?.(subject);
    const url = new URL(`http://localhost${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const requestId = `matrix-${w.slug}-${nextSeq()}`;
    const body = row.body?.(subject);
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-forwarded-for': `10.9.${Math.floor(seq / 250) % 250}.${seq % 250}`,
        'x-request-id': requestId,
        'sec-fetch-site': 'same-origin',
    };
    if (row.ifMatch) headers['if-match'] = `"${row.ifMatch(subject)}"`;
    const abort = new AbortController();
    const req = new NextRequest(url, { method: row.method, headers, signal: abort.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

    auth.mockImplementation(async () => sessionFor(w, role));
    const mod = (await import(`../../../${TENANT_API_ROOT}${row.route}`)) as Record<string, Handler>;
    const handler = mod[row.method];
    if (!handler) throw new Error(`${row.route} exports no ${row.method}`);
    const res = await handler(req, { params: Promise.resolve(params) });

    let text = '';
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
        // The notification stream: a 200 that stays open; close it.
        abort.abort();
        await res.body?.cancel().catch(() => undefined);
    } else {
        text = await res.text();
    }
    let reason: unknown;
    try {
        reason = (JSON.parse(text) as { error?: { details?: { reason?: unknown } } }).error?.details?.reason;
    } catch {
        reason = undefined;
    }
    const denials = await prisma.auditLog.findMany({ where: { tenantId: w.tenantId, requestId, action: 'AUTHZ_DENIED' }, select: { entity: true, entityId: true } });
    return { result: { status: res.status, text, reason, denials }, subject };
}

/** What a cell got, in the table's own words (a mismatch names both). */
export function judge(row: MatrixRow, role: MatrixRole, r: CallResult, s: Subject): string[] {
    const want = outcomeOf(row.expect[role]);
    const problems: string[] = [];
    const permissionRows = r.denials.filter((d) => d.entity === 'Permission');
    const otherRows = r.denials.filter((d) => d.entity !== 'Permission');
    const say = (m: string) => problems.push(`${m} (status ${r.status}${r.reason ? `, reason ${String(r.reason)}` : ''}; ${r.text.slice(0, 200)})`);
    const revealed = row.reveals ? r.text.includes(row.reveals(s)) : undefined;
    switch (want) {
        case 'ok':
            if (r.status < 200 || r.status > 299) say('expected 2xx');
            if (r.denials.length > 0) say('expected no AUTHZ_DENIED row');
            if (revealed === false) say('expected the response to carry the subject');
            break;
        case 'empty':
            if (r.status < 200 || r.status > 299) say('expected 2xx');
            if (revealed !== false) say('expected the response NOT to carry the subject');
            break;
        case 'denied':
            if (r.status !== 403) say('expected 403 from requirePermission');
            if (permissionRows.length !== 1 || permissionRows[0]!.entityId !== row.key) say(`expected one AUTHZ_DENIED row on Permission naming ${row.key}, got ${JSON.stringify(r.denials)}`);
            break;
        case 'refused':
            if (r.status !== 403) say('expected 403 from the usecase');
            if (permissionRows.length > 0) say('expected the route key to admit the caller (an AUTHZ_DENIED row on Permission was written)');
            if ((row.refusedAudit ?? true) ? otherRows.length !== 1 : otherRows.length !== 0) say(`expected ${(row.refusedAudit ?? true) ? 'one' : 'no'} AUTHZ_DENIED row from the usecase, got ${JSON.stringify(r.denials)}`);
            break;
        case 'hidden':
            if (r.status !== 404) say('expected 404');
            if (r.denials.length > 0) say('expected no AUTHZ_DENIED row');
            break;
        case 'archived':
            if (r.status !== 409 || r.reason !== 'PROJECT_ARCHIVED') say('expected 409 PROJECT_ARCHIVED');
            break;
    }
    return problems;
}

/**
 * The suite for one root: every row, every role, one test per cell, then the
 * audit chain. The caller (the suite file) mocks `@/auth` and the job queue.
 */
export function describeMatrix(root: MatrixRoot, tag: string, auth: AuthMock): void {
    const { world, prisma } = setUpMatrixWorld(tag);
    const cells = MATRIX[root].flatMap((row) => MATRIX_ROLES.map((role) => [`${row.method} ${row.route} | ${row.subject} | ${role}`, row, role] as const));

    it.each(cells)('%s', async (_name, row, role) => {
        const { result, subject } = await callAs(row, role, world(), prisma(), auth);
        expect({ cell: `${row.method} ${row.route} | ${row.subject} | ${role}: ${outcomeOf(row.expect[role])}`, problems: judge(row, role, result, subject) }).toEqual({
            cell: `${row.method} ${row.route} | ${row.subject} | ${role}: ${outcomeOf(row.expect[role])}`,
            problems: [],
        });
    });

    it("the workspace's audit chain verifies after every cell", async () => {
        expect((await verifyAuditChain(world().tenantId)).valid).toBe(true);
    });
}
