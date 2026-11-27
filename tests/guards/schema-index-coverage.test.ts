/**
 * Structural index-coverage guardrail — the four-layer framework.
 *
 * It reads the LIVE schema (via the structured parser in
 * `tests/helpers/prisma-schema-models.ts`), never a migration file, and two
 * of its layers derive their coverage from the schema itself, so every
 * current AND future tenant model / foreign key is checked with zero
 * maintenance.
 *
 *   Layer A — tenant-scoped models must be tenant-indexed.   [AUTO]
 *     Every model with a `tenantId` scalar field must have `tenantId` as the
 *     FIRST element of some `@@index` / `@@unique` / `@@id` (or carry it as a
 *     field-level `@id` / `@unique`). Postgres uses the leftmost prefix of a
 *     composite index, so a tenantId-leading index makes every per-tenant
 *     query efficient. (The roadmap preamble requires it of every tenant
 *     table.)
 *
 *   Layer B — foreign-key scalar fields must be indexed.     [AUTO]
 *     Every scalar FK column must LEAD some index/uniqueness construct — or,
 *     on a tenant model, be the second column of a `[tenantId, fk]`
 *     composite — so the reverse lookup is not a sequential scan. `tenantId`
 *     is skipped here — Layer A owns it.
 *
 *   Layer C — curated composite-index registry.            [CURATED]
 *     Multi-column indexes backing specific list filter + sort shapes, each
 *     asserted to exist EXACTLY. Empty in sub-phase 1.3.
 *
 *   Layer C-completeness — the forcing function.            [AUTO]
 *     Scans `src/app-layer` (population from git) for `.findMany(` calls,
 *     maps the accessor to a model, and asserts every tenant-scoped model
 *     that is `findMany`'d somewhere is in the Layer C registry OR in the
 *     "tenant-index is sufficient" map. A NEW list query on a model in
 *     neither map fails.
 *
 * Every exempt and registry map is EMPTY in 1.3; an entry needs a written
 * reason, and the "no stale entries" checks delete it when it stops applying.
 * The last block runs each layer on planted input.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import type { SchemaModel } from '../helpers/prisma-schema-models';
import { leadingIndexedFields, parseSchemaModels, parseSchemaModelsFrom } from '../helpers/prisma-schema-models';
import { codeOf } from '../helpers/source-blocks';

const MODELS = parseSchemaModels();

/** Tenant models that deliberately have no tenant-leading index. A missing index is a bug. */
const TENANT_INDEX_EXEMPT: Record<string, string> = {};

/** `Model.field` FKs that are genuinely not indexed, with the reason. */
const FK_INDEX_EXEMPT: Record<string, string> = {};

interface CompositeIndex {
    /** PascalCase model name. */
    model: string;
    /** Field list in declaration order — matches the @@index([...]) line. */
    fields: string[];
    /** The filter / sort path that justifies this index. */
    justification: string;
}

/**
 * Composite indexes backing real list filter/sort paths: ADR 0002 §13, one
 * named query each (sub-phases 2.1–2.2).
 */
