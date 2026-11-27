#!/usr/bin/env node
/**
 * The latency harness (Hardening H2b; docs/porting/maps/H2.md parts 1.4 to
 * 1.7; docs/performance.md, "Latency"; owner decisions 166 to 169).
 *
 *   node scripts/perf/run.mjs [--base-url URL] [--shape 10k|100k] [--enforce]
 *       [--compare perf-summary-10k.json] [--browser] [--out DIR]
 *       [--only a,b] [--samples N] [--warmup N] [--concurrency-clients N]
 *
 * Against the BUILT app (`npm run start`, the standalone server) and the
 * seeded database (`scripts/seed-scale/`), it signs in through the
 * credentials flow as the seed's heavy member, finds the scenarios' targets
 * through the API, then for each scenario in `budgets.json` warms it and
 * takes its samples one after another (p50 and p95 of the time from the
 * request to the last byte of its response, as the browser waits for it),
 * runs a concurrent pass (reported, never budgeted) and, with `--browser`,
 * the browser timings through Playwright's Chromium (reported only).
 *
 * It writes `perf-summary.json` and `perf-summary.md` to `--out` (and the
 * Markdown to `$GITHUB_STEP_SUMMARY` when set) and exits:
 *   0  every scenario measured (and, with --enforce, within its budget);
 *   1  a scenario measured nothing (always), or a budget or ratio rule was
 *      missed on both attempts (with --enforce: the nightly 100k run);
 *   2  a usage error or an unusable environment (no sign-in, bad budgets).
 *
 * Decision 168: budgets block only the nightly 100k run, with 25 %
 * tolerance and one automatic re-run of a failing scenario; a run that
 * measured nothing blocks everywhere. Written fresh for Islestone; plain
 * Node, `undici` (already a dependency) and `perf_hooks`, no new tool
 * (decision 169).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { Agent, request } from 'undici';

import { budgetProblems, judge, judgeRatios, knownFindingAt, renderMarkdown, summarise, verdictOf } from './lib.mjs';

/**
 * The seed's password for its two accounts that sign in (the owner and the
 * heavy member): `SEED_PASSWORD` in scripts/seed-scale/workspace.ts, held
 * equal by tests/unit/perf/harness.test.ts. A throwaway value on a
 * throwaway database.
 */
export const SEED_PASSWORD = 'seed-scale-perf-2026'; // pragma: allowlist secret — the seed's disposable account
const OPEN_CATEGORIES = 'BACKLOG,UNSTARTED,STARTED';
const TIMELINE_ITEM_LIMIT = 5000;
const SEARCH_QUERY = 'задачата проекта'; // the plan checks' and the statement counts' query (tests/perf)

function usage(message) {
    process.stderr.write(`perf: ${message}\n`);
    process.exit(2);
}

const { values: args } = parseArgs({
    options: {
        'base-url': { type: 'string', default: process.env.PERF_BASE_URL || 'http://127.0.0.1:3100' },
        shape: { type: 'string', default: process.env.PERF_SHAPE || '10k' },
        email: { type: 'string' },
        budgets: { type: 'string', default: path.join(path.dirname(new URL(import.meta.url).pathname), 'budgets.json') },
        out: { type: 'string', default: process.env.PERF_REPORT_DIR || 'perf-report' },
        enforce: { type: 'boolean', default: false },
        compare: { type: 'string' },
        browser: { type: 'boolean', default: false },
        only: { type: 'string' },
        samples: { type: 'string' },
        warmup: { type: 'string' },
        'concurrency-clients': { type: 'string', default: '10' },
        'skip-api': { type: 'boolean', default: false },
        'browser-runs': { type: 'string' },
    },
    strict: true,
});

