/**
 * Calendar sync's egress and the shared sign-in apps (roadmap 3.3b;
 * docs/porting/maps/3.3.md, "Egress, CSP and the sub-processor register";
 * ADR 0011 §6; owner decision 236):
 *
 *   1. One module talks to the providers. Every calendar sync file
 *      (`src/app-layer/integrations/providers/calendar/`, the calendar
 *      usecases, `src/lib/calendar-sync/`, the two callback routes) calls no
 *      fetch of any name, except `provider-http.ts`, which calls `fetch(` once,
 *      after the fixed-origin check (`providerUrlAllowed`). So no calendar code
 *      reaches a host a provider or a person chose; a server-supplied link
 *      (3.3c's Graph nextLink) must go through `safeFetch` and its sink row.
 *   2. Islestone never calls Google's token revocation endpoint: with one app
 *      for sign-in and calendar, revoking a calendar token may withdraw the
 *      person's whole grant, sign-in included. No file under `src/` names it.
 *   3. The calendar OAuth flow stays outside the auth library's seam (ADR 0004
 *      A3): no calendar sync file imports `next-auth` or `@next-auth/*`.
 *
 * Population from git (`gitFiles`); comments masked (`codeOf`); proven against
 * a planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

const CALENDAR_PATHS = [
    /^src\/app-layer\/integrations\/providers\/calendar\//,
    /^src\/app-layer\/usecases\/calendar-/,
    /^src\/app-layer\/jobs\/calendar-/,
    /^src\/lib\/calendar-sync\//,
    /^src\/app\/api\/integrations\/calendar\//,
    /^src\/app\/api\/t\/\[tenantSlug\]\/calendar-sync\//,
];
const HTTP_MODULE = 'src/app-layer/integrations/providers/calendar/provider-http.ts';
const ANY_FETCH_CALL = /\w*fetch\s*\(/gi;
const URL_LITERAL = /https?:\/\/[^\s'"`]+/g;
const REVOKE_PATH = /^\/(?:o\/oauth2\/|oauth2\/v\d+\/)?revoke\/?$/;

/** A URL in the source that names Google's token revocation endpoint, parsed rather than matched as text. */
function namesGoogleRevoke(code: string): boolean {
    return (code.match(URL_LITERAL) ?? []).some((literal) => {
        let url: URL;
        try {
            url = new URL(literal);
        } catch {
            return false;
        }
        const host = url.hostname.toLowerCase();
        const google = host === 'accounts.google.com' || host === 'googleapis.com' || host.endsWith('.googleapis.com');
        return google && REVOKE_PATH.test(url.pathname);
    });
}
const NEXT_AUTH_IMPORT = /from\s+'(next-auth|@next-auth\/[^']+)(\/[^']*)?'|require\(\s*'next-auth/;

function sources(root: string) {
    return gitFiles(root)
        .filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel))
        .map((rel) => ({ rel, code: codeOf(fs.readFileSync(path.join(root, rel), 'utf8')) }));
}
const isCalendar = (rel: string) => CALENDAR_PATHS.some((re) => re.test(rel));

export function calendarFetchSinks(root: string): string[] {
    return sources(root)
        .filter(({ rel }) => isCalendar(rel))
        .flatMap(({ rel, code }) => {
            const found = code.match(ANY_FETCH_CALL) ?? [];
            if (rel === HTTP_MODULE) {
                // Exactly one plain `fetch(`, and only after the origin check.
                const plain = found.filter((c) => /^fetch\s*\(/.test(c));
                const ok = plain.length === 1 && found.length === 1 && code.indexOf('providerUrlAllowed(url)') > -1 && code.indexOf('providerUrlAllowed(url)') < code.indexOf('await fetch(');
                return ok ? [] : [rel];
            }
            return found.length > 0 ? [rel] : [];
        });
}

export function googleRevokeCallers(root: string): string[] {
    return sources(root).filter(({ code }) => namesGoogleRevoke(code)).map(({ rel }) => rel);
}

export function calendarNextAuthImports(root: string): string[] {
    return sources(root).filter(({ rel, code }) => isCalendar(rel) && NEXT_AUTH_IMPORT.test(code.replace(/import type[^;]+;/g, ''))).map(({ rel }) => rel);
}

describe('calendar sync egress, in this repository', () => {
    it('the population is real: the provider module and the calendar usecases are found', () => {
        const rels = sources(REPO_ROOT).map((s) => s.rel).filter(isCalendar);
        expect(rels).toEqual(expect.arrayContaining([HTTP_MODULE, 'src/app-layer/integrations/providers/calendar/token.ts', 'src/app-layer/usecases/calendar-sync-run.ts', 'src/app/api/integrations/calendar/callback/route.ts']));
    });

    it('only provider-http.ts calls fetch, once, after the fixed-origin check', () => {
        expect(calendarFetchSinks(REPO_ROOT)).toEqual([]);
    });

    it("nothing under src/ calls Google's token revocation endpoint (decision 236)", () => {
        expect(googleRevokeCallers(REPO_ROOT)).toEqual([]);
    });

    it('no calendar sync file imports the auth library (ADR 0004 A3)', () => {
        expect(calendarNextAuthImports(REPO_ROOT)).toEqual([]);
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-calendar-egress-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            [HTTP_MODULE]: "if (!providerUrlAllowed(url)) throw new Error('x');\nconst res = await fetch(url, init);\n",
            'src/app-layer/integrations/providers/calendar/stray.ts': 'export const r = await fetch(nextLink);\n',
            'src/app-layer/usecases/calendar-sync-run.ts': 'const r = await resilientFetch(u);\n',
            'src/lib/calendar-sync/fine.ts': "// fetch(x) in a comment\nimport type { Session } from 'next-auth';\nexport const a = 1;\n",
            'src/app/api/integrations/calendar/callback/route.ts': "import { getServerSession } from 'next-auth';\n",
            'src/lib/somewhere.ts': "await post('https://oauth2.googleapis.com/revoke?token=' + t);\n",
            'src/lib/legacy.ts': "const u = `https://accounts.google.com/o/oauth2/revoke?token=${t}`;\n",
            'src/lib/unrelated.ts': "const u = 'https://example.com/revoke'; const v = 'https://oauth2.googleapis.com/token';\n",
            'src/lib/elsewhere.ts': 'await fetch(u);\n',
        };
        for (const [rel, content] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('flags a calendar file with its own fetch of any name, never the provider module or a comment or a file outside calendar sync', () => {
        expect(calendarFetchSinks(root).sort()).toEqual(['src/app-layer/integrations/providers/calendar/stray.ts', 'src/app-layer/usecases/calendar-sync-run.ts']);
    });

    it('flags the revoke endpoint wherever it is named, and a value import of next-auth in a calendar file (not a type import)', () => {
        expect(googleRevokeCallers(root).sort()).toEqual(['src/lib/legacy.ts', 'src/lib/somewhere.ts']);
        expect(calendarNextAuthImports(root)).toEqual(['src/app/api/integrations/calendar/callback/route.ts']);
    });
});