const LIST_QUERY_INDEXES: readonly CompositeIndex[] = [
    { model: 'WorkItem', fields: ['tenantId', 'projectId', 'sortKey', 'id'], justification: 'Project list, manual order, keyset over (sortKey, id).' },
    { model: 'WorkItem', fields: ['tenantId', 'projectId', 'stateId', 'sortKey'], justification: 'Board columns by state.' },
    { model: 'WorkItem', fields: ['tenantId', 'teamId', 'stateCategory', 'sortKey'], justification: 'Team backlog across projects, by category.' },
    { model: 'WorkItem', fields: ['tenantId', 'assigneeId', 'stateCategory', 'dueDate'], justification: 'My Work: assigned and open, by due date.' },
    // Hardening H2a (decision 172): found by the plan checks on the 10k seed (docs/performance.md, "Findings").
    { model: 'WorkItem', fields: ['tenantId', 'sortKey', 'id'], justification: 'Work items page: the whole workspace in manual order, one page without reading every item (H2a).' },
    { model: 'WorkItem', fields: ['tenantId', 'assigneeId', 'sortKey', 'id'], justification: "My Work's Assigned to me, in manual order across projects (H2a)." },
    { model: 'WorkItem', fields: ['tenantId', 'dueDate', 'id'], justification: 'Work items page sorted by due date across projects (H2a; map part 1.4).' },
    { model: 'WorkItem', fields: ['tenantId', 'parentId', 'sortKey'], justification: 'Sub-items of an item, in order; the progress groupBy.' },
    { model: 'WorkItem', fields: ['tenantId', 'createdByUserId', 'createdAt'], justification: 'Created by me.' },
    { model: 'WorkItem', fields: ['tenantId', 'projectId', 'updatedAt', 'id'], justification: 'Recently changed, keyset over (updatedAt, id).' },
    { model: 'WorkItem', fields: ['tenantId', 'stateCategory', 'dueDate'], justification: 'The due-date reminder scan and the overdue filter.' },
    { model: 'WorkItem', fields: ['tenantId', 'deletionId'], justification: 'Restore: the rows deleted together.' },
    { model: 'Comment', fields: ['tenantId', 'workItemId', 'createdAt'], justification: "An item's comments, newest first (keyset)." },
    { model: 'WorkflowState', fields: ['tenantId', 'teamId', 'sortKey'], justification: "A team's workflow in order." },
    { model: 'WorkItemRelation', fields: ['tenantId', 'toId', 'type'], justification: 'Incoming relations ("blocked by").' },
    { model: 'WorkItemLabel', fields: ['tenantId', 'labelId', 'workItemId'], justification: 'Filter by label; the batched detach.' },
    { model: 'AuditLog', fields: ['tenantId', 'entityId', 'createdAt'], justification: "A work item's Activity, newest first (keyset)." },
    // Sub-phase 2.4: the list sorts (docs/pagination.md) and the field reads.
    { model: 'WorkItem', fields: ['tenantId', 'projectId', 'createdAt', 'id'], justification: 'Sort by created, keyset over (createdAt, id).' },
    { model: 'WorkItem', fields: ['tenantId', 'projectId', 'dueDate', 'id'], justification: 'Sort by due date (nulls last), keyset over (dueDate, id).' },
    { model: 'WorkItem', fields: ['tenantId', 'projectId', 'priorityRank', 'id'], justification: 'Sort by priority (urgent first), keyset over (priorityRank, id).' },
    { model: 'CustomField', fields: ['tenantId', 'projectId', 'sortKey'], justification: "A project's fields, in order." },
    { model: 'CustomFieldOption', fields: ['tenantId', 'fieldId', 'sortKey'], justification: "A select field's options, in order." },
    { model: 'CustomFieldValue', fields: ['tenantId', 'fieldId', 'numberValue'], justification: 'Filter and sort by a number field.' },
    { model: 'CustomFieldValue', fields: ['tenantId', 'fieldId', 'dateValue'], justification: 'Filter and sort by a date field.' },
    { model: 'CustomFieldValue', fields: ['tenantId', 'fieldId', 'textValue'], justification: 'Filter and sort by a text or URL field.' },
    { model: 'CustomFieldValue', fields: ['tenantId', 'fieldId', 'optionId'], justification: 'Filter by a select option; sort by a select.' },
    { model: 'CustomFieldValue', fields: ['tenantId', 'fieldId', 'userId'], justification: 'Filter by a person field.' },
    { model: 'CustomFieldValue', fields: ['tenantId', 'userId'], justification: "A leaving member's person values, a batch at a time." },
    { model: 'SavedView', fields: ['tenantId', 'createdByUserId', 'projectId'], justification: "A member's own views in a scope." },
    { model: 'SavedView', fields: ['tenantId', 'visibility', 'projectId'], justification: 'The shared views of a scope.' },
    // Sub-phase 2.5a: cycles and the transition record.
    { model: 'WorkItem', fields: ['tenantId', 'cycleId', 'stateCategory'], justification: 'A cycle\'s items, its counts and the rollover\'s open items.' },
    { model: 'Cycle', fields: ['tenantId', 'teamId', 'startsOn'], justification: "A team's cycles by date; the overlap check." },
    { model: 'Cycle', fields: ['tenantId', 'completedAt', 'endsOn'], justification: 'The rollover: open cycles that have ended.' },
    { model: 'WorkItemTransition', fields: ['tenantId', 'cycleId', 'workItemId'], justification: 'The burn-up: the items ever in a cycle.' },
    { model: 'WorkItemTransition', fields: ['tenantId', 'workItemId', 'at'], justification: "The burn-up: those items' transitions in time order." },
    // Sub-phase 2.5b: milestones.
    { model: 'WorkItem', fields: ['tenantId', 'milestoneId', 'stateCategory'], justification: "A milestone's items and its progress; the milestone filter." },
    { model: 'Milestone', fields: ['tenantId', 'projectId', 'sortKey'], justification: "A project's milestones, in order." },
    { model: 'WorkItemTemplate', fields: ['tenantId', 'projectId', 'sortKey'], justification: "A project's item templates, in order." },
    { model: 'ProjectTemplate', fields: ['tenantId', 'sortKey'], justification: "The workspace's project templates, in order." },
    // Sub-phase 2.6a: intake.
    { model: 'IntakeRequest', fields: ['tenantId', 'projectId', 'status', 'createdAt'], justification: "A project's Intake list by status, newest first." },
    { model: 'IntakeRequest', fields: ['tenantId', 'status', 'createdAt'], justification: 'The workspace Intake list by status, newest first.' },
    { model: 'IntakeRequest', fields: ['tenantId', 'status', 'snoozedUntil'], justification: 'The wake job: snoozed requests whose day has come.' },
    { model: 'IntakeRequest', fields: ['tenantId', 'status', 'decidedAt'], justification: 'The purge job: decided requests past retention.' },
    { model: 'IntakeRequest', fields: ['tenantId', 'mergedIntoRequestId'], justification: 'The requests merged into a request.' },
    { model: 'IntakeForm', fields: ['tenantId', 'projectId', 'archivedAt'], justification: "A project's live forms." },
    // Sub-phase 2.6c: inbound email.
    { model: 'IntakeFollowUp', fields: ['tenantId', 'requestId', 'createdAt'], justification: "A request's follow-ups, oldest first." },
    { model: 'IntakeBlockedSender', fields: ['tenantId', 'projectId', 'createdAt'], justification: "Settings: a project's (and the workspace's) blocked senders, newest first." },
    { model: 'IntakeInboundEmail', fields: ['tenantId', 'createdAt'], justification: 'The purge: settled deliveries past retention; the sweep of workspaces with deliveries.' },
    { model: 'WorkItemRecurrence', fields: ['tenantId', 'nextOccurrenceOn'], justification: 'The nightly job reads the running repeats due by a date, oldest first.' },
    // Sub-phase 3.2a: goals and initiatives.
    { model: 'Goal', fields: ['tenantId', 'deletedAt', 'archivedAt', 'status'], justification: 'The goals list and pickers: live (or the Deleted view), unarchived unless asked, by status.' },
    { model: 'Initiative', fields: ['tenantId', 'deletedAt', 'archivedAt', 'status'], justification: 'The initiatives list and pickers: live (or the Deleted view), unarchived unless asked, by status.' },
    { model: 'Goal', fields: ['tenantId', 'deletionId'], justification: 'A restore reads its delete group.' },
    { model: 'Initiative', fields: ['tenantId', 'deletionId'], justification: 'A restore reads its delete group.' },
    { model: 'WorkItem', fields: ['tenantId', 'goalId', 'stateCategory'], justification: "The goalId filter's direct path and a goal's direct items by category." },
    // Sub-phase 3.4b: time entries.
    { model: 'TimeEntry', fields: ['tenantId', 'userId', 'workDate'], justification: "A person's week (My time), a day's total and their running timer." },
    { model: 'TimeEntry', fields: ['tenantId', 'workItemId', 'workDate'], justification: "An item's time: its total and its entries, newest first." },
    // Sub-phase 3.4c.
    { model: 'Timesheet', fields: ['tenantId', 'status', 'weekStart'], justification: 'The weeks waiting for a decision, oldest first, and those decided in the last 12 weeks (the Timesheets page).' },
];

