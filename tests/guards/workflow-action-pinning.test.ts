/**
 * Every third-party action is pinned to a full commit SHA (CodeQL's
 * "unpinned third-party action" alerts on PR #26, 2026-11-19).
 *
 * A tag can be moved by whoever controls the action's repository, and a
 * workflow that runs a moved tag runs code nobody here reviewed, with the
 * job's token: `release.yml` holds `packages: write`. So a `uses:` outside
 * `actions/*` names a 40-hex commit, with the tag it was read from in a
 * trailing comment (`owner/action@<sha> # vX.Y.Z`), which is what Dependabot's
 * github-actions updates keep in step. `actions/*` (GitHub's own) stay on
 * their major tags, as this repository's workflows always had them; a local
 * action (`./…`) is part of the commit; a `docker://` image must name a
 * digest.
 *
 * The population is every git-listed workflow and composite action, so a new
 * workflow is held from its first commit. The detector proves itself against
 * a planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

const WORKFLOW_FILE = /^\.github\/(?:workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/;
const USES_LINE = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)['"]?\s*(?:#\s*(\S+))?/;
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/;
const TAG_COMMENT = /^v?\d+(?:\.\d+){0,2}\S*$/;

interface Finding {
    readonly file: string;
    readonly line: number;
    readonly uses: string;
    readonly problem: string;
}

function check(root: string): { files: string[]; uses: number; findings: Finding[] } {
    const files = gitFiles(root).filter((f) => WORKFLOW_FILE.test(f));
    const findings: Finding[] = [];
    let uses = 0;
    for (const file of files) {
        fs.readFileSync(path.join(root, file), 'utf8')
            .split('\n')
            .forEach((text, index) => {
                if (/^\s*#/.test(text)) return;
                const match = USES_LINE.exec(text);
                if (!match) return;
                uses += 1;
                const ref = match[1] as string;
                const comment = match[2];
                const at = { file, line: index + 1, uses: ref };
                if (ref.startsWith('./')) return;
                if (ref.startsWith('docker://')) {
                    if (!/@sha256:[0-9a-f]{64}$/.test(ref)) findings.push({ ...at, problem: 'a docker:// image without a digest' });
                    return;
                }
                if (ref.startsWith('actions/')) return;
                if (!PINNED.test(ref)) findings.push({ ...at, problem: 'not pinned to a 40-hex commit SHA' });
                else if (!comment || !TAG_COMMENT.test(comment)) findings.push({ ...at, problem: 'no trailing # <tag> comment' });
            });
    }
    return { files, uses, findings };
}

describe('workflow actions in this repository', () => {
    const report = check(REPO_ROOT);

    it('reads every workflow from git, and finds the third-party actions in them', () => {
        expect(report.files).toEqual(
            expect.arrayContaining(['.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/dast.yml']),
        );
        expect(report.uses).toBeGreaterThan(20);
    });

    it('pins every third-party action to a commit SHA, with its tag in a comment', () => {
        expect(report.findings).toEqual([]);
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;
    const plant = (rel: string, content: string) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), content);
    };
    const SHA = 'c3c9e263c25d99ce0380d002d59b67737d91b0dc';

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-action-pinning-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        plant('.gitignore', '.github/workflows/ignored.yml\n');
        plant(
            '.github/workflows/w.yml',
            [
                'jobs:',
                '  a:',
                '    steps:',
                '      - uses: actions/checkout@v7',
                '      # - uses: commented/out@v1',
                '      - uses: docker/build-push-action@v7',
                `      - uses: docker/login-action@${SHA}`,
                `      - uses: docker/setup-buildx-action@${SHA.slice(0, 12)} # v4.4.1`,
                `      - uses: 'aquasecurity/trivy-action@${SHA}' # v0.36.0`,
                '      - uses: ./.github/actions/local',
                '      - uses: docker://alpine:3.22',
                `      - name: x\n        uses: github/codeql-action/upload-sarif@${SHA} # v4.39.3`,
                '',
            ].join('\n'),
        );
        plant('.github/actions/local/action.yml', 'runs:\n  using: composite\n  steps:\n    - uses: someone/thing@main\n');
        plant('.github/workflows/ignored.yml', 'jobs:\n  a:\n    steps:\n      - uses: evil/action@v1\n');
        plant('docs/example.yml', 'steps:\n  - uses: not/a-workflow@v1\n');
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reports each unpinned or uncommented third-party action, and nothing else', () => {
        const report = check(root);
        expect(report.files).toEqual(['.github/actions/local/action.yml', '.github/workflows/w.yml']);
        expect(report.findings.map((f) => `${f.file}:${f.line} ${f.uses} — ${f.problem}`)).toEqual([
            '.github/actions/local/action.yml:4 someone/thing@main — not pinned to a 40-hex commit SHA',
            '.github/workflows/w.yml:6 docker/build-push-action@v7 — not pinned to a 40-hex commit SHA',
            `.github/workflows/w.yml:7 docker/login-action@${SHA} — no trailing # <tag> comment`,
            `.github/workflows/w.yml:8 docker/setup-buildx-action@${SHA.slice(0, 12)} — not pinned to a 40-hex commit SHA`,
            '.github/workflows/w.yml:11 docker://alpine:3.22 — a docker:// image without a digest',
        ]);
    });
});