const base = args['base-url'].replace(/\/$/, '');
const shape = args.shape;
if (!['10k', '100k'].includes(shape)) usage(`--shape must be 10k or 100k (got ${shape})`);
const budgets = JSON.parse(fs.readFileSync(args.budgets, 'utf8'));
const problems = budgetProblems(budgets);
if (problems.length) usage(`budgets.json: ${problems.join('; ')}`);
const intArg = (name) => {
    if (args[name] === undefined) return undefined;
    const n = Number(args[name]);
    if (!Number.isInteger(n) || n < 0) usage(`--${name} must be a whole number`);
    return n;
};
const samplesOverride = intArg('samples');
const warmupOverride = intArg('warmup');
const clients = intArg('concurrency-clients') ?? 10;
const only = args.only ? new Set(args.only.split(',')) : null;
if (only) for (const id of only) if (!budgets.scenarios[id]) usage(`--only names an unknown scenario: ${id}`);
const slug = `perf-${shape}`;
const email = args.email || `member003@${slug}.seed.invalid`;
const password = process.env.PERF_PASSWORD || SEED_PASSWORD;

// ── HTTP ───────────────────────────────────────────────────────────────
const agent = new Agent({ keepAliveTimeout: 60_000, connections: 32 });
let cookie = '';

/** One request, timed from its start to the last byte of its body (gzip accepted, as a browser does). */
async function call(method, urlPath, { body, headers = {}, dispatcher = agent } = {}) {
    const started = performance.now();
    const res = await request(`${base}${urlPath}`, {
        method,
        dispatcher,
        headers: {
            cookie,
            'accept-encoding': 'gzip',
            accept: 'application/json, text/html',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = Buffer.from(await res.body.arrayBuffer());
    const ms = performance.now() - started;
    const gzipped = res.headers['content-encoding'] === 'gzip';
    return { status: res.statusCode, ms, raw, gzipped, headers: res.headers };
}

function bodyOf(r) {
    const text = (r.gzipped ? gunzipSync(r.raw) : r.raw).toString('utf8');
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

const api = (p) => `/api/t/${slug}${p}`;

async function getJson(p) {
    const r = await call('GET', api(p));
    if (r.status !== 200) throw new Error(`GET ${p}: ${r.status} ${String(bodyOf(r)).slice(0, 200)}`);
    return bodyOf(r);
}

function setCookies(headers, jar) {
    const raw = headers['set-cookie'];
    for (const c of Array.isArray(raw) ? raw : raw ? [raw] : []) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
    }
}

/** The credentials flow NextAuth serves, as the sign-in page posts it. */
async function signIn() {
    const jar = new Map();
    const csrf = await request(`${base}/api/auth/csrf`, { dispatcher: agent });
    setCookies(csrf.headers, jar);
    const { csrfToken } = await csrf.body.json();
    const form = new URLSearchParams({ csrfToken, email, password, json: 'true', callbackUrl: `${base}/` });
    const res = await request(`${base}/api/auth/callback/credentials`, {
        method: 'POST',
        dispatcher: agent,
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
        body: form.toString(),
    });
    setCookies(res.headers, jar);
    await res.body.dump();
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const session = await (await request(`${base}/api/auth/session`, { dispatcher: agent, headers: { cookie } })).body.json();
    if (session?.user?.email !== email) usage(`could not sign in as ${email} at ${base} (is the seeded database behind it, and the server's DATA_ENCRYPTION_KEY the seed's?)`);
    if (!session.user.memberships?.some((m) => m.slug === slug)) usage(`${email} is not a member of ${slug}`);
    return { userId: session.user.id, jar };
}

/** Each board column's first card in the project (the board reads one list per state, in manual order). */
async function firstCards(project, states) {
    return Promise.all(
        states.map(async (s) => ({ state: s, first: (await getJson(`/work-items?projectId=${project.id}&stateId=${s.id}&order=manual&limit=1`)).items[0] })),
    );
}

const DAY_MS = 86_400_000;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
/** The Monday of the week holding `t` (UTC date parts, as the seed's weeks). */
function mondayOf(t) {
    const d = new Date(dayOf(t) + 'T00:00:00Z');
    return dayOf(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
}

// ── Discovery: the scenarios' targets, read through the API ────────────
async function discover(userId) {
    const projects = (await getJson('/projects')).filter((p) => !p.archivedAt && !p.deletedAt);
    if (projects.length === 0) usage(`${slug} has no projects`);
    const metrics = await Promise.all(projects.map((p) => getJson(`/work-items/metrics?projectId=${p.id}`)));
    const sized = projects.map((p, i) => ({ ...p, total: metrics[i].total, open: OPEN_CATEGORIES.split(',').reduce((n, c) => n + (metrics[i].byCategory[c] ?? 0), 0) }));
    const project = sized.find((p) => p.keyPrefix === 'AA') ?? sized[0];
    const big = [...sized].sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : 1))[0];
    const statesOf = async (teamId) => (await getJson(`/teams/${teamId}/workflow-states`)).filter((s) => !s.archivedAt);
    const bigStates = await statesOf(big.teamId);
    const todo = bigStates.find((s) => s.name === 'Todo') ?? bigStates.find((s) => s.category === 'UNSTARTED');
    if (!todo) usage(`no Todo state in ${big.keyPrefix}'s team`);
    const fields = await getJson(`/projects/${project.id}/custom-fields`);
    const selectField = fields.find((f) => f.type === 'SELECT' && !f.archivedAt);
    if (!selectField) usage(`${project.keyPrefix} has no select field`);
    // The detail's item: of the project's first page, the one with the most sub-items, then comments (as tests/perf/perf-world.ts picks).
    const firstPage = (await getJson(`/work-items?projectId=${project.id}&order=manual&limit=50`)).items;
    const details = await Promise.all(firstPage.map((r) => getJson(`/work-items/${r.id}`)));
    const item = [...details].sort((a, b) => b.counts.subItems - a.counts.subItems || b.counts.comments - a.counts.comments || (a.id < b.id ? -1 : 1))[0];
    // The writes: open items of the project, never the detail's item.
    const projectStates = await statesOf(project.teamId);
    const backlog = projectStates.find((s) => s.category === 'BACKLOG');
    const unstarted = projectStates.find((s) => s.category === 'UNSTARTED');
    const started = projectStates.find((s) => s.category === 'STARTED');
    const open = (await getJson(`/work-items?projectId=${project.id}&stateCategory=BACKLOG,UNSTARTED&order=manual&limit=100`)).items.filter((r) => r.id !== item.id);
    if (open.length < 60) usage(`${project.keyPrefix} has too few open items for the writes (${open.length})`);
    const types = await getJson('/work-item-types');
    // The timeline: the largest scope the read accepts (at most 5,000 items).
    const workspace = await getJson('/work-items/metrics');
    const workspaceOpen = OPEN_CATEGORIES.split(',').reduce((n, c) => n + (workspace.byCategory[c] ?? 0), 0);
    const candidates = [
        { label: 'the workspace, open items', query: `stateCategory=${OPEN_CATEGORIES}`, count: workspaceOpen, page: `/t/${slug}/work-items?stateCategory=${OPEN_CATEGORIES}`, viewKey: 'workspace' },
        ...sized.map((p) => ({ label: `project ${p.keyPrefix}`, query: `projectId=${p.id}`, count: p.total, page: `/t/${slug}/projects/${p.keyPrefix}`, viewKey: `project:${p.id}` })),
    ].filter((c) => c.count <= TIMELINE_ITEM_LIMIT);
    const timeline = candidates.sort((a, b) => b.count - a.count)[0];
    const columns = await firstCards(big, bigStates);
    // Time (3.4d's scenarios): last week, the heavy member's full one, and its item with an entry (My time, an item's time).
    const timeWeek = mondayOf(Date.now() - 7 * DAY_MS);
    const week = await getJson(`/time-entries?week=${timeWeek}`);
    const timeItem = week.entries.find((e) => e.item?.kind === 'visible' && e.minutes !== null)?.item;
    if (!timeItem) usage(`the heavy member has no time on a visible item in the week of ${timeWeek}`);
    return { userId, projects: sized, project, big, bigStates, todo, selectField, item, open, backlog, unstarted, started, typeId: types[0].id, timeline, columns, timeWeek, timeItem };
}

// ── Scenarios ──────────────────────────────────────────────────────────
const isOk = (status) => status >= 200 && status < 300;
const listCheck = (b) => (Array.isArray(b?.items) && b.items.length > 0 ? null : 'a list answered no rows');

/** One request; a sample is `{ ok, status, ms, problem }`. */
const single = (method, urlFor, check, extra = {}) => async (run) => {
    const spec = typeof urlFor === 'function' ? urlFor(run) : { path: urlFor };
    const r = await call(method, spec.path, { body: spec.body, headers: spec.headers });
    const problem = isOk(r.status) && check ? check(bodyOf(r), r) : null;
    if (isOk(r.status) && extra.after) extra.after(bodyOf(r), r);
    return { ok: isOk(r.status) && !problem, status: r.status, ms: r.ms, problem, bytes: r.raw.length, gzipped: r.gzipped, raw: r.raw };
};

/** Several requests the page fires together; a sample is their wall clock. */
const parallel = (paths, check) => async () => {
    const started = performance.now();
    const rs = await Promise.all(paths().map((p) => call('GET', p)));
    const ms = performance.now() - started;
    const bad = rs.find((r) => !isOk(r.status));
    const problem = bad ? null : (check?.(rs.map(bodyOf)) ?? null);
    return { ok: !bad && !problem, status: bad ? bad.status : 200, ms, problem };
};

/** A document request, then the requests its page fires together (a first load). */
const documentThen = (doc, paths) => async () => {
    const started = performance.now();
    const d = await call('GET', doc, { headers: { accept: 'text/html' } });
    if (!isOk(d.status)) return { ok: false, status: d.status, ms: performance.now() - started };
    const rs = await Promise.all(paths().map((p) => call('GET', p)));
    const ms = performance.now() - started;
    const bad = rs.find((r) => !isOk(r.status));
    return { ok: !bad, status: bad ? bad.status : 200, ms };
};

function scenarioRunners(w) {
    const listQ = (q) => api(`/work-items?${q}`);
    const p = w.project.id;
    const versions = new Map(w.open.map((r) => [r.id, r.version]));
    const [editItem, moveItem, reorderItem, anchor] = w.open;
    const bulkIds = w.open.slice(4, 104).map((r) => r.id);
    const myWork = ['reviewerId=me', `assigneeId=${w.userId}`, 'waitingOnId=me', `createdById=${w.userId}`, 'watching=me', `assigneeId=${w.userId}&due=soon`].map(
        (f) => listQ(`${f}&stateCategory=${OPEN_CATEGORIES}&order=manual&limit=25`),
    );
    const columns = () => w.bigStates.map((s) => listQ(`projectId=${w.big.id}&stateId=${s.id}&order=manual&limit=50`));
    let timelineExtra = null;
    let roadmapExtra = null;
    return {
        'list-project': single('GET', listQ(`projectId=${p}&order=manual&limit=50`), listCheck),
        'list-workspace-due': single('GET', listQ(`stateCategory=${OPEN_CATEGORIES}&priority=HIGH,URGENT&order=due&limit=50`), listCheck),
        'list-custom-field-sort': single('GET', listQ(`projectId=${p}&order=cf:${w.selectField.id}&limit=50`), listCheck),
        'list-q': single('GET', listQ(`q=${encodeURIComponent(SEARCH_QUERY)}&order=manual&limit=50`), listCheck),
        'board-column': single('GET', listQ(`projectId=${w.big.id}&stateId=${w.todo.id}&order=manual&limit=50`), listCheck),
        'board-load': documentThen(`/t/${slug}/projects/${w.big.keyPrefix}`, columns),
        search: single('GET', api(`/search?q=${encodeURIComponent(SEARCH_QUERY)}&limit=20`), (b) => (Array.isArray(b?.results ?? b?.hits ?? b) || typeof b === 'object' ? null : 'search answered no body')),
        detail: single('GET', api(`/work-items/${w.item.id}`), (b) => (b?.id === w.item.id ? null : 'the detail answered another item')),
        'detail-sheet': parallel(() => [
            api(`/work-items/${w.item.id}`),
            api(`/work-items/${w.item.id}/comments`),
            api(`/work-items/${w.item.id}/activity`),
            listQ(`parentId=${w.item.id}&order=manual&limit=100`),
            api(`/projects/${p}/custom-fields?includeArchived=1`),
        ]),
        'my-work': parallel(() => myWork),
        timeline: single(
            'GET',
            api(`/work-items/timeline?${w.timeline.query}`),
            (b, r) => {
                if (!Array.isArray(b?.rows)) return 'the timeline answered no rows';
                timelineExtra = { rows: b.rows.filter((row) => !row.context).length, contextRows: b.rows.filter((row) => row.context).length, edges: b.edges?.length ?? 0, gzipBytes: r.gzipped ? r.raw.length : null, bytes: (r.gzipped ? gunzipSync(r.raw) : r.raw).length };
                return null;
            },
        ),
        // The roadmap (3.2c): the whole workspace, as the Roadmap page first reads it.
        roadmap: single('GET', api('/roadmap'), (b, r) => {
            if (!Array.isArray(b?.projects) || !Array.isArray(b?.initiatives)) return 'the roadmap answered no projects';
            roadmapExtra = { projects: b.projects.length, initiatives: b.initiatives.length, milestones: b.milestones?.length ?? 0, gzipBytes: r.gzipped ? r.raw.length : null, bytes: (r.gzipped ? gunzipSync(r.raw) : r.raw).length };
            return null;
        }),
        // Time (3.4d's scenarios, budgets in the decision-167 terms the 3.4 map names): the heavy member's last
        // week (My time), the time of an item in it, and Time totals of the quarter ending with that week, by
        // project (as a Member: no money).
        'time-week': single('GET', api(`/time-entries?week=${w.timeWeek}`), (b) => (Array.isArray(b?.entries) && b.entries.length > 0 ? null : 'the week answered no entries')),
        'time-item': single('GET', api(`/work-items/${w.timeItem.id}/time`), (b) => (Array.isArray(b?.entries) && b.entries.length > 0 ? null : "the item's time answered no entries")),
        'time-totals': single(
            'GET',
            api(`/time-totals?from=${dayOf(Date.parse(w.timeWeek + 'T00:00:00Z') + 6 * DAY_MS - 90 * DAY_MS)}&to=${dayOf(Date.parse(w.timeWeek + 'T00:00:00Z') + 6 * DAY_MS)}&groupBy=project`),
            (b) => (Array.isArray(b?.groups) && b.groups.length > 0 ? null : 'Time totals answered no groups'),
        ),
        create: single('POST', (run) => ({ path: api('/work-items'), body: { projectId: p, typeId: w.typeId, title: `Perf harness create ${run}`, description: 'Задачата на проекта and a description to index.' } }), null),
        edit: single(
            'PATCH',
            (run) => ({ path: api(`/work-items/${editItem.id}`), body: { title: `${editItem.title.slice(0, 150)} (perf ${run})` }, headers: { 'if-match': `"${versions.get(editItem.id)}"` } }),
            null,
            { after: (b) => versions.set(editItem.id, b.version) },
        ),
        move: single('POST', (run) => ({ path: api(`/work-items/${moveItem.id}/move`), body: { stateId: run % 2 === 0 ? w.started.id : w.unstarted.id } }), null),
        reorder: single('POST', (run) => ({ path: api(`/work-items/${reorderItem.id}/move`), body: { position: run % 2 === 0 ? { afterId: anchor.id } : { beforeId: anchor.id } } }), null),
        'bulk-state': single('POST', (run) => ({ path: api('/work-items/bulk/state'), body: { workItemIds: bulkIds, stateId: run % 2 === 0 ? w.unstarted.id : w.backlog.id } }), null),
        // Adding time (3.4d's write scenario): one minute on a day of its own far ahead, so no day fills across runs.
        'time-add': single('POST', (run) => ({ path: api('/time-entries'), body: { workItemId: w.timeItem.id, workDate: dayOf(Date.UTC(2099, 0, 1) + (Math.abs(run) % 1000) * DAY_MS), minutes: 1 } }), null),
        _timelineExtra: () => timelineExtra,
        _roadmapExtra: () => roadmapExtra,
    };
}

/** Warm a scenario, then take its samples one after another. */
async function measure(id, runner, scenario) {
    const samples = samplesOverride ?? scenario.samples ?? budgets.samples;
    const warmup = warmupOverride ?? scenario.warmup ?? budgets.warmup;
    let run = 0;
    for (let i = 0; i < warmup; i++) await runner(run++);
    const times = [];
    const statuses = {};
    const problemSet = new Set();
    let ok = 0;
    for (let i = 0; i < samples; i++) {
        let s;
        try {
            s = await runner(run++);
        } catch (err) {
            s = { ok: false, status: 'error', ms: NaN, problem: String(err?.message ?? err).slice(0, 200) };
        }
        statuses[s.status] = (statuses[s.status] ?? 0) + 1;
        if (s.problem) problemSet.add(s.problem);
        if (s.ok) {
            ok++;
            times.push(s.ms);
        }
    }
    return { samples, warmup, ok, statuses, problems: [...problemSet], summary: summarise(times) };
}

async function runApi(world, writes) {
    const runners = scenarioRunners(world);
    const out = {};
    for (const [id, scenario] of Object.entries(budgets.scenarios)) {
        if (only && !only.has(id)) continue;
        if (Boolean(scenario.write) !== writes) continue;
        const runner = runners[id];
        if (!runner) usage(`budgets.json names a scenario run.mjs does not know: ${id}`);
        const attempts = [];
        for (let attempt = 0; attempt <= budgets.reruns; attempt++) {
            const m = await measure(id, runner, scenario);
            const verdict = m.summary.count > 0 ? judge(m.summary, scenario, shape, budgets.tolerance) : null;
            const a = { ...m, verdict };
            if (id === 'timeline') {
                const t = runners._timelineExtra();
                if (t) a.extra = `(${world.timeline.label}: ${t.rows} items and ${t.contextRows} context rows, ${t.edges} relations, ${Math.round(t.bytes / 1024)} KB, ${t.gzipBytes === null ? 'not compressed' : `${Math.round(t.gzipBytes / 1024)} KB gzip`})`;
                a.size = t;
            }
            if (id === 'roadmap') {
                const t = runners._roadmapExtra();
                if (t) a.extra = `(${t.projects} projects, ${t.initiatives} initiatives, ${t.milestones} milestones, ${Math.round(t.bytes / 1024)} KB, ${t.gzipBytes === null ? 'not compressed' : `${Math.round(t.gzipBytes / 1024)} KB gzip`})`;
                a.size = t;
            }
            attempts.push(a);
            process.stderr.write(`perf: ${id} attempt ${attempt + 1}: n=${m.summary.count} p50=${m.summary.p50} p95=${m.summary.p95} ms${verdict?.missed ? ' (missed)' : ''}\n`);
            // One automatic re-run, only for a budget miss on the run that enforces budgets (decision 168).
            if (!(args.enforce && verdict?.missed && verdict.blocking)) break;
        }
        out[id] = { label: scenario.label, reportedBecause: scenario.reportedBecause, knownFinding: knownFindingAt(scenario, shape) ?? undefined, attempts };
    }
    return out;
}

/** Ten clients at once over the read scenarios: throughput, reported, never budgeted (map part 1.4). */
async function runConcurrency(world) {
    if (clients === 0) return null;
    const ids = ['list-project', 'board-column', 'search', 'detail'];
    const rounds = 25;
    const perScenario = Object.fromEntries(ids.map((id) => [id, []]));
    let failed = 0;
    const started = performance.now();
    await Promise.all(
        Array.from({ length: clients }, async () => {
            const runners = scenarioRunners(world);
            for (let r = 0; r < rounds; r++) {
                for (const id of ids) {
                    const s = await runners[id](r);
                    if (s.ok) perScenario[id].push(s.ms);
                    else failed++;
                }
            }
        }),
    );
    const seconds = Math.round((performance.now() - started) / 10) / 100;
    const requests = clients * rounds * ids.length;
    return { clients, requests, seconds, throughput: Math.round((requests / seconds) * 10) / 10, failed, scenarios: Object.fromEntries(ids.map((id) => [id, summarise(perScenario[id])])) };
}

// ── Browser timings (reported only) ────────────────────────────────────
function chromiumExecutable() {
    const configured = process.env.PW_CHROMIUM_PATH;
    if (!configured) return undefined;
    const names = new Set(['chrome', 'chromium', 'chrome-headless-shell', 'headless_shell']);
    const find = (dir, depth) => {
        if (depth < 0) return undefined;
        const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
        for (const e of entries) if (names.has(e.name) && fs.statSync(path.join(dir, e.name)).isFile()) return path.join(dir, e.name);
        for (const e of entries) if (e.isDirectory()) {
            const f = find(path.join(dir, e.name), depth - 1);
            if (f) return f;
        }
        return undefined;
    };
    return fs.statSync(configured).isFile() ? configured : find(configured, 4);
}

async function runBrowser(discovered, jar) {
    let world = discovered;
    const { chromium } = await import('@playwright/test');
    const executablePath = chromiumExecutable();
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: base })));
    const runs = intArg('browser-runs') ?? budgets.browser.runs;
    const layoutKey = (viewKey) => `islestone:work-items:layout:${viewKey}`;
    const timed = async (fn) => {
        const times = [];
        let error = null;
        for (let i = 0; i < runs + 2; i++) {
            const page = await context.newPage();
            try {
                const ms = await fn(page);
                if (i >= 2) times.push(ms); // two unrecorded runs warm the browser's caches
            } catch (err) {
                error = String(err?.message ?? err).split('\n')[0].slice(0, 200);
            } finally {
                await page.close();
            }
            // A scenario that cannot reach its mark stops at once rather than waiting out every run.
            if (error) break;
        }
        return { summary: summarise(times), error };
    };
    const withLayout = async (page, viewKey, layout) => {
        await page.addInitScript(([k, v]) => window.localStorage.setItem(k, JSON.stringify(v)), [layoutKey(viewKey), layout]);
    };
    // Read the marks again: an earlier run's writes may have moved or renamed an item.
    const first = (await getJson(`/work-items?projectId=${world.project.id}&order=manual&limit=1`)).items[0];
    world = { ...world, columns: await firstCards(world.big, world.bigStates) };
    const scenarios = {
        list: async (page) => {
            await withLayout(page, `project:${world.project.id}`, 'list');
            const t = Date.now();
            await page.goto(`${base}/t/${slug}/projects/${world.project.keyPrefix}`, { waitUntil: 'commit' });
            await page.getByRole('main').getByText(first.title, { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 });
            return Date.now() - t;
        },
        board: async (page) => {
            await withLayout(page, `project:${world.big.id}`, 'board');
            const t = Date.now();
            await page.goto(`${base}/t/${slug}/projects/${world.big.keyPrefix}`, { waitUntil: 'commit' });
            const board = page.getByRole('main').getByRole('region', { name: 'Board' });
            for (const c of world.columns.filter((col) => col.first)) {
                await board.getByRole('region', { name: c.state.name, exact: true }).getByRole('button', { name: `${c.first.key}: ${c.first.title}`, exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
            }
            return Date.now() - t;
        },
        // A list row's title links to the full page; the sheet opens from a board card (as tests/e2e/work-items.spec.ts opens it).
        detail: async (page) => {
            await withLayout(page, `project:${world.big.id}`, 'board');
            await page.goto(`${base}/t/${slug}/projects/${world.big.keyPrefix}`);
            const c = world.columns.find((col) => col.first);
            const card = page.getByRole('main').getByRole('region', { name: 'Board' }).getByRole('button', { name: `${c.first.key}: ${c.first.title}`, exact: true });
            await card.waitFor({ state: 'visible', timeout: 30_000 });
            const t = Date.now();
            await card.click();
            await page.getByTestId('work-item-sheet-body').getByRole('heading', { name: c.first.title }).waitFor({ state: 'visible', timeout: 30_000 });
            return Date.now() - t;
        },
        timeline: async (page) => {
            await withLayout(page, world.timeline.viewKey, 'timeline');
            const t = Date.now();
            await page.goto(`${base}${world.timeline.page}`, { waitUntil: 'commit' });
            await page.getByRole('main').getByRole('region', { name: 'Timeline chart' }).locator('.isl-timeline-bar').first().waitFor({ state: 'visible', timeout: 30_000 });
            return Date.now() - t;
        },
    };
    const out = {};
    for (const [id, b] of Object.entries(budgets.browser.scenarios)) {
        if (!scenarios[id]) usage(`budgets.json names a browser scenario run.mjs does not know: ${id}`);
        const r = await timed(scenarios[id]);
        out[id] = { label: b.label, target: b.p95, ...r, extra: id === 'timeline' ? `(${world.timeline.label}, ${world.timeline.count} items)` : undefined };
        process.stderr.write(`perf: browser ${id}: n=${r.summary.count} p50=${r.summary.p50} p95=${r.summary.p95} ms${r.error ? ` (error: ${r.error})` : ''}\n`);
    }
    await browser.close();
    return { runs, scenarios: out };
}

// ── Main ───────────────────────────────────────────────────────────────
const startedAt = new Date().toISOString();
const { userId, jar } = await signIn();
const world = await discover(userId);
process.stderr.write(`perf: signed in as ${email}; project ${world.project.keyPrefix} (${world.project.total}), large ${world.big.keyPrefix} (${world.big.total}), timeline ${world.timeline.label} (${world.timeline.count})\n`);

// Reads, the concurrent pass and the browser first; the writes last, so the
// rows they add and the vacuum they cause never sit under a read's figures.
const reads = args['skip-api'] ? {} : await runApi(world, false);
const concurrency = args['skip-api'] ? null : await runConcurrency(world);
const browser = args.browser ? await runBrowser(world, jar) : null;
const writes = args['skip-api'] ? {} : await runApi(world, true);
const scenarios = { ...reads, ...writes };
let ratios = [];
if (args.compare) {
    const baseline = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
    const pick = (all) => Object.fromEntries(Object.entries(all ?? {}).map(([id, s]) => [id, { summary: s.attempts?.[s.attempts.length - 1]?.summary }]));
    ratios = judgeRatios(pick(scenarios), pick(baseline.scenarios), budgets.ratios ?? [], budgets.tolerance);
}
// A browser scenario that measured nothing is a refusal too (reported figures, but a run must measure).
const browserRefusals = Object.entries(browser?.scenarios ?? {}).filter(([, b]) => b.summary.count < browser.runs);
const verdict = verdictOf({ scenarios, ratios, enforce: args.enforce });
for (const [id, b] of browserRefusals) verdict.refused.push({ id: `browser:${id}`, reasons: [`${b.summary.count} of ${browser.runs} runs measured${b.error ? `: ${b.error}` : ''}`] });
if (browserRefusals.length) verdict.failed = true;
if (!args['skip-api'] && Object.keys(scenarios).length === 0) {
    verdict.refused.push({ id: 'api', reasons: ['no scenario ran'] });
    verdict.failed = true;
}

const summary = {
    version: 1,
    shape,
    baseUrl: base,
    signedInAs: email,
    startedAt,
    finishedAt: new Date().toISOString(),
    enforce: args.enforce,
    tolerance: budgets.tolerance,
    overrides: { samples: samplesOverride ?? null, warmup: warmupOverride ?? null, only: only ? [...only] : null },
    targets: { project: world.project.keyPrefix, projectItems: world.project.total, largeProject: world.big.keyPrefix, largeProjectItems: world.big.total, timeline: { scope: world.timeline.label, items: world.timeline.count } },
    scenarios,
    ratios,
    concurrency,
    browser,
    verdict,
};
const markdown = renderMarkdown(summary);
fs.mkdirSync(args.out, { recursive: true });
fs.writeFileSync(path.join(args.out, 'perf-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(args.out, 'perf-summary.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
process.stdout.write(markdown);
await agent.close();
process.exit(verdict.failed ? 1 : 0);
