/**
 * Tenant-model isolation FORWARD-LOCK.
 *
 * `rls-coverage` and `rls-migration-policies` verify that every tenant-scoped
 * model carries the canonical RLS policy triple + FORCE — a STRUCTURAL proof
 * (shape). This guard adds the BEHAVIOURAL axis (conduct), which the roadmap
 * preamble requires of every tenant table: a two-tenant test. Every model with
 * a `tenantId` must be listed in ISOLATION_TESTED with a dedicated two-tenant
 * behavioural test that proves a tenant-B caller cannot read or change
 * tenant-A rows; the file must exist, name the model, and be gated on the live
 * database (`DB_AVAILABLE`).
 *
 * ISOLATION_BASELINE — inflect-compliance's list of models that pre-dated its
 * lock — is EMPTY, and is the point of a fresh start: a NEWLY-ADDED tenant
 * model appears in neither set, so CI fails until its two-tenant test exists.
 *
 * The last block runs the classifier on a planted schema.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { codeOf } from '../helpers/source-blocks';
import { parseSchemaModels, parseSchemaModelsFrom } from '../helpers/prisma-schema-models';

const ROOT = path.resolve(__dirname, '../..');

/** Models with a dedicated two-tenant BEHAVIOURAL isolation test. */
const ISOLATION_TESTED: Readonly<Record<string, string>> = {
    TenantMembership: 'tests/integration/tenant-membership-isolation.test.ts',
    UserSession: 'tests/integration/user-session-rls.test.ts',
    UserMfaEnrollment: 'tests/integration/auth-tables-isolation.test.ts',
    TenantSecuritySettings: 'tests/integration/auth-tables-isolation.test.ts',
    TenantInvite: 'tests/integration/auth-tables-isolation.test.ts',
    TenantCustomRole: 'tests/integration/auth-tables-isolation.test.ts',
    AuditLog: 'tests/integration/audit-tables-isolation.test.ts',
    AuditOutbox: 'tests/integration/audit-tables-isolation.test.ts',
    Notification: 'tests/integration/notification-tables-isolation.test.ts',
    NotificationOutbox: 'tests/integration/notification-tables-isolation.test.ts',
    TenantNotificationSettings: 'tests/integration/notification-tables-isolation.test.ts',
    NotificationPreference: 'tests/integration/notification-preferences.test.ts',
    RecipientList: 'tests/integration/recipient-lists.test.ts',
    RecipientListMember: 'tests/integration/recipient-lists.test.ts',
    Mention: 'tests/integration/mentions.test.ts',
    SearchVector: 'tests/integration/search-vectors.test.ts',
    // Sub-phase 2.8a.
    WorkItemReviewRound: 'tests/integration/reviews.test.ts',
    WorkItemReviewStep: 'tests/integration/reviews.test.ts',
    WorkItemReviewStepList: 'tests/integration/reviews.test.ts',
    WorkItemReviewer: 'tests/integration/reviews.test.ts',
    WorkItemTypeReviewStep: 'tests/integration/review-defaults.test.ts',
    WorkItemTypeReviewStepReviewer: 'tests/integration/review-defaults.test.ts',
    // Roadmap 3.1a.
    WorkingCalendar: 'tests/integration/working-calendars.test.ts',
    WorkingCalendarHoliday: 'tests/integration/working-calendars.test.ts',
    // Roadmap 3.3b: calendar sync's three tables.
    TenantCalendarSettings: 'tests/integration/calendar-sync-isolation.test.ts',
    CalendarConnection: 'tests/integration/calendar-sync-isolation.test.ts',
    CalendarSyncedEvent: 'tests/integration/calendar-sync-isolation.test.ts',
    // Sub-phase 3.2a.
    Goal: 'tests/integration/goals.test.ts',
    Initiative: 'tests/integration/goals.test.ts',
    // Sub-phases 2.1–2.2.
    Team: 'tests/integration/work-tables-isolation.test.ts',
    WorkflowState: 'tests/integration/work-tables-isolation.test.ts',
    Project: 'tests/integration/work-tables-isolation.test.ts',
    ProjectKeyPrefix: 'tests/integration/work-tables-isolation.test.ts',
    ProjectKeySequence: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemType: 'tests/integration/work-tables-isolation.test.ts',
    WorkItem: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemKeyAlias: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemRelation: 'tests/integration/work-tables-isolation.test.ts',
    Label: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemLabel: 'tests/integration/work-tables-isolation.test.ts',
    Comment: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemWatcher: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemLink: 'tests/integration/work-tables-isolation.test.ts',
    // Sub-phase 2.4.
    CustomField: 'tests/integration/work-tables-isolation.test.ts',
    CustomFieldOption: 'tests/integration/work-tables-isolation.test.ts',
    CustomFieldValue: 'tests/integration/work-tables-isolation.test.ts',
    SavedView: 'tests/integration/work-tables-isolation.test.ts',
    // Sub-phase 2.5a.
    CycleSchedule: 'tests/integration/work-tables-isolation.test.ts',
    Cycle: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemTransition: 'tests/integration/work-tables-isolation.test.ts',
    // Sub-phase 2.5b.
    Milestone: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemTemplate: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemTemplateLabel: 'tests/integration/work-tables-isolation.test.ts',
    ProjectTemplate: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemRecurrence: 'tests/integration/work-tables-isolation.test.ts',
    WorkItemTypeField: 'tests/integration/work-tables-isolation.test.ts',
    // Sub-phase 2.6a.
    ProjectIntake: 'tests/integration/intake-tables-isolation.test.ts',
    IntakeNotifyMember: 'tests/integration/intake-tables-isolation.test.ts',
    IntakeForm: 'tests/integration/intake-tables-isolation.test.ts',
    IntakeRequest: 'tests/integration/intake-tables-isolation.test.ts',
    // Sub-phase 2.6c.
    IntakeFollowUp: 'tests/integration/intake-tables-isolation.test.ts',
    IntakeBlockedSender: 'tests/integration/intake-tables-isolation.test.ts',
    IntakeInboundEmail: 'tests/integration/intake-tables-isolation.test.ts',
};