/** Tenant models whose list queries are fully served by Layers A + B, with the reason. */
const LIST_MODELS_TENANT_INDEX_SUFFICIENT: Record<string, string> = {
    // Sub-phase 3.4c. One row per workspace (its primary key is tenantId); the
    // Monday reminder's cross-workspace sweep reads the rows with approval on, bounded.
    TenantTimeSettings: 'One row per workspace (@id tenantId); the reminder sweep reads those with approval on, bounded and ordered by tenantId.',
    // Roadmap 3.3b. A member's own connections (at most two, by the unique
    // (tenantId, userId, provider)); a workspace's by state (@@index([tenantId, state])).
    CalendarConnection: "A member's connections by @@unique([tenantId, userId, provider]); a workspace's by @@index([tenantId, state]); the dispatcher's sweep, bounded, by the same.",
    // Roadmap 3.3b. One connection's synced events, at most SYNCED_EVENTS_TAKE.
    CalendarSyncedEvent: "One connection's synced events: @@index([tenantId, connectionId, state]), at most SYNCED_EVENTS_TAKE.",
    // Roadmap 3.1a. A workspace's calendars (the workspace's and one per team, at most CALENDARS_TAKE).
    WorkingCalendar: 'A workspace\'s calendars: @@index([tenantId, teamId]); holidays come in the select, by @@index([tenantId, calendarId, day]).',
    // Sub-phase 2.8a. An item's rounds (at most REVIEW_ROUNDS_TAKE) and the
    // open rounds of a page of items or one state; a person's pending reviewer
    // rows, an item's, and the due job's page.
    WorkItemReviewRound: "An item's rounds: @@unique([tenantId, workItemId, number]); open rounds: @@index([tenantId, status]).",
    WorkItemReviewer: "A person's pending rows: @@index([tenantId, userId, withdrawnAt]); an item's: @@index([tenantId, workItemId]); a step's: @@index([tenantId, stepId, roundId, workItemId]).",
    // Sub-phase 2.7e. A scope's lists (at most RECIPIENT_LISTS_TAKE), and the
    // people of a page of lists (at most RECIPIENT_LIST_MEMBERS_MAX each).
    RecipientList: "A scope's recipient lists: @@index([tenantId, projectId, archivedAt]).",
    RecipientListMember: "A page of lists' people: @@index([tenantId, listId]); a member's lists: @@index([tenantId, userId]).",
    // Sub-phase 2.7d. One source's people (at most MAX_MENTIONS_PER_TEXT
    // recorded per text), or a page of an item's comments' people.
    Mention: "One comment's or description's mentions, or a page of comments': @@index([tenantId, commentId]) and @@index([tenantId, workItemId]).",
    // Sub-phase 2.7c. A member's rows (at most one per notification type),
    // read under the primary key's [tenantId, userId, type] prefix.
    NotificationPreference: "A member's preferences, one per type, read under the key [tenantId, userId, type].",
    // Sub-phase 2.4b-b. A type's rules (at most ten built-in plus one per
    // custom field) read by [tenantId, typeId] or [tenantId, projectId, typeId].
    WorkItemTypeReviewStep: "A type's default review steps ([tenantId, typeId]): at most ten per type.",
    WorkItemTypeField: 'Field-set entries: by type ([tenantId, typeId]) or by project ([tenantId, projectId, typeId]); a few per type.',
    // Sub-phase 2.6a. Small per-project sets, filtered by tenantId and projectId.
    ProjectIntake: 'One row per project; read by a list of project ids under [tenantId, projectId].',
    IntakeNotifyMember: "A project's notify list, read under [tenantId, projectId].",
    // Sub-phase 1.4. Every list is a small per-workspace set read whole (or
    // capped), filtered by tenantId and at most a status or an equality.
    TenantMembership:
        'The members list (tenantId, status) and the custom-role carrier lookups (customRoleId): ' +
        '@@index([tenantId, status]) and @@index([customRoleId]) serve both; a workspace roster is small.',
    TenantInvite:
        'Pending invites per workspace, filtered by tenantId and acceptedAt/revokedAt/expiresAt: ' +
        '@@index([tenantId]) narrows to one workspace, whose invites are few.',
    TenantCustomRole:
        "A workspace's custom roles, filtered by tenantId and isActive: @@index([tenantId, isActive]).",
    // Sub-phases 2.1–2.2: small per-workspace sets read whole and capped.
    Team: 'A workspace\'s teams, by name, capped at 200: @@unique([tenantId, name]).',
    Project: 'A workspace\'s projects (optionally of one team), capped at 200: @@index([tenantId, teamId]).',
    WorkItemType: 'A workspace\'s types, capped at 200: @@unique([tenantId, name]) narrows to the workspace.',
    Label: 'A workspace\'s labels (and one team\'s), capped at 500: @@index([tenantId, teamId]).',
    WorkItemLink: "One item's links, capped at 50: @@index([tenantId, workItemId]).",
    WorkItemWatcher: "One item's watchers (or a page of items' for the fan-out): @@index([tenantId, workItemId]).",
    // Sub-phase 2.5a.
    CycleSchedule: 'At most one per team, read by team or the whole small set: @@index([tenantId, teamId]).',
    // Sub-phase 1.6.
    Notification:
        "The bell: one user's rows in one workspace, newest first, capped at 50: @@index([tenantId, userId, createdAt]).",
    NotificationOutbox:
        'The drain reads PENDING rows due now (@@index([status, sendAfter])), narrowed to one workspace ' +
        'by @@index([tenantId]) for the manual drain; capped by the pass limit.',
    // Sub-phase 1.5b.
    AuditOutbox:
        'The drain reads PENDING rows due now (@@index([status, nextAttemptAt])), oldest event first, ' +
        'narrowed to one workspace by @@index([tenantId, status]) for an operator re-run; capped by the ' +
        'pass limit, and the queue is empty but for lock contention.',
};

