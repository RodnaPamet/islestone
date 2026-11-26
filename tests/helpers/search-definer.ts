/**
 * The search functions of owner decision 245 (issue #78; migration
 * `20261214120000_search_definer_functions`; docs/search.md, "The search
 * functions"; docs/rls-tenant-isolation.md, "The search functions: a named
 * exception"), and the pure checks every test of them shares.
 *
 * A search function is SECURITY DEFINER and owned by a role that is not
 * subject to row-level security, so its body IS the isolation: these checks
 * read a definition (from a migration, or `pg_proc.prosrc`) and name every way
 * it could stop isolating: the workspace taken from anything but
 * `app.tenant_id`, a table joined across workspaces, a missing `deletedAt` or
 * visibility predicate, an unbounded result, a text column returned, a
 * shadowable name. `tests/guards/search-definer-functions.test.ts` runs them
 * over the migrations and pins each body's hash;
 * `tests/integration/search-definer.test.ts` runs them over the catalogue.
 *
 * Written fresh for Islestone.
 */
import { createHash } from 'node:crypto';

/** The role that owns every search function: NOLOGIN, BYPASSRLS, column SELECT only. */
export const SEARCH_DEFINER_ROLE = 'app_search_definer';

/** The fixed search path every search function sets. */
export const SEARCH_DEFINER_SEARCH_PATH = 'pg_catalog, public, pg_temp';

export interface SearchDefinerSpec {
    name: string;
    /** The argument types, as `pg_get_function_identity_arguments` would list them without names. */
    argTypes: string;
    /** The one module under `src/` that calls it. */
    caller: string;
    /** The tables its body reads, by alias. */
    tables: Readonly<Record<string, 'WorkItem' | 'Project' | 'Comment' | 'SearchVector'>>;
    /** Its hard cap on rows. */
    cap: number;
    /** The columns it returns: ids and ranks only. */
    returns: readonly string[];
    /** sha256 of the body between `$fn$` delimiters, as written in the migration. A change is a reviewed diff. */
    bodySha256: string;
}

export const SEARCH_DEFINER_FUNCTIONS: readonly SearchDefinerSpec[] = [
    {
        name: 'search_work_item_titles',
        argTypes: 'text, text, text, text, boolean, text[], integer',
        caller: 'src/app-layer/repositories/WorkItemRepository.ts',
        tables: { w: 'WorkItem', p: 'Project' },
        cap: 100,
        returns: ['id', 'ordinal'],
        bodySha256: 'c143bb0d8a2b694379ee927664254b4c312c4a20c14d8ff82d2d07beb7d06fa8',
    },
    {
        name: 'search_work_item_title_words',
        argTypes: 'text, boolean, text[], integer',
        caller: 'src/app-layer/repositories/WorkItemRepository.ts',
        tables: { w: 'WorkItem', p: 'Project' },
        cap: 1000,
        returns: ['id'],
        bodySha256: '97383d942fa69de346751312b03d1786f57e1ac842a4b14f2e2f5ab8320e6cbf',
    },
    {
        name: 'search_work_item_title_substring',
        argTypes: 'text, boolean, text[], integer',
        caller: 'src/app-layer/repositories/WorkItemRepository.ts',
        tables: { w: 'WorkItem', p: 'Project' },
        cap: 1000,
        returns: ['id'],
        bodySha256: '86b6d8da232122042e3131b1ec8c58f0171a9e29ee6c68c67380f7888eca687d',
    },
    {
        name: 'search_project_names',
        argTypes: 'text, text, text, boolean, text[], integer',
        caller: 'src/app-layer/repositories/ProjectRepository.ts',
        tables: { p: 'Project' },
        cap: 100,
        returns: ['id', 'ordinal'],
        bodySha256: '4562dd30b15746cd279b7b65ea45ba10ea1606e35bf2eb9f2c4827a3373ac55c',
    },
    {
        name: 'search_item_contents',
        argTypes: 'text, boolean, text[], integer',
        caller: 'src/app-layer/repositories/SearchVectorRepository.ts',
        tables: { s: 'SearchVector', w: 'WorkItem', p: 'Project', c: 'Comment' },
        cap: 1000,
        returns: ['workItemId', 'commentId', 'rank'],
        bodySha256: '1609db20fa86f48c46478a0112365f09fe6322ecdcd0118987055e8d4aa7c9b0',
    },
];

