/**
 * The H1 security scans block, and a scan that does not must say until when
 * (owner decision 47, 2026-11-19; made blocking 2026-11-26).
 *
 * The nightly OWASP ZAP baseline (.github/workflows/dast.yml) and the Trivy
 * CRITICAL/HIGH image scans (ci.yml's Image job, release.yml's publish) fail
 * their job on a finding. They started report-only for two weeks; a workflow
 * that holds a non-blocking scan must carry a machine-readable marker,
 * `TRIVY-NON-BLOCKING-UNTIL: YYYY-MM-DD` or `DAST-NON-BLOCKING-UNTIL: …`,
 * and this guard compares it with the real clock: the day after the date, CI
 * fails until the scan is made blocking (or the deferral is moved, with a
 * written reason). A marker left behind once every scan of its kind blocks is
 * refused too: it would read as an open decision that is already made. Since
 * H1 no workflow carries one, so turning a scan back to report-only fails here
 * unless the change also dates its own end.
 *
 * Beside the clock it holds what makes a blocking scan mean what the docs say:
 * Trivy at CRITICAL,HIGH with fixes available, its SARIF limited to those
 * severities (or the action drops the filter and the gate is a different
 * one); every `.zap/rules.tsv` entry with its reason, an OUTOFSCOPE entry
 * anchored to named URLs of the scan's own target; and every `.trivyignore`
 * entry with an expiry inside the deferral window and a reason above it.
 *
 * Pattern from inflect-compliance `tests/guardrails/dast-workflow-pinning.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, which rewrote a check that
 * grepped for the shape of a date and so could never fire. This one parses
 * the date, is exercised against fixed clocks, takes its population from git
 * and proves its detectors against planted input.
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

/** The scan's own target (dast.yml); an OUTOFSCOPE regex names URLs on it and nothing wider. */
const ZAP_TARGET = 'http://localhost:3106';

/**
 * What is wrong with a `.zap/rules.tsv`. An IGNORE/WARN/FAIL line carries its
 * reason in the third column. An OUTOFSCOPE line's third column is the URL
 * regex ZAP reads, so its reason is the comment block directly above it (other
 * OUTOFSCOPE lines of the same rule may sit between), and the regex must be
 * anchored at both ends on the scan's target: an unanchored or wider one would
 * excuse the rule far beyond the URLs the reason was written for.
 */
export function zapRuleProblems(text: string): string[] {
    const lines = text.split('\n');
    const problems: string[] = [];
    let entries = 0;
    lines.forEach((line, i) => {
        if (!line.trim() || line.startsWith('#')) return;
        entries += 1;
        const [id = '', action = '', third = ''] = line.split('\t');
        const where = `line ${i + 1} (${id})`;
        if (!/^\d+(,\d+)*$/.test(id)) problems.push(`${where}: not a plugin id`);
        if (action === 'OUTOFSCOPE') {
            if (!third.startsWith(`^${ZAP_TARGET}/`)) problems.push(`${where}: OUTOFSCOPE regex must start ^${ZAP_TARGET}/`);
            if (!third.endsWith('$') || /\.\*|\.\+/.test(third)) problems.push(`${where}: OUTOFSCOPE regex must name whole URLs (end with $, no .* or .+)`);
            try {
                new RegExp(third);
            } catch {
                problems.push(`${where}: OUTOFSCOPE regex does not compile`);
            }
            let j = i - 1;
            while (j >= 0 && (lines[j] ?? '').split('\t')[1] === 'OUTOFSCOPE' && (lines[j] ?? '').split('\t')[0] === id) j -= 1;
            const reason: string[] = [];
            while (j >= 0 && (lines[j] ?? '').startsWith('#')) reason.unshift((lines[j--] ?? '').slice(1));
            const said = reason.join(' ');
            if (said.length < 80 || !said.includes(id)) problems.push(`${where}: OUTOFSCOPE needs a reason comment directly above it that names ${id}`);
        } else if (!/^(IGNORE|WARN|FAIL)$/.test(action)) {
            problems.push(`${where}: action ${action || '(none)'} is not IGNORE, WARN, FAIL or OUTOFSCOPE`);
        } else if (third.trim().length <= 20) {
            problems.push(`${where}: needs a reason in the third column`);
        }
    });
    if (entries === 0) problems.push('no entries');
    return problems;
}

/**
 * What is wrong with a `.trivyignore`. An entry is allowed only for a finding
 * that cannot be fixed yet, so it expires (`exp:YYYY-MM-DD`, Trivy stops
 * honouring it after that day) within the deferral window, and the comment
 * directly above it says why. Without an expiry an excuse outlives its reason.
 */
