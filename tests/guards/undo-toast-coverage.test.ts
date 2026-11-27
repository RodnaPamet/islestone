/**
 * Destructive work-item writes go through the undo toast (sub-phase 2.3;
 * roadmap 2.3: "Destructive actions use the undo toast"):
 *
 *   1. In the work-item views (`src/components/work-items/**`), the
 *      Settings pages (`src/components/settings/**`, decision 55) and the
 *      cycle pages (`src/components/cycles/**`, 2.5a), the milestone pages
 *      (`src/components/milestones/**`, 2.5b), the recipient-list pages
 *      (`src/components/recipient-lists/**`, 2.7e) and the Roadmap pages
 *      (`src/components/goals/**`, 3.2b) and the Time pages
 *      (`src/components/time/**`, 3.4b), every
 *      DELETE request and every bulk delete is sent from inside a
 *      `triggerUndo(…)` or `removeWithUndo(…)` call, so nothing leaves the
 *      server until the undo window closes.
 *   2. The files that call `useToastWithUndo` are exactly `SITE_CONTRACTS`
 *      (the curated list, cross-walked with git both ways): a new caller is
 *      listed with what it removes, and a listed file that is gone fails.
 *
 * Population: Islestone's own tracked files (`gitFiles`); mirrored files
 * (`ui-mirror.json`) and the hook itself are out of scope. Comments are
 * masked (`codeOf`). Proven against a planted repository.
 *
 * Written for Islestone from inflect-compliance's
 * `tests/guards/epic-67-rollout-coverage.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (renamed for the invariant; the
 * population from git; the site list Islestone's).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

/** Each caller of `useToastWithUndo`, and what it removes through it. */
const SITE_CONTRACTS: Record<string, string> = {
    'src/components/work-items/data/use-work-item-mutations.ts': 'work item delete (detail, sheet, board card), the list bulk delete and clearing an answer (2.4b-c)',
    'src/components/work-items/data/use-work-item-collab.ts': 'comment delete, watcher, label, relation and link removal',
    'src/components/settings/use-undo-delete.ts': 'Settings: team, workflow state and label delete (decision 55), a working calendar\'s holiday and a team\'s own calendar (3.1a)',
    'src/components/work-items/data/use-saved-views.ts': 'saved view delete (the views menu, 2.4)',
    'src/components/work-items/data/use-custom-fields.ts': 'custom-field option delete (the field manager, 2.4)',
    'src/components/cycles/use-cycles.ts': 'upcoming cycle delete (the Cycles page and a cycle\'s page, 2.5a)',
    'src/components/work-items/data/use-recurrence.ts': 'stopping a repeat (the detail\'s Repeat control, 2.5d)',
    'src/components/work-items/data/use-item-templates.ts': 'item template delete (the project page\'s templates manager, 2.5c)',
    'src/components/milestones/use-milestones.ts': 'milestone delete (a project\'s milestones and a milestone\'s page, 2.5b)',
    'src/components/inbox/use-inbox.ts': 'marking a notification Done, and moving one back to the Inbox (the Inbox, 2.7c)',
    'src/components/recipient-lists/use-recipient-lists.ts': 'removing a person from a recipient list (Settings → Recipient lists and a project\'s lists, 2.7e)',
    'src/components/work-items/data/use-review.ts': 'removing a reviewer and removing a review step not yet opened (the detail\'s review section, 2.8b)',
    'src/components/settings/use-type-review-steps.ts': 'removing a default review step of a type (Settings → a type → Review steps, 2.8c)',
    'src/components/goals/use-goals.ts': 'goal and initiative delete, and taking a project off an initiative (the Goals and Initiatives pages and their pages, 3.2b)',
    'src/components/calendar-sync/use-calendar-sync.ts': "disconnecting a member's own calendar and withdrawing Microsoft 365's consent, both removing synced events (the member's Calendar sync section and Settings → Calendar sync, 3.3b)",
    'src/components/time/data/use-time.ts': "deleting one's own time entry and discarding a running timer (My time and an item's Time panel, 3.4b, decision 277)",
    'src/components/workload/data/use-time-off.ts': "removing dates of time off, one's own or (workload.manage) anyone's (the Workload page and Settings → Workload, 3.5a, decision 289)",
    'src/components/workload/data/use-workload.ts': 'removing a future capacity change (Settings → Workload, 3.5a, decision 284)',
    'src/components/work-items/data/use-timeline-writes.ts': 'a change of dates with the items it pushes later, held before it is sent, and removing a dependency (the timeline, 3.1c, decision 194)',
};

