/**
 * Each work-item and work-configuration route pins the key it takes per
 * method: the literal `requirePermission('<key>', …)` in the route file
 * equals the spec below, and every route file under those roots is in the
 * spec (sub-phase 2.2; the H2 permission matrix's static half — the
 * behavioural half is tests/integration/work-items-api.test.ts).
 *
 * Copied in shape from inflect-compliance `tests/guards/tenant-crud-authz-coverage.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: the spec rows are Islestone's,
 * the population is read from git, and the detector is proved against a
 * planted repository with a route whose key drifted.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { codeOf } from '../helpers/source-blocks';
import { gitFiles } from '../helpers/git-files';

const ROOT = path.resolve(__dirname, '../..');
const T = 'src/app/api/t/[tenantSlug]';
const ROOTS = ['work-items', 'projects', 'teams', 'work-item-types', 'labels', 'views', 'cycles', 'project-templates', 'intake', 'search', 'recipient-lists', 'working-calendar', 'goals', 'initiatives', 'roadmap', 'time-entries', 'time-settings', 'timesheets', 'workload', 'workload-settings', 'members', 'time-off', 'billable-rates', 'time-totals'].map((r) => `${T}/${r}/`);

type Spec = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string>>;
const W = `${T}/work-items`;
const SPEC: Readonly<Record<string, Spec>> = {
    [`${W}/route.ts`]: { GET: 'work_items.view', POST: 'work_items.create' },
    [`${W}/deleted/route.ts`]: { GET: 'work_items.delete' },
    [`${W}/metrics/route.ts`]: { GET: 'work_items.view' },
    [`${W}/timeline/route.ts`]: { GET: 'work_items.view' },
    [`${W}/calendar/route.ts`]: { GET: 'work_items.view' },
    [`${W}/by-key/[key]/route.ts`]: { GET: 'work_items.view' },
    [`${W}/bulk/assign/route.ts`]: { POST: 'work_items.assign' },
    [`${W}/bulk/state/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/bulk/due/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/bulk/dates/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/bulk/delete/route.ts`]: { POST: 'work_items.delete' },
    [`${W}/[workItemId]/route.ts`]: { GET: 'work_items.view', PATCH: 'work_items.edit', DELETE: 'work_items.delete' },
    [`${W}/[workItemId]/state/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/[workItemId]/assign/route.ts`]: { POST: 'work_items.assign' },
    [`${W}/[workItemId]/restore/route.ts`]: { POST: 'work_items.delete' },
    [`${W}/[workItemId]/activity/route.ts`]: { GET: 'work_items.view' },
    [`${W}/[workItemId]/sub-items/route.ts`]: { GET: 'work_items.view' },
    [`${W}/[workItemId]/move/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/[workItemId]/comments/route.ts`]: { GET: 'work_items.view', POST: 'work_items.comment' },
    [`${W}/[workItemId]/comments/[commentId]/route.ts`]: { PATCH: 'work_items.comment', DELETE: 'work_items.comment' },
    [`${W}/[workItemId]/watchers/route.ts`]: { GET: 'work_items.view', POST: 'work_items.view', DELETE: 'work_items.view' },
    [`${W}/[workItemId]/watchers/[userId]/route.ts`]: { POST: 'work_items.edit', DELETE: 'work_items.edit' },
    [`${W}/[workItemId]/links/route.ts`]: { GET: 'work_items.view', POST: 'work_items.edit' },
    [`${W}/[workItemId]/links/[linkId]/route.ts`]: { DELETE: 'work_items.edit' },
    [`${W}/[workItemId]/relations/route.ts`]: { GET: 'work_items.view', POST: 'work_items.edit' },
    [`${W}/[workItemId]/relations/[relationId]/route.ts`]: { DELETE: 'work_items.edit' },
    [`${W}/[workItemId]/labels/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/[workItemId]/labels/[labelId]/route.ts`]: { DELETE: 'work_items.edit' },
    // Sub-phase 2.4.
    [`${W}/[workItemId]/custom-fields/[fieldId]/route.ts`]: { PUT: 'work_items.edit' },
    // Sub-phase 2.5a (owner decision 72).
    [`${W}/[workItemId]/cycle/route.ts`]: { PUT: 'work_items.edit' },
    [`${T}/cycles/route.ts`]: { GET: 'cycles.view', POST: 'cycles.manage' },
    [`${T}/cycles/[cycleId]/route.ts`]: { GET: 'cycles.view', PATCH: 'cycles.manage', DELETE: 'cycles.manage' },
    [`${T}/cycles/[cycleId]/burn-up/route.ts`]: { GET: 'cycles.view' },
    [`${T}/teams/[teamId]/cycle-schedule/route.ts`]: { GET: 'cycles.view', PUT: 'cycles.manage' },
    // Sub-phase 2.5b (owner decision 72: milestones under the project keys).
    [`${T}/projects/[projectId]/milestones/route.ts`]: { GET: 'projects.view', POST: 'projects.edit' },
    [`${T}/projects/[projectId]/milestones/[milestoneId]/route.ts`]: { PATCH: 'projects.edit', DELETE: 'projects.edit' },
    // Sub-phase 2.7e (owner decisions 139 and 140): workspace lists under
    // admin.manage, a project's under projects.edit, both read under
    // projects.view; a list onto an item's watchers is an item edit.
    [`${T}/recipient-lists/route.ts`]: { GET: 'projects.view', POST: 'admin.manage' },
    [`${T}/recipient-lists/[listId]/route.ts`]: { GET: 'projects.view', PATCH: 'admin.manage' },
    [`${T}/recipient-lists/[listId]/members/route.ts`]: { PUT: 'admin.manage', PATCH: 'admin.manage' },
    [`${T}/recipient-lists/[listId]/archive/route.ts`]: { POST: 'admin.manage' },
    [`${T}/recipient-lists/[listId]/restore/route.ts`]: { POST: 'admin.manage' },
    [`${T}/projects/[projectId]/recipient-lists/route.ts`]: { GET: 'projects.view', POST: 'projects.edit' },
    [`${T}/projects/[projectId]/recipient-lists/[listId]/route.ts`]: { GET: 'projects.view', PATCH: 'projects.edit' },
    [`${T}/projects/[projectId]/recipient-lists/[listId]/members/route.ts`]: { PUT: 'projects.edit', PATCH: 'projects.edit' },
    [`${T}/projects/[projectId]/recipient-lists/[listId]/archive/route.ts`]: { POST: 'projects.edit' },
    [`${T}/projects/[projectId]/recipient-lists/[listId]/restore/route.ts`]: { POST: 'projects.edit' },
    [`${W}/[workItemId]/watchers/recipient-list/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/[workItemId]/milestone/route.ts`]: { PUT: 'work_items.edit' },
    // Sub-phase 3.2a (owner decisions 211, 213 and 220).
    [`${W}/[workItemId]/goal/route.ts`]: { PUT: 'work_items.edit' },
    // Sub-phase 3.4a (owner decision 257: an estimate is an item field).
    [`${W}/[workItemId]/estimate/route.ts`]: { PUT: 'work_items.edit' },
    [`${W}/[workItemId]/ancestry/route.ts`]: { GET: 'work_items.view' },
    [`${T}/projects/[projectId]/initiative/route.ts`]: { PUT: 'projects.edit' },
    [`${T}/goals/route.ts`]: { GET: 'goals.view', POST: 'goals.manage' },
    [`${T}/goals/[goalId]/route.ts`]: { GET: 'goals.view', PATCH: 'goals.manage', DELETE: 'goals.manage' },
    [`${T}/goals/[goalId]/archive/route.ts`]: { POST: 'goals.manage' },
    [`${T}/goals/[goalId]/restore/route.ts`]: { POST: 'goals.manage' },
    [`${T}/goals/[goalId]/health/route.ts`]: { PUT: 'goals.manage' },
    [`${T}/roadmap/route.ts`]: { GET: 'goals.view' },
    // Sub-phase 3.4b (decisions 265 and 266).
    [`${T}/time-entries/route.ts`]: { GET: 'time.track', POST: 'time.track' },
    [`${T}/time-entries/[timeEntryId]/route.ts`]: { PATCH: 'time.track', DELETE: 'time.track' },
    [`${T}/time-entries/timer/route.ts`]: { GET: 'time.track', POST: 'time.track' },
    [`${T}/time-entries/timer/stop/route.ts`]: { POST: 'time.track' },
    // Sub-phase 3.4c: timesheets and the time tracking settings.
    [`${T}/time-settings/route.ts`]: { GET: 'time.view', PUT: 'admin.manage' },
    [`${T}/timesheets/route.ts`]: { GET: 'time.approve', POST: 'time.track' },
    [`${T}/timesheets/week/route.ts`]: { GET: 'time.track' },
    [`${T}/timesheets/[timesheetId]/route.ts`]: { GET: 'time.approve' },
    [`${T}/timesheets/[timesheetId]/withdraw/route.ts`]: { POST: 'time.track' },
    [`${T}/timesheets/[timesheetId]/approve/route.ts`]: { POST: 'time.approve' },
    [`${T}/timesheets/[timesheetId]/return/route.ts`]: { POST: 'time.approve' },
    [`${T}/timesheets/[timesheetId]/reopen/route.ts`]: { POST: 'time.approve' },
    // Sub-phase 3.5a (decisions 284 to 300).
    [`${T}/workload/route.ts`]: { GET: 'workload.view' },
    [`${T}/workload/members/route.ts`]: { GET: 'workload.manage' },
    [`${T}/workload/cell/route.ts`]: { GET: 'workload.view' },
    [`${T}/workload-settings/route.ts`]: { GET: 'workload.view', PUT: 'workload.manage' },
    [`${T}/members/[userId]/capacity/route.ts`]: { GET: 'workload.view', PUT: 'workload.manage' },
    [`${T}/members/[userId]/capacity/[capacityId]/route.ts`]: { DELETE: 'workload.manage' },
    [`${T}/time-off/route.ts`]: { GET: 'workload.view' },
    [`${T}/time-off/days/route.ts`]: { PUT: 'workload.time_off' },
    [`${T}/time-off/days/remove/route.ts`]: { POST: 'workload.time_off' },
    // Sub-phase 3.4d: rates, a project's billable default, Time totals and the export.
    [`${T}/billable-rates/route.ts`]: { GET: 'time.rates' },
    [`${T}/billable-rates/workspace/route.ts`]: { PUT: 'time.rates' },
    [`${T}/billable-rates/[rateId]/route.ts`]: { DELETE: 'time.rates' },
    [`${T}/projects/[projectId]/billable-rates/route.ts`]: { PUT: 'time.rates' },
    [`${T}/projects/[projectId]/billable-default/route.ts`]: { PUT: 'time.rates' },
    [`${T}/members/[userId]/billable-rates/route.ts`]: { PUT: 'time.rates' },
    [`${T}/time-totals/route.ts`]: { GET: 'time.view' },
    [`${T}/time-totals/export/route.ts`]: { GET: 'time.view' },
    [`${W}/[workItemId]/time/route.ts`]: { GET: 'work_items.view' },
    [`${T}/initiatives/route.ts`]: { GET: 'goals.view', POST: 'goals.manage' },
    [`${T}/initiatives/[initiativeId]/route.ts`]: { GET: 'goals.view', PATCH: 'goals.manage', DELETE: 'goals.manage' },
    [`${T}/initiatives/[initiativeId]/archive/route.ts`]: { POST: 'goals.manage' },
    [`${T}/initiatives/[initiativeId]/restore/route.ts`]: { POST: 'goals.manage' },
    [`${T}/initiatives/[initiativeId]/health/route.ts`]: { PUT: 'goals.manage' },
    // Sub-phase 2.4b (owner decision 104: waiting on under `work_items.edit`).
    [`${W}/[workItemId]/waiting-on/route.ts`]: { PUT: 'work_items.edit' },
    // Sub-phase 2.4b-c (owner decisions 113 to 116: the answer under `work_items.edit`, the Question type under `admin.manage`).
    [`${W}/[workItemId]/answer/route.ts`]: { PUT: 'work_items.edit', DELETE: 'work_items.edit' },
    // Sub-phase 2.8a (owner decisions 150, 158 and 160: no new domain; responding under the read key).
    [`${W}/[workItemId]/review/route.ts`]: { GET: 'work_items.view' },
    [`${W}/[workItemId]/review/steps/route.ts`]: { PUT: 'work_items.edit' },
    [`${W}/[workItemId]/review/send/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/[workItemId]/review/withdraw/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/[workItemId]/review/steps/[stepId]/respond/route.ts`]: { POST: 'work_items.view' },
    [`${W}/[workItemId]/review/steps/[stepId]/skip/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/[workItemId]/review/steps/[stepId]/reviewers/route.ts`]: { POST: 'work_items.edit' },
    [`${W}/[workItemId]/review/steps/[stepId]/reviewers/[userId]/route.ts`]: { DELETE: 'work_items.edit' },
    [`${T}/work-item-types/question-preset/route.ts`]: { POST: 'admin.manage' },
    // Sub-phase 2.5c (owner decisions 71 and 72).
    [`${T}/projects/[projectId]/work-item-templates/route.ts`]: { GET: 'projects.view', POST: 'projects.edit' },
    [`${T}/projects/[projectId]/work-item-templates/[templateId]/route.ts`]: { PATCH: 'projects.edit', DELETE: 'projects.edit' },
    [`${T}/project-templates/route.ts`]: { GET: 'projects.create', POST: 'admin.manage' },
    [`${T}/project-templates/[templateId]/route.ts`]: { PATCH: 'admin.manage', DELETE: 'admin.manage' },
    // Sub-phase 2.5d (owner decisions 70 and 72).
    [`${W}/[workItemId]/recurrence/route.ts`]: { GET: 'work_items.view', PUT: 'work_items.create', DELETE: 'work_items.edit' },
    [`${T}/projects/[projectId]/custom-fields/route.ts`]: { GET: 'projects.view', POST: 'projects.edit' },
    // Sub-phase 2.4b-b (decision 112): built-in rules under admin.manage, custom-field rules under projects.edit.
    [`${T}/work-item-types/[typeId]/fields/route.ts`]: { GET: 'projects.view', PUT: 'admin.manage' },
    [`${T}/work-item-types/[typeId]/review-steps/route.ts`]: { GET: 'projects.view', PUT: 'admin.manage' },
    // Roadmap 3.1a (decision 193): working calendars read under projects.view, written under admin.manage.
    [`${T}/working-calendar/route.ts`]: { GET: 'projects.view', PUT: 'admin.manage' },
    [`${T}/working-calendar/holidays/route.ts`]: { POST: 'admin.manage' },
    [`${T}/working-calendar/holidays/[holidayId]/route.ts`]: { DELETE: 'admin.manage' },
    [`${T}/teams/[teamId]/working-calendar/route.ts`]: { GET: 'projects.view', PUT: 'admin.manage', DELETE: 'admin.manage' },
    [`${T}/teams/[teamId]/working-calendar/holidays/route.ts`]: { POST: 'admin.manage' },
    [`${T}/teams/[teamId]/working-calendar/holidays/[holidayId]/route.ts`]: { DELETE: 'admin.manage' },
    [`${T}/projects/[projectId]/type-fields/route.ts`]: { GET: 'projects.view', PUT: 'projects.edit' },
    [`${T}/projects/[projectId]/custom-fields/[fieldId]/route.ts`]: { PATCH: 'projects.edit' },
    [`${T}/projects/[projectId]/custom-fields/[fieldId]/options/route.ts`]: { POST: 'projects.edit' },
    [`${T}/projects/[projectId]/custom-fields/[fieldId]/options/[optionId]/route.ts`]: { PATCH: 'projects.edit', DELETE: 'projects.edit' },
    [`${T}/views/route.ts`]: { GET: 'views.view', POST: 'views.create' },
    // Sub-phase 2.7b: workspace search, under the projects key (work items skipped without work_items.view).
    [`${T}/search/route.ts`]: { GET: 'projects.view' },
    [`${T}/views/[viewId]/route.ts`]: { GET: 'views.view', PATCH: 'views.edit', DELETE: 'views.edit' },
    [`${T}/projects/route.ts`]: { GET: 'projects.view', POST: 'projects.create' },
    [`${T}/projects/[projectId]/route.ts`]: { GET: 'projects.view', PATCH: 'projects.edit', DELETE: 'projects.archive' },
    [`${T}/projects/[projectId]/archive/route.ts`]: { POST: 'projects.archive' },
    [`${T}/projects/[projectId]/restore/route.ts`]: { POST: 'projects.archive' },
    [`${T}/teams/route.ts`]: { GET: 'projects.view', POST: 'admin.manage' },
    [`${T}/teams/[teamId]/route.ts`]: { GET: 'projects.view', PATCH: 'admin.manage', DELETE: 'admin.manage' },
    [`${T}/teams/[teamId]/workflow-states/route.ts`]: { GET: 'projects.view', POST: 'admin.manage' },
    [`${T}/teams/[teamId]/workflow-states/[stateId]/route.ts`]: { PATCH: 'admin.manage', DELETE: 'admin.manage' },
    [`${T}/work-item-types/route.ts`]: { GET: 'projects.view', POST: 'admin.manage' },
    [`${T}/work-item-types/[typeId]/route.ts`]: { PATCH: 'admin.manage' },
    [`${T}/labels/route.ts`]: { GET: 'projects.view', POST: 'admin.manage' },
    [`${T}/labels/[labelId]/route.ts`]: { PATCH: 'admin.manage', DELETE: 'admin.manage' },
    // Sub-phase 2.6a (owner decision 92).
    [`${T}/intake/requests/route.ts`]: { GET: 'intake.view' },
    [`${T}/intake/requests/count/route.ts`]: { GET: 'intake.view' },
    [`${T}/intake/requests/[requestId]/route.ts`]: { GET: 'intake.view', PATCH: 'intake.triage' },
    [`${T}/intake/requests/[requestId]/accept/route.ts`]: { POST: 'intake.triage' },
    [`${T}/intake/requests/[requestId]/decline/route.ts`]: { POST: 'intake.triage' },
    [`${T}/intake/requests/[requestId]/merge/route.ts`]: { POST: 'intake.triage' },
    [`${T}/intake/requests/[requestId]/snooze/route.ts`]: { POST: 'intake.triage' },
    [`${T}/intake/requests/[requestId]/move/route.ts`]: { POST: 'intake.triage' },
    [`${T}/intake/requests/[requestId]/reopen/route.ts`]: { POST: 'intake.triage' },
    [`${T}/intake/forms/route.ts`]: { GET: 'intake.view', POST: 'intake.manage' },
    [`${T}/intake/forms/[formId]/route.ts`]: { GET: 'intake.view', PATCH: 'intake.manage' },
    [`${T}/intake/forms/[formId]/requests/route.ts`]: { POST: 'projects.view' },
    [`${T}/intake/open-forms/route.ts`]: { GET: 'projects.view' },
    [`${T}/intake/projects/route.ts`]: { GET: 'intake.manage' },
    [`${T}/projects/[projectId]/intake/route.ts`]: { PUT: 'intake.manage' },
    // Sub-phase 2.6c: the email address and blocked senders (decision 92).
    [`${T}/projects/[projectId]/intake/email-address/route.ts`]: { POST: 'intake.manage' },
    [`${T}/intake/blocked-senders/route.ts`]: { GET: 'intake.manage', POST: 'intake.manage' },
    [`${T}/intake/blocked-senders/find/route.ts`]: { POST: 'intake.manage' },
    [`${T}/intake/blocked-senders/[blockedId]/route.ts`]: { DELETE: 'intake.manage' },
};

/** The key each exported method passes to requirePermission, from comment-masked code. */
export function keysByMethod(src: string): Spec {
    const code = codeOf(src);
    const out: Spec = {};
    const exports = [...code.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\s*=/g)];
    exports.forEach((m, i) => {
        const block = code.slice(m.index!, exports[i + 1]?.index ?? code.length);
        const key = /requirePermission\s*(?:<[^>]*>)?\s*\(\s*'([a-z_]+\.[a-z_]+)'/.exec(block)?.[1];
        out[m[1] as keyof Spec] = key ?? '(none)';
    });
    return out;
}

