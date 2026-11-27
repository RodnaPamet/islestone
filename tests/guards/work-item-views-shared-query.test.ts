/**
 * The work-item views read one query and write through one cache
 * (sub-phase 2.3; roadmap 2.3: "All three read the same query"):
 *
 *   1. Nothing under `src/components/work-items/` or the work-item pages
 *      calls `fetch(` directly: reads go through the SWR hooks
 *      (`useWorkItemList`, `useWorkItem`, `useTenantSWR`), writes through
 *      `apiSend` (`src/lib/data/api-client.ts`), so every write can send
 *      `If-Match` and every refusal reaches the person.
 *   2. Only the data folder (`src/components/work-items/data/`) opens an SWR
 *      read of its own (`useSWR(`, `useSWRInfinite(`): a view that opened one
 *      would hold rows no mutation reaches.
 *   3. Every versioned write (PATCH of an item, and its state, assign and
 *      move routes; and, 2.8b, the review writes that name the round: the
 *      steps PUT, send, withdraw and skip) in the data folder passes
 *      `ifMatch`.
 *
 * Population: tracked files (`gitFiles`); comments masked (`codeOf`). Proven
 * against a planted repository. Written fresh for Islestone; it carries the
 * intent of inflect-compliance's `task-mutation-error-handling` and
 * `tenant-swr-relative-path` guards (5528464fc54a8681956f3b9ce23ca9c075f0420e).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

const VIEW_ROOTS = ['src/components/work-items/', 'src/components/time/', 'src/app/t/[tenantSlug]/(app)/time/', 'src/app/t/[tenantSlug]/(app)/work-items/', 'src/app/t/[tenantSlug]/(app)/projects/', 'src/app/t/[tenantSlug]/(app)/my-work/'];
const DATA_ROOT = 'src/components/work-items/data/';
/** The Time pages' data folder (3.4b): reads and writes of time entries and the timer. */
const TIME_DATA_ROOT = 'src/components/time/data/';

function viewSources(root: string) {
    return gitFiles(root)
        .filter((rel) => VIEW_ROOTS.some((r) => rel.startsWith(r)) && /\.tsx?$/.test(rel))
        .map((rel) => ({ rel, code: codeOf(fs.readFileSync(path.join(root, rel), 'utf8')) }));
}

