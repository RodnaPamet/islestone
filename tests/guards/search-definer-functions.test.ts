/**
 * The search functions are a named exception to row-level security, so each
 * one's definition is pinned (owner decision 245, issue #78; migration
 * `20261214120000_search_definer_functions`; docs/rls-tenant-isolation.md,
 * "The search functions: a named exception").
 *
 * A search function is SECURITY DEFINER and owned by `app_search_definer`,
 * which is BYPASSRLS: inside it no policy applies, so its body is the
 * isolation. With no database, from the migrations git lists, this guard holds:
 *
 *   1. The search functions are exactly the five of `SEARCH_DEFINER_FUNCTIONS`
 *      (`tests/helpers/search-definer.ts`), and every definition parses.
 *   2. Each one's latest body hashes to its pinned value, so a change to what a
 *      definer function reads is a reviewed diff here, and passes
 *      `definerProblems`: the workspace from `app.tenant_id` and never an
 *      argument, nothing returned without it, every table schema-qualified and
 *      tied to the workspace, `deletedAt` (the item's and a comment's), the
 *      archived filter and project visibility, the configuration, a hard cap,
 *      ids and ranks only, a fixed `search_path`, never LEAKPROOF.
 *   3. Each definition is followed in its migration by its owner
 *      (`app_search_definer`), EXECUTE revoked from PUBLIC and granted to
 *      `app_user`, and nothing else is granted on it.
 *   4. The owner role cannot log in, is not a superuser, inherits nothing and
 *      is granted nothing but schema usage and column SELECT; nobody is made a
 *      member of it; no migration marks anything LEAKPROOF.
 *   5. Under `src/`, each function is called from its one repository.
 *
 * `tests/integration/search-definer.test.ts` holds the same against the
 * catalogue. The detectors prove themselves against a planted repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import {
    SEARCH_DEFINER_FUNCTIONS,
    SEARCH_DEFINER_ROLE,
    bodySha256,
    definerProblems,
    definitionHeadersIn,
    definitionsIn,
    type SearchDefinerDefinition,
    type SearchDefinerSpec,
} from '../helpers/search-definer';

const MIGRATION = /^prisma\/migrations\/[^/]+\/migration\.sql$/;

interface Found {
    file: string;
    sql: string;
    def: SearchDefinerDefinition;
}

function migrations(root: string): Array<{ file: string; sql: string }> {
    return gitFiles(root)
        .filter((rel) => MIGRATION.test(rel))
        .map((file) => ({ file, sql: fs.readFileSync(path.join(root, file), 'utf8') }));
}

/** The latest definition of every search function, by name, and any header that did not parse. */
function latestDefinitions(root: string): { latest: Map<string, Found>; unparsed: string[] } {
    const latest = new Map<string, Found>();
    const unparsed: string[] = [];
    for (const { file, sql } of migrations(root)) {
        const defs = definitionsIn(sql);
        const headers = definitionHeadersIn(sql);
        if (headers.length !== defs.length) unparsed.push(file);
        for (const def of defs) latest.set(def.name, { file, sql, def });
    }
    return { latest, unparsed };
}