export function trivyIgnoreProblems(text: string, now: Date): string[] {
    const lines = text.split('\n');
    const problems: string[] = [];
    lines.forEach((line, i) => {
        if (!line.trim() || line.startsWith('#')) return;
        const where = `line ${i + 1}`;
        const m = /^(CVE-\d{4}-\d+|GHSA(?:-[0-9a-z]{4}){3}|AVD-[A-Z]+-\d+)\s+exp:(\d{4}-\d{2}-\d{2})\s*$/.exec(line.trim());
        if (!m) {
            problems.push(`${where}: an entry is one vulnerability id and exp:YYYY-MM-DD`);
            return;
        }
        const verdict = deferralVerdict(m[2] as string, now);
        if (verdict !== 'active') problems.push(`${where}: ${m[1]} expiry ${m[2]} is ${verdict}`);
        const above = lines[i - 1] ?? '';
        if (!above.startsWith('#') || above.slice(1).trim().length <= 20) problems.push(`${where}: ${m[1]} needs a reason comment directly above it`);
    });
    return problems;
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

    it('scan for CRITICAL and HIGH, both, with fixes available, and keep a SARIF report to those severities', () => {
        for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
            const wf = yaml.load(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')) as Workflow;
            const trivy = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []).filter((s) => kindOf(s) === 'TRIVY');
            for (const s of trivy) {
                // trivy-action unsets the severity filter for SARIF unless told
                // not to, and then exit-code "1" would gate on every severity.
                const sarifLimited = s.with?.format !== 'sarif' || truthy(s.with?.['limit-severities-for-sarif']);
                expect({ file, step: s.name, severity: s.with?.severity, fixedOnly: truthy(s.with?.['ignore-unfixed']), sarifLimited }).toEqual({
                    file,
                    step: s.name,
                    severity: 'CRITICAL,HIGH',
                    fixedOnly: true,
                    sarifLimited: true,
                });
            }
        }
    });

    it('give every ZAP allowlist entry a reason, and scope every OUTOFSCOPE entry to named URLs', () => {
        expect(zapRuleProblems(fs.readFileSync(path.join(REPO_ROOT, '.zap/rules.tsv'), 'utf8'))).toEqual([]);
    });

    it('expire every .trivyignore entry inside the deferral window, each with its reason', () => {
        const ignoreFiles = gitFiles(REPO_ROOT).filter((f) => path.posix.basename(f).startsWith('.trivyignore'));
        for (const file of ignoreFiles) {
            expect({ file, problems: trivyIgnoreProblems(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'), new Date()) }).toEqual({
                file,
                problems: [],
            });
        }
    });
});

describe('the allowlist checkers, against planted input', () => {
    const now = new Date('2026-11-26T10:00:00Z');
    const reason = '# 10044 Big Redirect: out of scope on the root redirect only, because the body is the public shell, checked.';

    it('pass a reasoned IGNORE and a reasoned, anchored OUTOFSCOPE', () => {
        expect(
            zapRuleProblems(
                [
                    '10109\tIGNORE\tModern Web Application: informational, not a finding.',
                    reason,
                    '10044\tOUTOFSCOPE\t^http://localhost:3106/?$',
                    '10044\tOUTOFSCOPE\t^http://localhost:3106/tenants$',
                ].join('\n'),
            ),
        ).toEqual([]);
    });

    it('refuse an IGNORE without a reason, an unknown action, and OUTOFSCOPE entries that are unexplained or too wide', () => {
        expect(
            zapRuleProblems(
                [
                    '10109\tIGNORE\tshort',
                    '10038\tSKIP\tCSP header not set on static files, a long enough reason.',
                    '10044\tOUTOFSCOPE\t^http://localhost:3106/$',
                    reason,
                    '10044\tOUTOFSCOPE\t^http://localhost:3106/.*$',
                    reason.replace('10044', '10096'),
                    '10044\tOUTOFSCOPE\thttp://localhost:3106/login',
                ].join('\n'),
            ),
        ).toEqual([
            'line 1 (10109): needs a reason in the third column',
            'line 2 (10038): action SKIP is not IGNORE, WARN, FAIL or OUTOFSCOPE',
            'line 3 (10044): OUTOFSCOPE needs a reason comment directly above it that names 10044',
            'line 5 (10044): OUTOFSCOPE regex must name whole URLs (end with $, no .* or .+)',
            'line 7 (10044): OUTOFSCOPE regex must start ^http://localhost:3106/',
            'line 7 (10044): OUTOFSCOPE regex must name whole URLs (end with $, no .* or .+)',
            'line 7 (10044): OUTOFSCOPE needs a reason comment directly above it that names 10044',
        ]);
        expect(zapRuleProblems('# only a comment\n')).toEqual(['no entries']);
    });

    it('pass a reasoned .trivyignore entry that expires inside the window, and refuse the rest', () => {
        const why = '# no fixed package in Alpine 3.23 yet; the library is not loaded by the app';
        expect(trivyIgnoreProblems([why, 'CVE-2026-1234 exp:2026-12-20'].join('\n'), now)).toEqual([]);
        expect(
            trivyIgnoreProblems(
                ['CVE-2026-1 exp:2026-12-20', why, 'CVE-2026-2', why, 'CVE-2026-3 exp:2026-11-01', why, 'CVE-2026-4 exp:2027-06-01'].join('\n'),
                now,
            ),
        ).toEqual([
            'line 1: CVE-2026-1 needs a reason comment directly above it',
            'line 3: an entry is one vulnerability id and exp:YYYY-MM-DD',
            'line 5: CVE-2026-3 expiry 2026-11-01 is expired',
            'line 7: CVE-2026-4 expiry 2027-06-01 is unreasonable',
        ]);
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