export function rawFetches(root: string): string[] {
    return viewSources(root)
        .filter(({ code }) => /(?<![\w.$])fetch\s*\(/.test(code))
        .map(({ rel }) => rel);
}

export function strayReads(root: string): string[] {
    return viewSources(root)
        .filter(({ rel, code }) => !rel.startsWith(DATA_ROOT) && !rel.startsWith(TIME_DATA_ROOT) && /\buseSWR(?:Infinite)?\s*\(/.test(code))
        .map(({ rel }) => rel);
}

/** `apiSend(...)` calls to a versioned route that carry no `ifMatch`. */
export function unversionedWrites(root: string): string[] {
    const out: string[] = [];
    for (const { rel, code } of viewSources(root).filter((f) => f.rel.startsWith(DATA_ROOT) || f.rel.startsWith(TIME_DATA_ROOT))) {
        for (const m of code.matchAll(/apiSend\s*(?:<[^>]*>)?\s*\(/g)) {
            let depth = 1;
            let i = (m.index ?? 0) + m[0].length;
            const start = i;
            for (; i < code.length && depth > 0; i++) {
                if (code[i] === '(') depth++;
                else if (code[i] === ')') depth--;
            }
            const args = code.slice(start, i - 1);
            // The item itself (`/work-items/${id}`) by PATCH, or its state,
            // assign and move routes; a comment's PATCH is not versioned.
            const versioned = (/^\s*'PATCH'/.test(args) && /\/work-items\/\$\{[^}]+\}`/.test(args)) || /\/(state|assign|move)`/.test(args);
            // A review write that names the round (2.8b, `use-review.ts`'s `url(…)` paths under the item's review).
            const reviewVersioned = /['`]\/(send|withdraw)['`]/.test(args) || /\/skip`/.test(args) || (/^\s*'PUT'/.test(args) && /['`]\/steps['`]/.test(args));
            // A change of one's own time entry (3.4b) names its version.
            const timeVersioned = /^\s*'PATCH'/.test(args) && /\/time-entries\/\$\{/.test(args);
            // A timesheet's acts (3.4c) name the week's version.
            const timesheetVersioned = /\/timesheets\/\$\{[^}]+\}\/(withdraw|approve|return|reopen)`/.test(args);
            if ((versioned || reviewVersioned || timeVersioned || timesheetVersioned) && !/\bifMatch\b/.test(args)) out.push(rel);
            // A change of dates from the timeline (3.1c, decision 194) carries each item's version in its body.
            if (/\/work-items\/bulk\/dates['`]/.test(args) && !/\bversion\s*:/.test(args)) out.push(rel);
        }
    }
    return out;
}

describe('the work-item views, in this repository', () => {
    it('make no raw fetch', () => {
        expect(rawFetches(REPO_ROOT)).toEqual([]);
    });

    it('open no SWR read outside the data folder', () => {
        expect(strayReads(REPO_ROOT)).toEqual([]);
    });

    it('send If-Match on every versioned write', () => {
        expect(unversionedWrites(REPO_ROOT)).toEqual([]);
    });

    it('read a real population', () => {
        expect(viewSources(REPO_ROOT).length).toBeGreaterThan(15);
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-shared-query-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            'src/components/work-items/raw.tsx': "export async function f() { await fetch('/api/t/a/work-items'); }\n",
            'src/components/work-items/prose.tsx': '// fetch(x) and useSWR(k) in prose\nexport const p = 1;\n',
            'src/components/work-items/reads.tsx': "const r = useSWR('/x', f);\n",
            'src/components/work-items/data/hook.ts': [
                "const r = useSWRInfinite(k, f);",
                "apiSend('PATCH', url(`/work-items/${id}`), body, { ifMatch: v });",
                "apiSend<D>('POST', url(`/work-items/${id}/state`), b);",
                "apiSend('POST', url(`/work-items/${id}/restore`));",
                "apiSend('PATCH', url(`/work-items/${id}/comments/${c}`), b);",
            ].join('\n'),
            'src/components/work-items/data/review.ts': [
                "apiSend('PUT', url('/steps'), { steps }, { ifMatch: round?.version });",
                "apiSend('POST', url(`/steps/${s}/skip`), undefined, { ifMatch: v });",
                "apiSend('POST', url(`/steps/${s}/respond`), body);",
                "apiSend('POST', url('/withdraw'));",
            ].join('\n'),
            'src/components/work-items/data/dates.ts': "apiSend('POST', apiUrl('/work-items/bulk/dates'), { dragged: { id }, pushed: [] });\n",
            'src/components/work-items/data/dates-ok.ts': "apiSend('POST', apiUrl('/work-items/bulk/dates'), { dragged: { id, version: v }, pushed: [] });\n",
            'src/components/time/data/sheets.ts': [
                "apiSend('POST', apiUrl(`/timesheets/${id}/approve`), undefined);",
                "apiSend('POST', apiUrl(`/timesheets/${id}/return`), { explanation }, { ifMatch: v });",
            ].join('\n'),
            'src/app/t/[tenantSlug]/(app)/work-items/page.tsx': "const x = window.fetch('/y');\n",
        };
        for (const [rel, content] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds a raw fetch, not prose or a member call', () => {
        expect(rawFetches(root)).toEqual(['src/components/work-items/raw.tsx']);
    });

    it('finds an SWR read outside the data folder', () => {
        expect(strayReads(root)).toEqual(['src/components/work-items/reads.tsx']);
    });

    it('finds a versioned write without If-Match (a withdraw of the round among them, a change of dates without versions, an approval of a timesheet), not a restore or a response', () => {
        expect(unversionedWrites(root).sort()).toEqual([
            'src/components/time/data/sheets.ts',
            'src/components/work-items/data/dates.ts',
            'src/components/work-items/data/hook.ts',
            'src/components/work-items/data/review.ts',
        ]);
    });
});
