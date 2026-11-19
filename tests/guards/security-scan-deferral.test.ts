/**
 * The H1 security scans start report-only, and only until a date
 * (owner decision 47, 2026-11-19).
 *
 * The nightly OWASP ZAP baseline (.github/workflows/dast.yml) and the Trivy
 * CRITICAL/HIGH image scans (ci.yml's Image job, release.yml's publish) run
 * and publish their findings but do not fail yet. Each workflow that holds a
 * non-blocking scan must carry a machine-readable marker,
 * `TRIVY-NON-BLOCKING-UNTIL: YYYY-MM-DD` or `DAST-NON-BLOCKING-UNTIL: …`,
 * and this guard compares it with the real clock: the day after the date, CI
 * fails until the scan is made blocking (or the deferral is moved, with a
 * written reason). A marker left behind once every scan of its kind blocks is
 * refused too: it would read as an open decision that is already made.
 *
 * Pattern from inflect-compliance `tests/guardrails/dast-workflow-pinning.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, which rewrote a check that
 * grepped for the shape of a date and so could never fire. This one parses
 * the date, is exercised against fixed clocks, takes its population from git
 * and proves its detector against a planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as yaml from 'js-yaml';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

type Kind = 'TRIVY' | 'DAST';

interface Step {
    name?: string;
    uses?: string;
    run?: string;
    if?: string;
    'continue-on-error'?: boolean | string;
    with?: Record<string, unknown>;
}
interface Workflow {
    jobs?: Record<string, { steps?: Step[] }>;
}

/** A deferral longer than this is a way of never deciding. */
const MAX_DEFERRAL_DAYS = 60;
const HIGH_GATE = '.zap/assert-no-high-risk.mjs';

const truthy = (v: unknown) => String(v ?? 'false').toLowerCase() === 'true';

/** The kind of security scan a step is, or null for any other step. */
function kindOf(step: Step): Kind | null {
    if (typeof step.uses === 'string' && step.uses.startsWith('aquasecurity/trivy-action@')) return 'TRIVY';
    if (typeof step.uses === 'string' && step.uses.startsWith('zaproxy/action-')) return 'DAST';
    if (typeof step.run === 'string' && step.run.includes(HIGH_GATE)) return 'DAST';
    return null;
}

/** Whether a finding can turn the job red. */
function isBlocking(step: Step): boolean {
    if (truthy(step['continue-on-error'])) return false;
    if (step.uses?.startsWith('aquasecurity/trivy-action@')) return String(step.with?.['exit-code'] ?? '0') === '1';
    if (step.uses?.startsWith('zaproxy/action-')) return truthy(step.with?.fail_action);
    return true; // the HIGH+ gate fails on its own exit code
}

export type Verdict = 'active' | 'expired' | 'unreasonable';

/** The deadline day is still active (end of day UTC); the next is not. */
export function deferralVerdict(date: string, now: Date): Verdict {
    const deadline = Date.parse(`${date}T23:59:59Z`);
    if (Number.isNaN(deadline) || now.getTime() > deadline) return 'expired';
    if (deadline > now.getTime() + MAX_DEFERRAL_DAYS * 86_400_000) return 'unreasonable';
    return 'active';
}

interface Finding {
    readonly file: string;
    readonly kind: Kind;
    readonly problem: string;
}

interface Report {
    readonly scans: { file: string; kind: Kind; step: string; blocking: boolean }[];
    readonly findings: Finding[];
}

function check(root: string, now: Date): Report {
    const files = gitFiles(root).filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
    const scans: Report['scans'] = [];
    const findings: Finding[] = [];
    for (const file of files) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        const wf = yaml.load(text) as Workflow;
        const steps = Object.values(wf?.jobs ?? {}).flatMap((j) => j.steps ?? []);
        for (const kind of ['TRIVY', 'DAST'] as const) {
            const ofKind = steps.filter((s) => kindOf(s) === kind);
            for (const s of ofKind) scans.push({ file, kind, step: s.name ?? s.uses ?? s.run ?? '', blocking: isBlocking(s) });
            const markers = [...text.matchAll(new RegExp(`${kind}-NON-BLOCKING-UNTIL:\\s*(\\d{4}-\\d{2}-\\d{2})`, 'g'))].map((m) => m[1] as string);
            const nonBlocking = ofKind.filter((s) => !isBlocking(s));
            if (nonBlocking.length === 0) {
                if (markers.length > 0) findings.push({ file, kind, problem: `stale marker ${markers.join(', ')}` });
                continue;
            }
            if (markers.length !== 1) {
                findings.push({ file, kind, problem: `${nonBlocking.length} non-blocking scan(s) need exactly one marker, found ${markers.length}` });
                continue;
            }
            const verdict = deferralVerdict(markers[0] as string, now);
            if (verdict !== 'active') findings.push({ file, kind, problem: `deferral ${markers[0]} is ${verdict}` });
        }
    }
    return { scans, findings };
}