/** Escapes every regular-expression metacharacter, backslash included. */
function escapeRegExp(text: string): string {
    return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** Every problem with the search functions as the migrations define them. */
function definitionProblems(root: string, specs: readonly SearchDefinerSpec[]): string[] {
    const problems: string[] = [];
    const { latest, unparsed } = latestDefinitions(root);
    for (const file of unparsed) problems.push(`${file}: a search function definition does not parse`);
    const expected = specs.map((s) => s.name).sort();
    const found = [...latest.keys()].sort();
    if (JSON.stringify(found) !== JSON.stringify(expected)) problems.push(`search functions are ${found.join(', ')}, not ${expected.join(', ')}`);
    for (const spec of specs) {
        const hit = latest.get(spec.name);
        if (!hit) continue;
        for (const p of definerProblems(spec, hit.def)) problems.push(`${spec.name}: ${p}`);
        const hash = bodySha256(hit.def.body);
        if (hash !== spec.bodySha256) problems.push(`${spec.name}: body sha256 ${hash}, pinned ${spec.bodySha256}`);
        const sig = `${escapeRegExp(spec.name)}\\(${escapeRegExp(spec.argTypes)}\\)`;
        if (!new RegExp(`ALTER FUNCTION ${sig} OWNER TO ${SEARCH_DEFINER_ROLE};`).test(hit.sql)) problems.push(`${spec.name}: not owned by ${SEARCH_DEFINER_ROLE}`);
        if (!new RegExp(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`).test(hit.sql)) problems.push(`${spec.name}: EXECUTE not revoked from PUBLIC`);
        const grants = [...hit.sql.matchAll(new RegExp(`GRANT [^;]* ON FUNCTION ${spec.name}\\b[^;]*;`, 'g'))].map((m) => m[0]);
        if (JSON.stringify(grants) !== JSON.stringify([`GRANT EXECUTE ON FUNCTION ${spec.name}(${spec.argTypes}) TO app_user;`])) {
            problems.push(`${spec.name}: granted ${JSON.stringify(grants)}, not EXECUTE to app_user alone`);
        }
    }
    return problems;
}

/** Every problem with the owner role and LEAKPROOF across the migrations. */
function roleProblems(root: string): string[] {
    const problems: string[] = [];
    let altered = false;
    for (const { file, sql } of migrations(root)) {
        const code = sql.replace(/--[^\n]*/g, '');
        for (const m of code.matchAll(/\bLEAKPROOF\b/g)) {
            if (!/NOT\s+$/.test(code.slice(Math.max(0, m.index! - 8), m.index!))) problems.push(`${file}: marks something LEAKPROOF`);
        }
        for (const m of code.matchAll(new RegExp(`ALTER ROLE ${SEARCH_DEFINER_ROLE}\\b([^;]*);`, 'g'))) {
            altered = true;
            const attrs = m[1]!;
            for (const a of ['NOLOGIN', 'NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOINHERIT', 'NOREPLICATION', 'BYPASSRLS']) {
                if (!new RegExp(`\\b${a}\\b`).test(attrs)) problems.push(`${file}: ${SEARCH_DEFINER_ROLE} is not ${a}`);
            }
        }
        for (const m of code.matchAll(new RegExp(`GRANT ([^;]*?) TO ${SEARCH_DEFINER_ROLE}\\s*;`, 'g'))) {
            const what = m[1]!.replace(/\s+/g, ' ').trim();
            if (what !== 'USAGE ON SCHEMA public' && !/^SELECT \([^)]*\) ON "\w+"$/.test(what)) problems.push(`${file}: grants ${SEARCH_DEFINER_ROLE} ${what}`);
        }
        if (new RegExp(`GRANT ${SEARCH_DEFINER_ROLE} TO`).test(code)) problems.push(`${file}: makes a member of ${SEARCH_DEFINER_ROLE}`);
    }
    if (!altered) problems.push(`no migration sets ${SEARCH_DEFINER_ROLE}'s attributes`);
    return problems;
}

/** Files under src/ that call a search function other than its one repository. */
function strayCallers(root: string, specs: readonly SearchDefinerSpec[]): string[] {
    const out: string[] = [];
    for (const rel of gitFiles(root).filter((r) => r.startsWith('src/') && /\.tsx?$/.test(r))) {
        const src = fs.readFileSync(path.join(root, rel), 'utf8');
        for (const spec of specs) {
            if (rel !== spec.caller && new RegExp(`\\b${spec.name}\\s*\\(`).test(src)) out.push(`${rel}: ${spec.name}`);
        }
    }
    return out.sort();
}

describe('the search functions (decision 245)', () => {
    it('are the five pinned functions, each defined, owned, granted and isolating as pinned', () => {
        expect(definitionProblems(REPO_ROOT, SEARCH_DEFINER_FUNCTIONS)).toEqual([]);
    });

    it('are owned by a role that cannot log in, holds column SELECT only and has no members; nothing is LEAKPROOF', () => {
        expect(roleProblems(REPO_ROOT)).toEqual([]);
    });

    it('are each called from their one repository', () => {
        expect(strayCallers(REPO_ROOT, SEARCH_DEFINER_FUNCTIONS)).toEqual([]);
        // The population is real: each repository does call its function.
        for (const spec of SEARCH_DEFINER_FUNCTIONS) {
            expect(fs.readFileSync(path.join(REPO_ROOT, spec.caller), 'utf8')).toMatch(new RegExp(`\\b${spec.name}\\(`));
        }
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;
    const first = fs.readFileSync(path.join(REPO_ROOT, 'prisma/migrations/20261214120000_search_definer_functions/migration.sql'), 'utf8');
    // search_item_contents is defined again, bounded, by decision 250's migration.
    const real = fs.readFileSync(path.join(REPO_ROOT, 'prisma/migrations/20261217120000_search_recent_candidates/migration.sql'), 'utf8');
    const spec = SEARCH_DEFINER_FUNCTIONS.find((s) => s.name === 'search_item_contents')!;
    const realDef = definitionsIn(real).find((d) => d.name === spec.name)!;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-search-definer-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant('prisma/migrations/20261214120000_search_definer_functions/migration.sql', first);
        plant('prisma/migrations/20261217120000_search_recent_candidates/migration.sql', real);
        // A later migration that replaces one function's body with a weaker one and leaks the role.
        const weakened = real
            .slice(real.indexOf('CREATE FUNCTION search_item_contents'), real.indexOf('-- ─── 3) Ownership'))
            .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
            .replaceAll('w."deletedAt" IS NULL', 'TRUE');
        plant(
            'prisma/migrations/20261218000000_later/migration.sql',
            `${weakened}\nGRANT EXECUTE ON FUNCTION search_item_contents(text, boolean, text[], integer) TO PUBLIC;\nGRANT INSERT ON "WorkItem" TO ${SEARCH_DEFINER_ROLE};\nGRANT ${SEARCH_DEFINER_ROLE} TO app_user;\nALTER FUNCTION f() LEAKPROOF;\n`,
        );
        plant(spec.caller, 'search_item_contents(');
        plant('src/app-layer/usecases/sneaky.ts', 'await db.$queryRaw`SELECT * FROM search_item_contents(${q})`;\n');
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it("finds the weakened body, its changed hash and the grant to PUBLIC in the later migration", () => {
        const problems = definitionProblems(root, SEARCH_DEFINER_FUNCTIONS);
        expect(problems).toEqual(
            expect.arrayContaining([
                'search_item_contents: does not filter w."deletedAt" (the item)',
                expect.stringMatching(/^search_item_contents: body sha256 [0-9a-f]{64}, pinned /),
                'search_item_contents: not owned by app_search_definer',
                expect.stringMatching(/^search_item_contents: granted .*TO PUBLIC/),
            ]),
        );
    });

    it('finds a role grant beyond column SELECT, a member and a LEAKPROOF marking', () => {
        expect(roleProblems(root)).toEqual([
            `prisma/migrations/20261218000000_later/migration.sql: marks something LEAKPROOF`,
            `prisma/migrations/20261218000000_later/migration.sql: grants ${SEARCH_DEFINER_ROLE} INSERT ON "WorkItem"`,
            `prisma/migrations/20261218000000_later/migration.sql: makes a member of ${SEARCH_DEFINER_ROLE}`,
        ]);
    });

    it('finds a caller outside the repository', () => {
        expect(strayCallers(root, SEARCH_DEFINER_FUNCTIONS)).toEqual(['src/app-layer/usecases/sneaky.ts: search_item_contents']);
    });

    it.each([
        ['takes the workspace as an argument', (d: SearchDefinerDefinition) => ({ ...d, params: `p_tenant text, ${d.params}`, body: d.body.replace("NULLIF(current_setting('app.tenant_id', true), '')", 'p_tenant') })],
        ['compares a workspace with p_tenant', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace('s."tenantId" = v_tenant', 's."tenantId" = p_tenant') })],
        ['does not return nothing before its query when app.tenant_id is unset', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace(/IF v_tenant IS NULL THEN\s+RETURN;\s+END IF;/, '') })],
        ['does not filter c."deletedAt" (the comment)', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replaceAll('AND c."deletedAt" IS NULL', '') })],
        ['does not filter p."deletedAt" and "archivedAt" (the project)', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replaceAll('AND p."archivedAt" IS NULL', '') })],
        ['does not apply project visibility', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replaceAll('p_all_projects IS TRUE OR', 'TRUE OR') })],
        ['reads "WorkItem" without its schema', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replaceAll('JOIN public."WorkItem" w', 'JOIN "WorkItem" w') })],
        ['reads WorkItem without tying its workspace', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replaceAll('AND w."tenantId" = s."tenantId"', '').replaceAll('w."tenantId" = v_tenant', 'TRUE') })],
        ['is not bounded by LIMIT', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace(/LIMIT LEAST\([^;]*;/, ';') })],
        ['caps at 5000, not 1000', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace('0), 1000)', '0), 5000)') })],
        ['search_path is not fixed', (d: SearchDefinerDefinition) => ({ ...d, attributes: d.attributes.replace(/SET search_path[^\n]*/, '') })],
        ['not SECURITY DEFINER', (d: SearchDefinerDefinition) => ({ ...d, attributes: d.attributes.replace('SECURITY DEFINER', 'SECURITY INVOKER') })],
        ['marked LEAKPROOF', (d: SearchDefinerDefinition) => ({ ...d, attributes: `${d.attributes}\nLEAKPROOF\n` })],
        ['returns workItemId, commentId, rank, bounded, title', (d: SearchDefinerDefinition) => ({ ...d, returns: `${d.returns}, "title" text` })],
        // Decision 250: the candidate bound, the walk, its gates, its fallback, its flag and the settings.
        ['does not walk as pinned', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace('LIMIT 50000', 'LIMIT 500000') })],
        ['does not walk the newest vectors first', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace(/ORDER BY s\."updatedAt" DESC, s\."id" DESC\s+LIMIT 50000/, 'ORDER BY s."id" DESC LIMIT 50000') })],
        ['does not apply the item\'s deletedAt to both the walk and the full match', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace(/AND w\."deletedAt" IS NULL\n           AND p\."deletedAt" IS NULL/, 'AND p."deletedAt" IS NULL') })],
        ['does not apply project visibility to both the walk and the full match', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace("AND (p_all_projects IS TRUE OR w.\"projectId\" = ANY (COALESCE(p_project_ids, '{}'::text[])))\n    ), candidates", '), candidates') })],
        ['does not join the walk\'s item in its workspace', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace('AND w."tenantId" = s."tenantId"', '') })],
        ['does not keep the full match to the workspace\'s live, visible items', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace('JOIN live l ON l."id" = s."workItemId"', 'JOIN live l ON TRUE') })],
        ['reads "SearchVector" without the workspace and the configuration', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace(/FROM public\."SearchVector" s\n                 WHERE s\."tenantId" = v_tenant AND s\."configName" = 'islestone_bg_en'\n                 ORDER BY s\."updatedAt" DESC, s\."id" DESC\n                 LIMIT 100000/, 'FROM public."SearchVector" s\n                 LIMIT 100000') })],
        ['does not gate the walk on the workspace\'s size and the query\'s density', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace('count(*) >= 100 AS "dense"', 'count(*) >= 0 AS "dense"') })],
        ['does not fall back to every match when the walk holds 2000 or fewer', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace('WHERE (SELECT count(*) FROM recent) <= 2000', 'WHERE false') })],
        ['does not say when more than 2000 candidates matched', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace('(count(*) OVER ()) > 2000', 'false') })],
        ['ranks more than 2000 candidates', (d: SearchDefinerDefinition) => ({ ...d, body: d.body.replace('WHERE r."recency" <= 2000', 'WHERE TRUE') })],
        ['does not set jit = off', (d: SearchDefinerDefinition) => ({ ...d, attributes: d.attributes.replace(/SET jit[^\n]*/, '') })],
        ['does not set plan_cache_mode = force_custom_plan', (d: SearchDefinerDefinition) => ({ ...d, attributes: d.attributes.replace(/SET plan_cache_mode[^\n]*/, '') })],
        ['sets plan_cache_mode = force_generic_plan', (d: SearchDefinerDefinition) => ({ ...d, attributes: d.attributes.replace('force_custom_plan', 'force_generic_plan') })],
        ['sets work_mem = 1GB', (d: SearchDefinerDefinition) => ({ ...d, attributes: `${d.attributes}SET work_mem = 1GB\n` })],
    ])('refuses a body that %s', (problem, mutate) => {
        expect(definerProblems(spec, realDef)).toEqual([]);
        expect(definerProblems(spec, mutate(realDef)).join('\n')).toContain(problem);
    });
});