function scan(root: string, spec: Readonly<Record<string, Spec>>) {
    const files = gitFiles(root).filter((f) => ROOTS.some((r) => f.startsWith(r)) && f.endsWith('/route.ts'));
    const drift: string[] = [];
    for (const f of files) {
        const actual = keysByMethod(readFileSync(path.join(root, f), 'utf8'));
        const want = spec[f];
        if (!want) {
            drift.push(`${f}: not in the spec`);
            continue;
        }
        if (JSON.stringify(actual, Object.keys(actual).sort()) !== JSON.stringify(want, Object.keys(want).sort())) {
            drift.push(`${f}: ${JSON.stringify(actual)} != ${JSON.stringify(want)}`);
        }
    }
    const missing = Object.keys(spec).filter((f) => !files.includes(f));
    return { files, drift, missing };
}

describe('work routes pin their keys', () => {
    const result = scan(ROOT, SPEC);

    it('reads every work route from git', () => {
        expect(result.files.length).toBe(Object.keys(SPEC).length);
    });

    it('each route method takes exactly the key in the spec', () => {
        expect(result.drift).toEqual([]);
    });

    it('every spec row names a route that exists', () => {
        expect(result.missing).toEqual([]);
    });
});

describe('the detector, against a planted repository', () => {
    it('flags a key that drifted and a route missing from the spec', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'crud-authz-'));
        try {
            execFileSync('git', ['init', '-q'], { cwd: dir });
            const write = (rel: string, key: string) => {
                mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
                writeFileSync(
                    path.join(dir, rel),
                    `// requirePermission('work_items.delete') in a comment does not count\nexport const DELETE = withApiErrorHandling(requirePermission<{ tenantSlug: string }>('${key}', async () => null));\n`,
                );
            };
            write(`${W}/[workItemId]/route.ts`, 'work_items.edit');
            write(`${T}/labels/new/route.ts`, 'admin.manage');
            const planted = scan(dir, { [`${W}/[workItemId]/route.ts`]: { DELETE: 'work_items.delete' } });
            expect(planted.drift).toEqual([
                `${T}/labels/new/route.ts: not in the spec`,
                `${W}/[workItemId]/route.ts: {"DELETE":"work_items.edit"} != {"DELETE":"work_items.delete"}`,
            ]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