describe('the deferral clock', () => {
    const now = new Date('2026-11-19T10:00:00Z');

    it('a passed date is expired; the deadline day itself is still active', () => {
        expect(deferralVerdict('2026-11-18', now)).toBe('expired');
        expect(deferralVerdict('2026-11-19', now)).toBe('active');
        expect(deferralVerdict('2026-12-03', new Date('2026-12-03T23:00:00Z'))).toBe('active');
        expect(deferralVerdict('2026-12-03', new Date('2026-12-04T00:00:01Z'))).toBe('expired');
    });

    it('a date beyond the window is unreasonable, and an unparseable one expired', () => {
        expect(deferralVerdict('2027-06-01', now)).toBe('unreasonable');
        expect(deferralVerdict('2026-13-45', now)).toBe('expired');
    });
});

describe('the security scans in this repository', () => {
    const report = check(REPO_ROOT, new Date());

    it('include the Trivy image scans and the ZAP baseline with its HIGH+ gate', () => {
        const where = (kind: Kind) => [...new Set(report.scans.filter((s) => s.kind === kind).map((s) => s.file))].sort();
        expect(where('TRIVY')).toEqual(['.github/workflows/ci.yml', '.github/workflows/release.yml']);
        expect(where('DAST')).toEqual(['.github/workflows/dast.yml']);
        expect(report.scans.some((s) => s.step.includes(HIGH_GATE) || /HIGH\+/.test(s.step))).toBe(true);
    });

    it('block, or are deferred to a date that has not passed', () => {
        expect({
            findings: report.findings,
            fix:
                'A deferral ended. Make the scan blocking (Trivy: exit-code "1"; ZAP: fail_action: true; ' +
                'drop continue-on-error) and delete the marker, or move the date with a written reason ' +
                '(docs/deployment.md, "Security scans").',
        }).toMatchObject({ findings: [] });
    });

    it('scan for CRITICAL and HIGH, both', () => {
        for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
            const wf = yaml.load(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')) as Workflow;
            const trivy = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []).filter((s) => kindOf(s) === 'TRIVY');
            for (const s of trivy) expect({ file, severity: s.with?.severity }).toEqual({ file, severity: 'CRITICAL,HIGH' });
        }
    });

    it('give every ZAP allowlist entry a reason', () => {
        const rows = fs
            .readFileSync(path.join(REPO_ROOT, '.zap/rules.tsv'), 'utf8')
            .split('\n')
            .filter((l) => l.trim() && !l.startsWith('#'));
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            const [id, action, reason] = row.split('\t');
            expect({ id, action: /^(IGNORE|WARN|FAIL)$/.test(action ?? ''), reason: (reason ?? '').length > 20 }).toEqual({
                id,
                action: true,
                reason: true,
            });
        }
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;
    const plant = (rel: string, content: string) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), content);
    };
    const trivy = (exit: string, coe = false) =>
        [
            '      - name: scan',
            ...(coe ? ['        continue-on-error: true'] : []),
            '        uses: aquasecurity/trivy-action@v0.36.0',
            '        with:',
            `          exit-code: '${exit}'`,
            '          severity: CRITICAL,HIGH',
        ].join('\n');
    const workflow = (body: string, marker = '') =>
        `name: x\n${marker ? `# ${marker}\n` : ''}on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n${body}\n`;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-scan-deferral-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        plant('.github/workflows/no-marker.yml', workflow(trivy('0')));
        plant('.github/workflows/expired.yml', workflow(trivy('1', true), 'TRIVY-NON-BLOCKING-UNTIL: 2026-11-01'));
        plant('.github/workflows/stale.yml', workflow(trivy('1'), 'TRIVY-NON-BLOCKING-UNTIL: 2026-12-01'));
        plant('.github/workflows/deferred.yml', workflow(trivy('0'), 'TRIVY-NON-BLOCKING-UNTIL: 2026-12-01'));
        plant(
            '.github/workflows/zap.yml',
            workflow(
                [
                    '      - uses: zaproxy/action-baseline@v0.15.0',
                    '        with:',
                    '          fail_action: true',
                    '      - name: gate',
                    '        continue-on-error: true',
                    `        run: node ${HIGH_GATE} report_json.json`,
                ].join('\n'),
            ),
        );
        plant('docs/not-a-workflow.yml', workflow(trivy('0')));
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reports each planted problem against a fixed clock, and passes the active deferral', () => {
        const { findings } = check(root, new Date('2026-11-19T10:00:00Z'));
        expect(findings.map((f) => `${f.file} ${f.kind}: ${f.problem}`).sort()).toEqual([
            '.github/workflows/expired.yml TRIVY: deferral 2026-11-01 is expired',
            '.github/workflows/no-marker.yml TRIVY: 1 non-blocking scan(s) need exactly one marker, found 0',
            '.github/workflows/stale.yml TRIVY: stale marker 2026-12-01',
            '.github/workflows/zap.yml DAST: 1 non-blocking scan(s) need exactly one marker, found 0',
        ]);
    });

    it('fails the active deferral the day after its date', () => {
        const { findings } = check(root, new Date('2026-12-02T00:00:01Z'));
        expect(findings.map((f) => f.file)).toContain('.github/workflows/deferred.yml');
    });
});