const isTenantModel = (m: SchemaModel) => m.scalarFieldNames.includes('tenantId');

/** Layer A: tenant models with no tenant-leading index, outside the exempt map. */
function tenantIndexGaps(models: readonly SchemaModel[], exempt: Record<string, string>): string[] {
    return models
        .filter(isTenantModel)
        .filter((m) => !(m.name in exempt))
        .filter((m) => !leadingIndexedFields(m).has('tenantId'))
        .map((m) => m.name);
}

/**
 * Is a foreign-key field adequately indexed? True if it LEADS some index /
 * uniqueness construct, or — on a tenant model — if a `[tenantId, fk, ...]`
 * composite exists: every repository query carries `tenantId`, so
 * `WHERE tenantId = ? AND fk = ?` is served by that composite's prefix.
 */
function fkAdequatelyIndexed(model: SchemaModel, fk: string): boolean {
    if (leadingIndexedFields(model).has(fk)) return true;
    if (isTenantModel(model)) {
        const inTenantComposite = (groups: string[][]) => groups.some((g) => g[0] === 'tenantId' && g[1] === fk);
        if (inTenantComposite(model.blockIndexes) || inTenantComposite(model.blockUniques)) return true;
    }
    return false;
}

/** Layer B: every `Model.field` FK that is not adequately indexed. */
function fkIndexViolations(models: readonly SchemaModel[]): string[] {
    const out: string[] = [];
    for (const model of models) {
        for (const group of model.relationFkFieldGroups) {
            const first = group[0];
            if (first === undefined || first === 'tenantId') continue; // Layer A owns tenantId.
            if (!fkAdequatelyIndexed(model, first)) out.push(`${model.name}.${first}`);
        }
    }
    return out;
}