/** One `CREATE FUNCTION search_…` as written in a migration. */
export interface SearchDefinerDefinition {
    name: string;
    /** The parameter list, as written. */
    params: string;
    /** The `RETURNS TABLE (…)` column list, as written. */
    returns: string;
    /** Everything between the closing `)` of RETURNS TABLE and `AS $fn$`: language, volatility, SECURITY DEFINER, SET. */
    attributes: string;
    /** The body between the `$fn$` delimiters, exactly. */
    body: string;
}

const DEFINITION = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(search_\w+)\s*\(([\s\S]*?)\)\s*RETURNS\s+TABLE\s*\(([^)]*)\)([\s\S]*?)\bAS\s+\$fn\$([\s\S]*?)\$fn\$\s*;/g;

/** Every search function a migration's SQL defines, in order. */
export function definitionsIn(sql: string): SearchDefinerDefinition[] {
    return [...sql.matchAll(DEFINITION)].map((m) => ({ name: m[1]!, params: m[2]!, returns: m[3]!, attributes: m[4]!, body: m[5]! }));
}

/** Any `CREATE FUNCTION search_…` header, matched or not by {@link DEFINITION} (so an unparsable one is not missed). */
export function definitionHeadersIn(sql: string): string[] {
    return [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(search_\w+)/g)].map((m) => m[1]!);
}

export function bodySha256(body: string): string {
    return createHash('sha256').update(body).digest('hex');
}