/** Models proven only structurally, pending a two-tenant test. Empty, and should stay so. */
const ISOLATION_BASELINE: readonly string[] = [];

function tenantModelsOf(models: ReturnType<typeof parseSchemaModels>): string[] {
    return models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name);
}

function unclassified(tenantModels: readonly string[], tested: Readonly<Record<string, string>>, baseline: readonly string[]) {
    const classified = new Set([...Object.keys(tested), ...baseline]);
    return tenantModels.filter((m) => !classified.has(m));
}

describe('Tenant-model isolation forward-lock', () => {
    const tenantModels = tenantModelsOf(parseSchemaModels());

    it('reads the schema, and it holds tenant models', () => {
        expect(tenantModels).toContain('TenantMembership');
    });

    it('every tenant-scoped model has a two-tenant test — new models fail here', () => {
        // Fix: write the model's two-tenant behavioural test and list it in
        // ISOLATION_TESTED.
        expect(unclassified(tenantModels, ISOLATION_TESTED, ISOLATION_BASELINE)).toEqual([]);
    });

    it('the baseline is empty, and no model is in both sets', () => {
        expect(ISOLATION_BASELINE).toEqual([]);
        expect(Object.keys(ISOLATION_TESTED).filter((m) => ISOLATION_BASELINE.includes(m))).toEqual([]);
    });

    it('every isolation-test file exists, names its model, and is gated on the live database', () => {
        const problems = Object.entries(ISOLATION_TESTED).flatMap(([model, rel]) => {
            const file = path.join(ROOT, rel);
            if (!fs.existsSync(file)) return [`${model}: ${rel} does not exist`];
            const code = codeOf(fs.readFileSync(file, 'utf8'));
            const out: string[] = [];
            if (!new RegExp(`\\b${model.charAt(0).toLowerCase()}${model.slice(1)}\\b`).test(code)) {
                out.push(`${model}: ${rel} never uses the model's delegate`);
            }
            if (!code.includes('DB_AVAILABLE')) out.push(`${model}: ${rel} is not gated on DB_AVAILABLE`);
            if (!code.includes('runInTenantContext')) out.push(`${model}: ${rel} never runs as a tenant (runInTenantContext)`);
            return out;
        });
        expect(problems).toEqual([]);
    });

    it('no stale classifications — every classified model still exists and is tenant-scoped', () => {
        const live = new Set(tenantModels);
        const stale = [...Object.keys(ISOLATION_TESTED), ...ISOLATION_BASELINE].filter((m) => !live.has(m));
        expect(stale).toEqual([]);
    });
});

describe('the classifier, against a planted schema', () => {
    const planted = codeOf(
        [
            'model Project {',
            '  id       String @id',
            '  tenantId String',
            '}',
            'model Label {',
            '  id       String @id',
            '  // tenantId String  (a comment, not a field)',
            '}',
            'model Comment {',
            '  id       String @id',
            '  tenantId String',
            '}',
        ].join('\n'),
    );

    it('finds the tenant models, and reports the one with no two-tenant test', () => {
        const models = tenantModelsOf(parseSchemaModelsFrom(planted));
        expect(models).toEqual(['Project', 'Comment']);
        expect(unclassified(models, { Project: 'tests/integration/project-isolation.test.ts' }, [])).toEqual(['Comment']);
        expect(unclassified(models, { Project: 'x' }, ['Comment'])).toEqual([]);
    });
});