/** Layer C-completeness: tenant models `findMany`'d under src/app-layer. */
function listQueryModels(root: string, models: readonly SchemaModel[]): string[] {
    const byName = new Map(models.map((m) => [m.name, m]));
    const found = new Set<string>();
    const re = /([A-Za-z_][A-Za-z0-9_]*)\.findMany\s*\(/g;
    for (const rel of gitFiles(root).filter((f) => f.startsWith('src/app-layer/') && f.endsWith('.ts'))) {
        const text = codeOf(fs.readFileSync(path.join(root, rel), 'utf8'));
        for (const m of text.matchAll(re)) {
            const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
            const model = byName.get(name);
            if (model && isTenantModel(model)) found.add(name);
        }
    }
    return [...found].sort();
}

function hasExactBlockIndex(model: SchemaModel, fields: readonly string[]): boolean {
    return model.blockIndexes.some((idx) => idx.length === fields.length && idx.every((f, i) => f === fields[i]));
}

describe('schema-index-coverage — parser sanity', () => {
    // If the parser silently broke, every layer below would pass vacuously.
    it('parses the tenancy models, their indexes and their relation FK groups', () => {
        const membership = MODELS.find((m) => m.name === 'TenantMembership');
        expect(MODELS.map((m) => m.name).sort()).toEqual([
            'Account', 'AuditLog', 'AuditOutbox', 'CalendarConnection', 'CalendarSyncedEvent', 'Comment', 'CustomField', 'CustomFieldOption', 'CustomFieldValue', 'Cycle', 'CycleSchedule', 'Goal', 'Initiative', 'IntakeBlockedSender', 'IntakeFollowUp', 'IntakeForm', 'IntakeInboundEmail', 'IntakeNotifyMember', 'IntakeRequest', 'Label', 'Mention', 'Milestone', 'Notification', 'NotificationOutbox', 'NotificationPreference', 'OrgAuditLog', 'OrgInvite', 'OrgMembership', 'Organization', 'PasswordResetToken', 'Project', 'ProjectIntake', 'ProjectKeyPrefix', 'ProjectKeySequence', 'ProjectTemplate', 'RecipientList', 'RecipientListMember', 'SavedView', 'SearchVector', 'Team', 'Tenant', 'TenantCalendarSettings', 'TenantCustomRole', 'TenantInvite', 'TenantMembership', 'TenantNotificationSettings', 'TenantSecuritySettings', 'TenantTimeSettings', 'TimeEntry', 'Timesheet', 'User', 'UserMfaEnrollment', 'UserSession', 'VerificationToken', 'WorkItem', 'WorkItemKeyAlias', 'WorkItemLabel', 'WorkItemLink', 'WorkItemRecurrence', 'WorkItemRelation', 'WorkItemReviewRound', 'WorkItemReviewStep', 'WorkItemReviewStepList', 'WorkItemReviewer', 'WorkItemTemplate', 'WorkItemTemplateLabel', 'WorkItemTransition', 'WorkItemType', 'WorkItemTypeField', 'WorkItemTypeReviewStep', 'WorkItemTypeReviewStepReviewer', 'WorkItemWatcher', 'WorkflowState', 'WorkingCalendar', 'WorkingCalendarHoliday',
        ]);
        expect(membership?.fieldIdName).toBe('id');
        expect(membership?.blockIndexes).toContainEqual(['tenantId', 'status']);
        expect(membership?.relationFkFieldGroups).toContainEqual(['tenantId']);
        expect(MODELS.reduce((n, m) => n + m.relationFkFieldGroups.length, 0)).toBeGreaterThan(0);
    });
});

describe('schema-index-coverage — Layer A: tenant-scoped models are tenant-indexed', () => {
    it('finds tenant-scoped models (parser sanity)', () => {
        expect(MODELS.filter(isTenantModel).length).toBeGreaterThan(0);
    });

    it('every tenant-scoped model has a tenantId-leading index', () => {
        // Fix: add  @@index([tenantId])  (or a composite that LEADS with
        // tenantId) to the model.
        expect(tenantIndexGaps(MODELS, TENANT_INDEX_EXEMPT)).toEqual([]);
    });
});

describe('schema-index-coverage — Layer B: foreign-key fields are leading-indexed', () => {
    const violations = fkIndexViolations(MODELS);

    it('every foreign-key field leads an index OR is in FK_INDEX_EXEMPT', () => {
        // Fix: add @@index([<fkField>]) — or a composite that LEADS with it.
        expect(violations.filter((k) => !(k in FK_INDEX_EXEMPT))).toEqual([]);
    });

    it('FK_INDEX_EXEMPT has no stale entries (every exemption still applies)', () => {
        expect(Object.keys(FK_INDEX_EXEMPT).filter((k) => !violations.includes(k))).toEqual([]);
    });
});

describe('schema-index-coverage — Layer C: curated composite-index registry', () => {
    it('every LIST_QUERY_INDEXES entry exists exactly in the schema', () => {
        const missing = LIST_QUERY_INDEXES.filter((idx) => {
            const model = MODELS.find((m) => m.name === idx.model);
            return !model || !hasExactBlockIndex(model, idx.fields);
        }).map((idx) => `${idx.model} @@index([${idx.fields.join(', ')}])`);
        expect(missing).toEqual([]);
    });
});

describe('schema-index-coverage — Layer C-completeness: every list-queried model is triaged', () => {
    const queried = listQueryModels(REPO_ROOT, MODELS);

    it('every list-queried tenant model is in LIST_QUERY_INDEXES or LIST_MODELS_TENANT_INDEX_SUFFICIENT', () => {
        const curated = new Set(LIST_QUERY_INDEXES.map((i) => i.model));
        expect(queried.filter((m) => !curated.has(m) && !(m in LIST_MODELS_TENANT_INDEX_SUFFICIENT))).toEqual([]);
    });

    it('LIST_MODELS_TENANT_INDEX_SUFFICIENT has no stale entries', () => {
        expect(Object.keys(LIST_MODELS_TENANT_INDEX_SUFFICIENT).filter((m) => !queried.includes(m))).toEqual([]);
    });
});

describe('schema-index-coverage — registry integrity', () => {
    it('every model named in any map resolves to a real model, and every reason is written', () => {
        const names = new Set(MODELS.map((m) => m.name));
        const referenced = [
            ...Object.keys(TENANT_INDEX_EXEMPT),
            ...Object.keys(FK_INDEX_EXEMPT).map((k) => k.split('.')[0]!),
            ...LIST_QUERY_INDEXES.map((i) => i.model),
            ...Object.keys(LIST_MODELS_TENANT_INDEX_SUFFICIENT),
        ];
        expect(referenced.filter((m) => !names.has(m))).toEqual([]);
        const reasons = [
            ...Object.values(TENANT_INDEX_EXEMPT),
            ...Object.values(FK_INDEX_EXEMPT),
            ...Object.values(LIST_MODELS_TENANT_INDEX_SUFFICIENT),
            ...LIST_QUERY_INDEXES.map((i) => i.justification),
        ];
        expect(reasons.filter((r) => r.trim().length <= 10)).toEqual([]);
    });
});

describe('the layers, against planted input', () => {
    const planted = parseSchemaModelsFrom(
        codeOf(
            [
                'model Project {',
                '  id       String @id',
                '  tenantId String',
                '  leadId   String',
                '  ownerId  String',
                '  lead     User   @relation("Lead", fields: [leadId], references: [id])',
                '  owner    User   @relation("Owner", fields: [ownerId], references: [id])',
                '  @@index([tenantId, leadId])',
                '}',
                'model Label {',
                '  id       String @id',
                '  tenantId String',
                '  @@index([id, tenantId])',
                '}',
                'model User {',
                '  id String @id',
                '}',
            ].join('\n'),
        ),
    );

    it('Layer A reports a tenant model whose index does not lead with tenantId', () => {
        expect(tenantIndexGaps(planted, {})).toEqual(['Label']);
        expect(tenantIndexGaps(planted, { Label: 'a written reason for the exemption' })).toEqual([]);
    });

    it('Layer B accepts an FK in a [tenantId, fk] composite and reports a bare one', () => {
        expect(fkIndexViolations(planted)).toEqual(['Project.ownerId']);
    });

    describe('Layer C-completeness, on a planted repository', () => {
        let root: string;

        beforeAll(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-index-coverage-'));
            execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
            const plant = (rel: string, content: string) => {
                fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
                fs.writeFileSync(path.join(root, rel), content);
            };
            plant('src/app-layer/repositories/ProjectRepository.ts', 'export const list = (db) => db.project.findMany({});\n');
            plant('src/app-layer/repositories/UserRepository.ts', 'export const list = (db) => db.user.findMany({});\n');
            plant('src/app-layer/repositories/Commented.ts', '// db.label.findMany( is only a comment\nexport {};\n');
            plant('src/lib/elsewhere.ts', 'export const x = (db) => db.label.findMany({});\n');
        });

        afterAll(() => {
            fs.rmSync(root, { recursive: true, force: true });
        });

        it('finds the tenant model queried under src/app-layer, and only it', () => {
            expect(listQueryModels(root, planted)).toEqual(['Project']);
        });
    });
});