/** The SQL with its comments blanked, so a check never matches inside one. */
function codeOnly(sql: string): string {
    return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Every way the body of `spec`'s function could stop isolating, as sentences;
 * empty when it holds. `params`, `returns` and `attributes` come from the
 * header (a migration's, or the catalogue's equivalents).
 */
export function definerProblems(spec: SearchDefinerSpec, def: Pick<SearchDefinerDefinition, 'params' | 'returns' | 'attributes' | 'body'>): string[] {
    const problems: string[] = [];
    const body = codeOnly(def.body);
    const attributes = codeOnly(def.attributes);

    // ── The header ───────────────────────────────────────────────────
    if (!/\bSECURITY\s+DEFINER\b/i.test(attributes)) problems.push('not SECURITY DEFINER');
    if (!new RegExp(`\\bSET\\s+search_path\\s*=\\s*${SEARCH_DEFINER_SEARCH_PATH.replace(/ /g, '\\s*')}\\s*(\\n|$)`, 'i').test(attributes)) {
        problems.push(`search_path is not fixed to ${SEARCH_DEFINER_SEARCH_PATH}`);
    }
    if (/\bLEAKPROOF\b/i.test(attributes) && !/\bNOT\s+LEAKPROOF\b/i.test(attributes)) problems.push('marked LEAKPROOF');
    const paramNames = def.params.split(',').map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean);
    for (const name of paramNames) if (/tenant/i.test(name)) problems.push(`takes the workspace as an argument (${name})`);
    if (!paramNames.includes('p_limit')) problems.push('has no p_limit parameter');
    if (!paramNames.includes('p_all_projects') || !paramNames.includes('p_project_ids')) problems.push('does not take the visibility input (p_all_projects, p_project_ids)');
    const returned = def.returns.split(',').map((c) => c.trim().split(/\s+/)[0]!.replace(/"/g, ''));
    if (returned.join(',') !== spec.returns.join(',')) problems.push(`returns ${returned.join(', ')}, not ${spec.returns.join(', ')}`);

    // ── The workspace, from app.tenant_id and nowhere else ───────────
    const settings = [...body.matchAll(/current_setting\s*\(([^)]*)\)/g)].map((m) => m[1]!.replace(/\s+/g, ' ').trim());
    if (settings.length !== 1 || settings[0] !== "'app.tenant_id', true") problems.push('does not read app.tenant_id exactly once (current_setting)');
    if (!/\bv_tenant\s+text\s*:=\s*NULLIF\s*\(\s*current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\)\s*,\s*''\s*\)\s*;/.test(body)) {
        problems.push("does not bind v_tenant := NULLIF(current_setting('app.tenant_id', true), '')");
    }
    const guard = body.search(/\bIF\s+v_tenant\s+IS\s+NULL\s+THEN\s+RETURN\s*;\s*END\s+IF\s*;/);
    const query = body.search(/\bRETURN\s+QUERY\b/);
    if (guard < 0 || query < 0 || guard > query) problems.push('does not return nothing before its query when app.tenant_id is unset');
    if ((body.match(/\bRETURN\s+QUERY\b/g) ?? []).length !== 1) problems.push('has not exactly one RETURN QUERY');
    if (/:=/.test(body.replace(/\bv_tenant\s+text\s*:=/, ''))) problems.push('assigns a variable other than v_tenant');
    for (const m of body.matchAll(/"tenantId"\s*=\s*([^\s)]+)/g)) {
        const rhs = m[1]!;
        if (rhs !== 'v_tenant' && !/^[a-z]\."tenantId"$/.test(rhs)) problems.push(`compares a workspace with ${rhs}`);
    }
    if (/\$\d/.test(body)) problems.push('reads a positional argument ($n)');

    // ── The tables: schema-qualified, each tied to the workspace ─────
    const read = [...body.matchAll(/\b(FROM|JOIN)\s+(public\.)?"(\w+)"\s+([a-z])\b/g)].map((m) => ({ kw: m[1]!, schema: m[2], table: m[3]!, alias: m[4]! }));
    for (const r of read) if (!r.schema) problems.push(`reads "${r.table}" without its schema`);
    const aliases = Object.fromEntries(read.map((r) => [r.alias, r.table]));
    if (JSON.stringify(Object.entries(aliases).sort()) !== JSON.stringify(Object.entries(spec.tables).sort())) {
        problems.push(`reads ${JSON.stringify(aliases)}, not ${JSON.stringify(spec.tables)}`);
    }
    const anchor = read[0];
    if (!anchor || anchor.kw !== 'FROM') problems.push('reads no table first with FROM');
    else if (!new RegExp(`\\b${anchor.alias}\\."tenantId"\\s*=\\s*v_tenant\\b`).test(body)) problems.push(`does not filter ${anchor.alias}."tenantId" = v_tenant`);
    for (const r of read.slice(1)) {
        if (!new RegExp(`\\b${r.alias}\\."tenantId"\\s*=\\s*(v_tenant\\b|[a-z]\\."tenantId")`).test(body)) problems.push(`reads ${r.table} without tying its workspace`);
    }

    // ── Liveness and visibility ──────────────────────────────────────
    const flat = body.replace(/\s+/g, ' ');
    for (const [alias, table] of Object.entries(spec.tables)) {
        if (table === 'WorkItem' && !flat.includes(`${alias}."deletedAt" IS NULL`)) problems.push(`does not filter ${alias}."deletedAt" (the item)`);
        if (table === 'Project' && !flat.includes(`${alias}."deletedAt" IS NULL AND ${alias}."archivedAt" IS NULL`)) problems.push(`does not filter ${alias}."deletedAt" and "archivedAt" (the project)`);
        if (
            table === 'Comment' &&
            !flat.includes(`(s."commentId" IS NULL OR EXISTS (SELECT 1 FROM public."Comment" ${alias} WHERE ${alias}."id" = s."commentId" AND ${alias}."tenantId" = v_tenant AND ${alias}."deletedAt" IS NULL))`)
        ) {
            problems.push(`does not filter ${alias}."deletedAt" (the comment)`);
        }
    }
    const projectAlias = Object.entries(spec.tables).find(([, t]) => t === 'Project')?.[0];
    const itemAlias = Object.entries(spec.tables).find(([, t]) => t === 'WorkItem')?.[0];
    const visibleColumn = itemAlias ? `${itemAlias}."projectId"` : `${projectAlias}."id"`;
    if (!flat.includes(`(p_all_projects IS TRUE OR ${visibleColumn} = ANY (COALESCE(p_project_ids, '{}'::text[])))`)) problems.push('does not apply project visibility');
    if (spec.tables.s === 'SearchVector' && !flat.includes(`s."configName" = 'islestone_bg_en'`)) problems.push('does not name the configuration');

    // ── The bound ────────────────────────────────────────────────────
    const limits = [...flat.matchAll(/\bLIMIT\s+([^;]+?)\s*;/g)].map((m) => m[1]!);
    const capped = limits.length === 1 ? /^LEAST\(GREATEST\(COALESCE\(p_limit, 0\), 0\), (\d+)\)$/.exec(limits[0]!) : null;
    if (!capped) problems.push('is not bounded by LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), <cap>)');
    else if (Number(capped[1]) !== spec.cap) problems.push(`caps at ${capped[1]}, not ${spec.cap}`);

    return problems;
}