const HOOK_FILE = 'src/components/ui/hooks/use-toast-with-undo.ts';
const UNDO_CALLEES = new Set(['triggerUndo', 'removeWithUndo']);
/** A DELETE through `apiSend`, or through the Settings pages' `send` wrapper, or a bulk delete. */
const DESTRUCTIVE = /(?:apiSend|(?<![\w.$])send)\s*(?:<[^>]*>)?\s*\(\s*'DELETE'|\/bulk\/delete|\/time-off\/days\/remove/g;
/** The folders whose deletes must leave through the undo toast. */
const UNDO_ROOTS = ['src/components/work-items/', 'src/components/settings/', 'src/components/cycles/', 'src/components/milestones/', 'src/components/recipient-lists/', 'src/components/goals/', 'src/components/calendar-sync/', 'src/components/time/', 'src/components/workload/'];

function ownSources(root: string): Array<{ rel: string; code: string }> {
    const mirrorFile = path.join(root, 'ui-mirror.json');
    const mirrored = fs.existsSync(mirrorFile)
        ? new Set(Object.keys((JSON.parse(fs.readFileSync(mirrorFile, 'utf8')) as { files?: object }).files ?? {}))
        : new Set<string>();
    return gitFiles(root)
        .filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel) && !mirrored.has(rel) && rel !== HOOK_FILE)
        .map((rel) => ({ rel, code: codeOf(fs.readFileSync(path.join(root, rel), 'utf8')) }));
}

/** The callee names of the calls enclosing `index`, innermost first. */
function enclosingCallees(code: string, index: number): string[] {
    const out: string[] = [];
    let depth = 0;
    for (let i = index - 1; i >= 0; i--) {
        const ch = code[i];
        if (ch === ')') depth++;
        else if (ch === '(') {
            if (depth > 0) depth--;
            else {
                const m = /([A-Za-z_$][\w$.]*)\s*(?:<[^()]*>)?\s*$/.exec(code.slice(Math.max(0, i - 80), i));
                if (m) out.push(m[1]!.split('.').pop()!);
            }
        }
    }
    return out;
}

export function unguardedDeletes(root: string): string[] {
    return ownSources(root)
        .filter(({ rel }) => UNDO_ROOTS.some((r) => rel.startsWith(r)))
        .flatMap(({ rel, code }) =>
            [...code.matchAll(DESTRUCTIVE)]
                .filter((m) => !enclosingCallees(code, m.index ?? 0).some((c) => UNDO_CALLEES.has(c)))
                .map(() => rel),
        );
}

export function undoCallers(root: string): string[] {
    return ownSources(root)
        .filter(({ code }) => /\buseToastWithUndo\s*\(/.test(code))
        .map(({ rel }) => rel)
        .sort();
}

describe('the undo toast, in this repository', () => {
    it('every work-item DELETE and bulk delete is sent from inside the undo toast', () => {
        expect(unguardedDeletes(REPO_ROOT)).toEqual([]);
    });

    it('the callers of useToastWithUndo are exactly the listed sites', () => {
        expect(undoCallers(REPO_ROOT)).toEqual(Object.keys(SITE_CONTRACTS).sort());
    });

    it('the population is not empty (the detector sees the real deletes)', () => {
        const deletes = ownSources(REPO_ROOT)
            .filter(({ rel }) => rel.startsWith('src/components/work-items/'))
            .reduce((n, { code }) => n + [...code.matchAll(DESTRUCTIVE)].length, 0);
        expect(deletes).toBeGreaterThanOrEqual(7);
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-undo-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            'src/components/work-items/ok.ts': [
                'const trigger = useToastWithUndo();',
                "triggerUndo({ message: m, action: () => apiSend('DELETE', url(x)) });",
                "removeWithUndo(path, f, m, () => apiSend<R>('DELETE', u));",
                "triggerUndo({ action: () => apiSend('POST', url('/work-items/bulk/delete'), b) });",
            ].join('\n'),
            'src/components/work-items/bare.ts': "export const del = () => apiSend('DELETE', url(x));\n",
            'src/components/work-items/bulk.ts': "void apiSend('POST', '/work-items/bulk/delete', body);\n",
            'src/components/work-items/prose.ts': "// apiSend('DELETE', x) in a comment\nexport const p = 1;\n",
            'src/components/settings/bare.ts': "export const del = () => send('DELETE', '/teams/t1');\n",
            'src/components/settings/ok.ts': "triggerUndo({ message: m, action: () => send('DELETE', path) });\n",
            'src/components/other/elsewhere.tsx': "const t = useToastWithUndo();\napiSend('DELETE', u);\n",
        };
        for (const [rel, content] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds the deletes sent outside the undo toast, not the guarded ones or prose', () => {
        expect(unguardedDeletes(root).sort()).toEqual([
            'src/components/settings/bare.ts',
            'src/components/work-items/bare.ts',
            'src/components/work-items/bulk.ts',
        ]);
    });

    it('lists every caller of the hook, so an unlisted one fails the cross-walk', () => {
        expect(undoCallers(root)).toEqual(['src/components/other/elsewhere.tsx', 'src/components/work-items/ok.ts']);
        expect(undoCallers(root)).not.toEqual(Object.keys(SITE_CONTRACTS).sort());
    });
});
