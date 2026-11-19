/**
 * The third-party intake gate, scripts/licence-gate.mjs (roadmap 0.3, H0).
 *
 * Three layers:
 *   - the pure rules: licence normalisation, the allowlist, exemptions, the
 *     production-tree walk and the import scan, called directly;
 *   - the same rules over fixtures in tests/fixtures/licence-gate/, including
 *     the planted GPL-3.0 dependency H0 asks for;
 *   - the real command line, run with node against throwaway git
 *     repositories, so the exit status CI relies on is what is tested.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Exemption, GateReport, PackageRecord } from '../../scripts/licence-gate.mjs';
import {
    adrStatusLine,
    ALLOWED_LICENCES,
    checkDependencies,
    declarationKey,
    DENIED_PACKAGES,
    devOnlyEntry,
    extractMdxSpecifiers,
    extractStyleSpecifiers,
    GateError,
    hasEePath,
    isAcceptedAdr,
    isDeniedPackage,
    isScannedSourcePath,
    judgePackage,
    listProductionPackages,
    listSourceFiles,
    NOTICE_LICENCES,
    normaliseDeclaration,
    parseJsonc,
    scanSources,
    scanSourceText,
    validateExemptions,
} from '../../scripts/licence-gate.mjs';
import { gitEnvFor, REPO_ROOT } from '../helpers/git-files';

const GATE = path.join(REPO_ROOT, 'scripts/licence-gate.mjs');
const FIXTURES = path.join(REPO_ROOT, 'tests/fixtures/licence-gate');
const FIXTURE_ROOT = path.join(FIXTURES, 'root');
const FIXTURE_ADR = 'docs/adr/0099-fixture-exemption.md';
const UNRELATED_ADR = 'docs/adr/0098-fixture-unrelated.md';
const PROPOSED_ADR = 'docs/adr/0097-fixture-proposed.md';

type LockEntry = Record<string, unknown>;
interface Lock {
    lockfileVersion: number;
    packages: Record<string, LockEntry>;
}

function readFixture(relative: string): string {
    return fs.readFileSync(path.join(FIXTURES, relative), 'utf8');
}

function lockfile(name: string): Lock {
    return JSON.parse(readFixture(`lockfiles/${name}.lock.json`)) as Lock;
}

function entry(lock: Lock, location: string): LockEntry {
    const found = lock.packages[location];
    if (!found) throw new Error(`fixture has no ${location}`);
    return found;
}

function judge(manifest: unknown, name = 'fixture-lib', exemptions = new Map<string, Exemption>()) {
    return judgePackage(
        { name, version: '1.0.0', location: `node_modules/${name}`, declaration: normaliseDeclaration(manifest) },
        exemptions,
    );
}

function record(report: { packages: PackageRecord[] }, name: string): PackageRecord {
    const found = report.packages.find((p) => p.name === name);
    if (!found) throw new Error(`${name} was not checked`);
    return found;
}

describe('licence declarations', () => {
    const plain = ALLOWED_LICENCES.filter((id) => !(id in NOTICE_LICENCES));

    it.each(plain)('passes %s, matching the identifier case-insensitively', (id) => {
        expect(judge({ license: id })).toMatchObject({ verdict: 'pass', relied: [id], notices: [] });
        expect(judge({ license: id.toLowerCase() }).verdict).toBe('pass');
        expect(normaliseDeclaration({ license: id.toUpperCase() })).toMatchObject({ kind: 'spdx', expression: id });
    });

    it.each([
        'GPL-3.0',
        'GPL-3.0-only',
        'GPL-2.0-or-later',
        'AGPL-3.0-or-later',
        'LGPL-3.0-or-later',
        'BUSL-1.1',
        'SSPL-1.0',
        'Elastic-2.0',
        'EPL-2.0',
        'BSD-4-Clause',
        'CC-BY-SA-4.0',
    ])('fails %s, which is not on the allowlist', (id) => {
        const result = judge({ license: id });
        expect(result).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
        expect(result.reason).toContain(`${id} is not on the allowlist`);
    });

    it('passes an OR expression when any branch is allowed', () => {
        expect(judge({ license: '(MIT OR GPL-3.0)' })).toMatchObject({ verdict: 'pass', relied: ['MIT'] });
        expect(judge({ license: 'GPL-3.0 OR Apache-2.0' })).toMatchObject({ verdict: 'pass', relied: ['Apache-2.0'] });
    });

    it('fails an OR expression when no branch is allowed', () => {
        const result = judge({ license: '(GPL-3.0 OR AGPL-3.0-only)' });
        expect(result).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
        expect(result.reason).toContain('no alternative is allowed');
    });

    it('fails an AND expression when any part is not allowed', () => {
        const result = judge({ license: '(MIT AND GPL-3.0)' });
        expect(result).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
        expect(result.reason).toBe('GPL-3.0 is not on the allowlist');
    });

    it('passes an AND expression whose parts are all allowed', () => {
        expect(judge({ license: '(MIT AND ISC)' })).toMatchObject({ verdict: 'pass', relied: ['MIT', 'ISC'] });
    });

    it('binds AND tighter than OR, and honours parentheses', () => {
        // MIT OR (GPL-3.0 AND AGPL-3.0-only): the MIT branch suffices.
        expect(judge({ license: 'MIT OR GPL-3.0 AND AGPL-3.0-only' }).verdict).toBe('pass');
        expect(judge({ license: '(MIT OR GPL-3.0) AND AGPL-3.0-only' }).verdict).toBe('fail');
        expect(judge({ license: '((ISC AND (MIT OR GPL-2.0-only)))' }).verdict).toBe('pass');
        expect(normaliseDeclaration({ license: '((MIT OR ISC))' })).toMatchObject({ expression: 'MIT OR ISC' });
        expect(normaliseDeclaration({ license: '(MIT OR ISC) AND 0BSD' })).toMatchObject({ expression: '(MIT OR ISC) AND 0BSD' });
    });

    it.each(['CC0-1.0', 'MIT-0', 'Python-2.0', 'CC-BY-4.0', 'EPL-2.0'])(
        'fails %s: the allowlist is roadmap 0.3\'s list plus 0BSD, the Unlicense and BlueOak-1.0.0, and anything else needs an exemption (ADR 0007 E4)',
        (id) => {
            expect(judge({ license: id })).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
        },
    );

    it('passes 0BSD, which the owner added to the allowlist on 2026-11-18 (ADR 0007 E2b), so tslib needs no exemption', () => {
        expect(judge({ license: '0BSD' }, 'tslib')).toMatchObject({ verdict: 'pass', relied: ['0BSD'], notices: [] });
        expect(judge({ license: '0bsd' }, 'tslib').verdict).toBe('pass');
    });

    it('reads WITH as adding permissions to an allowed licence, never as making one allowed', () => {
        expect(judge({ license: 'Apache-2.0 WITH LLVM-exception' }).verdict).toBe('pass');
        expect(judge({ license: 'Apache-2.0 WITH llvm-exception' }).verdict).toBe('pass');
        expect(judge({ license: 'GPL-2.0-only WITH Classpath-exception-2.0' })).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
    });

    it('fails "MIT WITH Commons-Clause", task-master\'s declaration, by name (roadmap 2.5)', () => {
        for (const text of ['MIT WITH Commons-Clause', 'Apache-2.0 WITH commons-clause']) {
            const result = judge({ license: text });
            expect(result).toMatchObject({ verdict: 'fail', code: 'UNKNOWN_EXCEPTION' });
            expect(result.reason).toContain('Commons Clause is not an SPDX exception');
        }
    });

    it.each(['MIT WITH No-SaaS-Use', 'MIT WITH LicenseRef-NoHosting', 'ISC WITH Anything-I-Like'])(
        'fails "%s": only an exception known to add permissions may follow WITH',
        (text) => {
            const result = judge({ license: text });
            expect(result).toMatchObject({ verdict: 'fail', code: 'UNKNOWN_EXCEPTION' });
            expect(result.reason).toContain('not an SPDX exception that only adds permissions');
        },
    );

    it('passes an OR whose other branch is allowed, and fails an AND that needs the refused exception', () => {
        expect(judge({ license: 'MIT WITH Commons-Clause OR Apache-2.0' })).toMatchObject({ verdict: 'pass', relied: ['Apache-2.0'] });
        expect(judge({ license: 'ISC AND MIT WITH Commons-Clause' })).toMatchObject({ verdict: 'fail', code: 'UNKNOWN_EXCEPTION' });
        // A disallowed base licence is reported as that, whatever follows WITH.
        expect(judge({ license: 'GPL-3.0-only WITH Commons-Clause' })).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
    });

    it('reads "+" as "or later", allowed only when the base licence is', () => {
        expect(judge({ license: 'Apache-2.0+' }).verdict).toBe('pass');
        const result = judge({ license: 'GPL-2.0+' });
        expect(result).toMatchObject({ verdict: 'fail' });
        expect(result.reason).toContain('GPL-2.0+ is not on the allowlist');
    });

    it.each([
        'MIT OR',
        '(MIT',
        'MIT)',
        'AND MIT',
        'MIT AND AND ISC',
        'MIT/Apache-2.0',
        'Apache 2.0',
        'MIT, ISC',
        'MIT WITH',
        '(MIT OR ISC) WITH LLVM-exception',
        '()',
    ])('fails "%s", which is not a valid SPDX expression', (text) => {
        expect(judge({ license: text })).toMatchObject({ verdict: 'fail', code: 'INVALID' });
    });

    it('says why a lower-case operator is refused', () => {
        expect(normaliseDeclaration({ license: 'MIT or ISC' })).toMatchObject({ kind: 'invalid', error: 'the operator "or" must be upper case' });
    });

    it('fails a custom LicenseRef, however it is spelled', () => {
        const result = judge({ license: 'LicenseRef-Proprietary' });
        expect(result).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
        expect(result.reason).toContain('custom licence reference');
    });

    it.each(['SEE LICENSE IN LICENSE.md', 'see license in EULA.txt', 'SEE LICENCE IN terms.md'])(
        'fails "%s" until a person reads the file and records it',
        (text) => {
            const result = judge({ license: text });
            expect(result).toMatchObject({ verdict: 'fail', code: 'SEE_LICENCE_IN' });
            expect(result.reason).toContain('scripts/licence-exemptions.json');
        },
    );

    it('fails UNLICENSED, and tells it apart from the Unlicense', () => {
        expect(judge({ license: 'UNLICENSED' })).toMatchObject({ verdict: 'fail', code: 'UNLICENSED' });
        expect(judge({ license: 'unlicensed' })).toMatchObject({ verdict: 'fail', code: 'UNLICENSED' });
        expect(judge({ license: 'Unlicense' })).toMatchObject({ verdict: 'pass', relied: ['Unlicense'] });
    });

    it('passes the Unlicense, which the owner added to the allowlist on 2026-11-19 (ADR 0007 E6)', () => {
        expect(judge({ license: 'Unlicense' }, 'robust-predicates')).toMatchObject({ verdict: 'pass', relied: ['Unlicense'], notices: [] });
        expect(judge({ license: 'unlicense' }, 'robust-predicates').verdict).toBe('pass');
    });

    it.each([[{}], [{ license: null }], [{ license: '' }], [{ license: '   ' }], [undefined], [null]])(
        'fails a missing licence: %j',
        (manifest) => {
            expect(judge(manifest)).toMatchObject({ verdict: 'fail', code: 'MISSING' });
        },
    );

    it('fails a licence that is not text', () => {
        expect(judge({ license: 42 })).toMatchObject({ verdict: 'fail', code: 'INVALID' });
    });

    it('passes MPL-2.0 with a notice that it is for unmodified use', () => {
        const result = judge({ license: 'MPL-2.0' });
        expect(result.verdict).toBe('pass');
        expect(result.notices).toEqual([expect.objectContaining({ code: 'NOTICE_MPL-2.0', message: expect.stringContaining('unmodified') })]);
    });

    it('prefers a branch without MPL, so the notice lists only packages that rely on it', () => {
        expect(judge({ license: '(MPL-2.0 OR Apache-2.0)' })).toMatchObject({ verdict: 'pass', relied: ['Apache-2.0'], notices: [] });
    });

    it('holds exactly roadmap 0.3\'s licences, with BSD read as the 2- and 3-clause forms, plus 0BSD (ADR 0007 E2b)', () => {
        expect([...ALLOWED_LICENCES].sort()).toEqual(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0', 'ISC', 'MIT', 'MPL-2.0', 'PostgreSQL', 'Unlicense']);
    });

    it('compares expressions by meaning, not spelling', () => {
        const key = (text: string) => declarationKey(normaliseDeclaration({ license: text }));
        expect(key('(MIT OR ISC)')).toBe(key('isc OR mit'));
        expect(key('MIT AND (ISC OR 0BSD)')).toBe(key('(0bsd OR ISC) AND MIT'));
        expect(key('MIT')).not.toBe(key('MIT OR ISC'));
    });
});

describe('legacy licence forms', () => {
    it('reads a { type } object as its type', () => {
        expect(normaliseDeclaration({ license: { type: 'MIT', url: 'https://example.invalid' } })).toMatchObject({
            kind: 'spdx',
            expression: 'MIT',
            legacy: 'license-object',
        });
        expect(judge({ license: { type: 'GPL-3.0' } })).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
        expect(judge({ license: { url: 'https://example.invalid' } })).toMatchObject({ verdict: 'fail', code: 'INVALID' });
    });

    it('reads a licenses array as an OR of its entries, as npm documents, and says so', () => {
        expect(normaliseDeclaration({ licenses: [{ type: 'MIT' }, { type: 'GPL-3.0' }] })).toMatchObject({
            kind: 'spdx',
            expression: 'MIT OR GPL-3.0',
            legacy: 'licenses-array',
        });
        const result = judge({ licenses: [{ type: 'GPL-3.0' }, { type: 'Apache-2.0' }] });
        expect(result).toMatchObject({ verdict: 'pass', relied: ['Apache-2.0'] });
        expect(result.notices.map((n) => n.code)).toContain('LEGACY_DECLARATION');
        expect(judge({ licenses: [{ type: 'GPL-3.0' }] }).verdict).toBe('fail');
        expect(judge({ licenses: ['ISC', 'MIT'] }).verdict).toBe('pass');
        expect(judge({ licenses: { type: 'MIT' } }).verdict).toBe('pass');
        expect(normaliseDeclaration({ license: ['MIT', 'Apache-2.0'] })).toMatchObject({
            expression: 'MIT OR Apache-2.0',
            legacy: 'license-array',
        });
    });

    it('fails a legacy list it cannot read', () => {
        expect(judge({ licenses: [{}] })).toMatchObject({ verdict: 'fail', code: 'INVALID' });
        expect(judge({ licenses: ['SEE LICENSE IN LICENSE'] })).toMatchObject({ verdict: 'fail', code: 'INVALID' });
        expect(judge({ licenses: [] })).toMatchObject({ verdict: 'fail', code: 'MISSING' });
    });

    it('reads license before licenses, as npm does', () => {
        expect(judge({ license: 'GPL-3.0', licenses: [{ type: 'MIT' }] }).verdict).toBe('fail');
    });
});

describe('the production tree', () => {
    it('fails a planted GPL-3.0 production dependency, naming it and the path to it', () => {
        const report = checkDependencies(lockfile('planted-gpl'), { root: FIXTURE_ROOT });
        expect(report.failures).toEqual([
            expect.objectContaining({
                name: 'fixture-gpl-lib',
                version: '1.0.0',
                code: 'NOT_ALLOWED',
                declared: 'GPL-3.0',
                chain: ['fixture-mit-lib', 'fixture-gpl-lib'],
            }),
        ]);
        expect(report.packages.map((p) => p.name)).toEqual(['fixture-gpl-lib', 'fixture-mit-lib']);
    });

    it('passes GPL dependencies that only devDependencies reach', () => {
        const report = checkDependencies(lockfile('dev-only-gpl'), { root: FIXTURE_ROOT });
        expect(report.failures).toEqual([]);
        expect(report.packages.map((p) => p.name)).toEqual(['fixture-mit-lib']);
        expect(report.notices).toEqual([]);
    });

    describe('the shapes a lockfile takes', () => {
        const report = checkDependencies(lockfile('tree-shapes'), { root: FIXTURE_ROOT });

        it('checks optional, devOptional, peer, nested and aliased packages, and every platform binary', () => {
            expect(report.packages.map((p) => `${p.name}@${p.version} ${p.location}`)).toEqual([
                'fixture-real-name@2.0.0 node_modules/fixture-alias',
                'fixture-app-core@1.0.0 node_modules/fixture-app-core',
                'fixture-nested@2.0.0 node_modules/fixture-app-core/node_modules/fixture-nested',
                'fixture-dev-optional@1.0.0 node_modules/fixture-dev-optional',
                'fixture-native-darwin-arm64@1.0.0 node_modules/fixture-native-darwin-arm64',
                'fixture-native-linux-x64@1.0.0 node_modules/fixture-native-linux-x64',
                'fixture-optional-root@1.0.0 node_modules/fixture-optional-root',
                'fixture-peer@1.0.0 node_modules/fixture-peer',
                'fixture-shared@1.0.0 node_modules/fixture-shared',
                'fixture-ui-dep@1.0.0 node_modules/fixture-ui-dep',
                '@fixture/ported@1.0.0 packages/ported',
            ]);
        });

        it('resolves a dependency from the nearest node_modules, as Node does', () => {
            // fixture-app-core gets its own ISC 2.0.0; the GPL 1.0.0 at the top is a dev tool's.
            expect(record(report, 'fixture-nested')).toMatchObject({ version: '2.0.0', verdict: 'pass' });
            expect(report.packages.some((p) => p.location === 'node_modules/fixture-nested')).toBe(false);
        });

        it("does not follow the root's or a workspace's devDependencies", () => {
            for (const devOnly of ['fixture-dev-tool', 'fixture-ui-dev-only']) {
                expect(report.packages.some((p) => p.name === devOnly)).toBe(false);
            }
        });

        it('skips the root and a workspace of its own, and checks a workspace that declares another licence', () => {
            expect(report.skipped.map((s) => `${s.name} ${s.location}`)).toEqual(['fixture-app ', '@fixture/ui packages/ui']);
            expect(record(report, '@fixture/ported')).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED', declared: 'BUSL-1.1' });
            expect(report.failures.map((f) => f.name)).toEqual(['@fixture/ported']);
        });

        it('records the path production takes to each package', () => {
            expect(record(report, 'fixture-ui-dep').chain).toEqual(['@fixture/ui', 'fixture-ui-dep']);
            expect(record(report, 'fixture-native-darwin-arm64').chain).toEqual(['fixture-app-core', 'fixture-native-darwin-arm64']);
            expect(record(report, 'fixture-dev-optional').chain).toEqual(['fixture-app-core', 'fixture-dev-optional']);
        });

        it("agrees with npm's flags, and an absent optional dependency or optional peer is not a problem", () => {
            expect(report.notices).toEqual([]);
        });
    });

    it('checks a package production reaches even when the lockfile flags it dev-only', () => {
        const lock = lockfile('tree-shapes');
        Object.assign(entry(lock, 'node_modules/fixture-app-core/node_modules/fixture-nested'), { dev: true, license: 'GPL-3.0' });
        const report = checkDependencies(lock, { root: FIXTURE_ROOT });
        expect(record(report, 'fixture-nested')).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
        expect(report.notices.map((n) => n.code)).toContain('DEV_FLAG_CONTRADICTED');
    });

    it('checks a non-dev entry that nothing reaches, rather than trusting the walk alone', () => {
        const lock = lockfile('tree-shapes');
        lock.packages['node_modules/fixture-orphan'] = { version: '1.0.0', license: 'GPL-3.0' };
        const report = checkDependencies(lock, { root: FIXTURE_ROOT });
        expect(record(report, 'fixture-orphan')).toMatchObject({ verdict: 'fail', chain: null });
        expect(report.notices.map((n) => n.code)).toContain('FLAGGED_NOT_REACHED');
    });

    it('fails a production dependency the lockfile does not resolve', () => {
        const lock = lockfile('tree-shapes');
        delete lock.packages['node_modules/fixture-shared'];
        const report = checkDependencies(lock, { root: FIXTURE_ROOT });
        expect(report.failures).toContainEqual(
            expect.objectContaining({ code: 'UNRESOLVED', location: 'node_modules/fixture-app-core', reason: expect.stringContaining('fixture-shared') }),
        );
    });

    it('notices, but does not fail, a missing required peer', () => {
        const lock = lockfile('tree-shapes');
        delete lock.packages['node_modules/fixture-peer'];
        const report = checkDependencies(lock, { root: FIXTURE_ROOT });
        expect(report.notices.map((n) => n.code)).toEqual(['UNRESOLVED_PEER']);
        expect(report.failures.map((f) => f.name)).toEqual(['@fixture/ported']);
    });

    it('fails a link to a folder the lockfile does not describe', () => {
        const lock = lockfile('tree-shapes');
        Object.assign(entry(lock, 'node_modules/@fixture/ui'), { resolved: 'packages/missing' });
        const report = checkDependencies(lock, { root: FIXTURE_ROOT });
        expect(report.failures).toContainEqual(expect.objectContaining({ code: 'BROKEN_LINK', location: 'node_modules/@fixture/ui' }));
    });

    it('refuses a lockfile it cannot read the tree from', () => {
        expect(() => listProductionPackages({ lockfileVersion: 1, dependencies: {} })).toThrow(GateError);
        expect(() => listProductionPackages({ lockfileVersion: 3, packages: { 'node_modules/x': {} } })).toThrow('no root entry');
        expect(() => listProductionPackages([])).toThrow(GateError);
    });

    describe('the manifests on disk, not the lockfile alone', () => {
        /** package.json as npm would have written it beside this lockfile. */
        const honestManifests = (lock: Lock): Record<string, unknown> => ({ '': { ...entry(lock, '') } });
        const reader = (manifests: Record<string, unknown>) => (location: string) => manifests[location] ?? null;

        it('walks from package.json, and fails when the lockfile root entry was edited to hide a production dependency', () => {
            const honest = lockfile('planted-gpl');
            const manifests = honestManifests(honest);
            // The edit npm ci does not notice: the edge moves to devDependencies
            // in the lockfile and both packages are flagged dev-only.
            const tampered = lockfile('planted-gpl');
            Object.assign(entry(tampered, ''), { dependencies: undefined, devDependencies: { 'fixture-dev-tool': '1.0.0', 'fixture-mit-lib': '1.0.0' } });
            entry(tampered, 'node_modules/fixture-mit-lib').dev = true;
            entry(tampered, 'node_modules/fixture-gpl-lib').dev = true;

            expect(checkDependencies(tampered, { root: FIXTURE_ROOT }).failures).toEqual([]);
            const report = checkDependencies(tampered, { root: FIXTURE_ROOT, readManifest: reader(manifests) });
            expect(report.failures.map((f) => f.code).sort()).toEqual(['MANIFEST_LOCK_MISMATCH', 'NOT_ALLOWED']);
            expect(report.failures.find((f) => f.code === 'MANIFEST_LOCK_MISMATCH')?.reason).toContain('dependencies');
            expect(record(report, 'fixture-gpl-lib')).toMatchObject({ verdict: 'fail', chain: ['fixture-mit-lib', 'fixture-gpl-lib'] });
            expect(report.notices.map((n) => n.code)).toContain('DEV_FLAG_CONTRADICTED');
        });

        it('passes when package.json and the lockfile agree', () => {
            const lock = lockfile('dev-only-gpl');
            expect(checkDependencies(lock, { root: FIXTURE_ROOT, readManifest: reader(honestManifests(lock)) }).failures).toEqual([]);
        });

        it("judges a workspace by its own package.json, so a stale lockfile cannot pass a BUSL-1.1 workspace as Islestone's own", () => {
            const lock = lockfile('tree-shapes');
            const manifests = {
                ...honestManifests(lock),
                'packages/ui': { ...entry(lock, 'packages/ui'), license: 'BUSL-1.1' },
                'packages/ported': entry(lock, 'packages/ported'),
            };
            const report = checkDependencies(lock, { root: FIXTURE_ROOT, readManifest: reader(manifests) });
            expect(record(report, '@fixture/ui')).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED', declared: 'BUSL-1.1', licenceSource: 'workspace' });
            expect(report.failures).toContainEqual(
                expect.objectContaining({ code: 'MANIFEST_LOCK_MISMATCH', location: 'packages/ui', reason: expect.stringContaining('license') }),
            );
        });

        describe('a workspace that mirrors another project (it holds UPSTREAM.json)', () => {
            /** tree-shapes with the root and both workspaces on BUSL-1.1, as Islestone and a mirrored @inflect/ui are. */
            const buslTree = (uiLicence: string | null = 'BUSL-1.1'): Lock => {
                const lock = lockfile('tree-shapes');
                entry(lock, '').license = 'BUSL-1.1';
                if (uiLicence === null) delete entry(lock, 'packages/ui').license;
                else entry(lock, 'packages/ui').license = uiLicence;
                return lock;
            };
            const mirrorAt = (...locations: string[]) => (location: string) => locations.includes(location);

            it("skips a workspace that declares the root's licence when it holds no UPSTREAM.json: that is Islestone's own code", () => {
                const report = checkDependencies(buslTree(), { root: FIXTURE_ROOT });
                expect(report.skipped.map((s) => s.location)).toEqual(['', 'packages/ported', 'packages/ui']);
                expect(report.failures).toEqual([]);
            });

            it("checks a mirror like any dependency, even when it declares the root's licence, and says why", () => {
                const report = checkDependencies(buslTree(), { root: FIXTURE_ROOT, isUpstreamMirror: mirrorAt('packages/ui') });
                expect(record(report, '@fixture/ui')).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED', declared: 'BUSL-1.1', licenceSource: 'workspace' });
                expect(report.failures.map((f) => f.name)).toEqual(['@fixture/ui']);
                // The workspace without the file is still Islestone's own.
                expect(report.skipped.map((s) => s.location)).toEqual(['', 'packages/ported']);
                expect(report.notices).toEqual([expect.objectContaining({ code: 'UPSTREAM_MIRROR', message: expect.stringContaining('packages/ui') })]);
            });

            it('fails a mirror that declares no licence, rather than reading the silence as the root licence', () => {
                const report = checkDependencies(buslTree(null), { root: FIXTURE_ROOT, isUpstreamMirror: mirrorAt('packages/ui') });
                expect(record(report, '@fixture/ui')).toMatchObject({ verdict: 'fail', code: 'MISSING' });
            });

            it('passes a mirror through an exemption that cites an Accepted ADR, and not through one that cites a Proposed ADR', () => {
                const exemption = (adr: string) => ({ '@fixture/ui': { licence: 'BUSL-1.1', version: '0.0.0', reason: 'Fixture: mirrored package.', adr } });
                const options = { root: FIXTURE_ROOT, isUpstreamMirror: mirrorAt('packages/ui') };
                const accepted = checkDependencies(buslTree(), { ...options, exemptions: exemption(FIXTURE_ADR) });
                expect(record(accepted, '@fixture/ui').verdict).toBe('exempt');
                expect(accepted.failures).toEqual([]);
                expect(accepted.exemptionProblems).toEqual([]);
                const proposed = checkDependencies(buslTree(), { ...options, exemptions: exemption(PROPOSED_ADR) });
                expect(record(proposed, '@fixture/ui').verdict).toBe('fail');
                expect(proposed.exemptionProblems.map((p) => `${p.name} ${p.code}`)).toEqual(['@fixture/ui ADR_NOT_ACCEPTED']);
            });
        });

        it('fails a workspace on disk that the lockfile does not describe, and one the lockfile lists that is not on disk', () => {
            const lock = lockfile('tree-shapes');
            const manifests = { ...honestManifests(lock), 'packages/ui': entry(lock, 'packages/ui') };
            const report = checkDependencies(lock, { root: FIXTURE_ROOT, readManifest: reader(manifests), diskWorkspaces: ['packages/ui', 'packages/new'] });
            expect(report.failures.map((f) => `${f.code} ${f.location}`)).toEqual(
                expect.arrayContaining(['WORKSPACE_MISSING packages/ported', 'WORKSPACE_NOT_IN_LOCKFILE packages/new']),
            );
        });

        it('refuses to run without a root package.json', () => {
            expect(() => listProductionPackages(lockfile('planted-gpl'), { readManifest: () => null })).toThrow('no package.json');
        });
    });

    it('checks a dev-only package that shipped code imports, with the importing file at the head of its chain', () => {
        const lock = lockfile('dev-only-gpl');
        const report = checkDependencies(lock, { root: FIXTURE_ROOT, extraRoots: [{ location: 'node_modules/fixture-dev-gpl', from: 'src/app/page.tsx' }] });
        expect(record(report, 'fixture-dev-gpl')).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED', chain: ['src/app/page.tsx', 'fixture-dev-gpl'] });
        // What it depends on ships with it.
        expect(record(report, 'fixture-dev-gpl-helper')).toMatchObject({ verdict: 'fail', chain: ['src/app/page.tsx', 'fixture-dev-gpl', 'fixture-dev-gpl-helper'] });
        expect(report.notices.map((n) => n.code)).toEqual(['DEV_DEPENDENCY_BUNDLED']);
    });

    it('fails a deny-listed package in the tree whatever its licence says, and no exemption lifts it', () => {
        expect(DENIED_PACKAGES).toEqual(expect.arrayContaining(['n8n', 'n8n-*', '@n8n/*', 'hyperformula', '@blocknote/xl-*', 'task-master-ai', 'windmill-components']));
        const lock = lockfile('planted-gpl');
        Object.assign(entry(lock, ''), { dependencies: { hyperformula: '1.0.0', '@blocknote/xl-ai': '1.0.0' } });
        lock.packages['node_modules/hyperformula'] = { version: '1.0.0', license: 'MIT' };
        lock.packages['node_modules/@blocknote/xl-ai'] = { version: '1.0.0', license: 'MIT' };
        const exemptions = { hyperformula: { licence: 'MIT', reason: 'Tried to exempt a deny-listed package.', adr: FIXTURE_ADR } };
        const report = checkDependencies(lock, { root: FIXTURE_ROOT, exemptions });
        expect(report.failures.map((f) => `${f.name} ${f.code}`).sort()).toEqual([
            '@blocknote/xl-ai DENY_LISTED',
            'fixture-gpl-lib NOT_ALLOWED',
            'hyperformula DENY_LISTED',
        ]);
    });
});

describe('licences read from node_modules', () => {
    const manifests = JSON.parse(readFixture('installed-manifests.json')) as Record<string, unknown>;
    const readInstalled = (location: string) => manifests[location] ?? null;
    const report = checkDependencies(lockfile('installed-fallback'), { root: FIXTURE_ROOT, readInstalled });

    it('reads a licence the lockfile lacks from the installed manifest, legacy array included', () => {
        expect(record(report, 'fixture-no-licence-recorded')).toMatchObject({
            verdict: 'pass',
            licenceSource: 'installed',
            declared: 'MIT OR Apache-2.0',
        });
        const codes = report.notices.map((n) => n.code);
        expect(codes).toContain('LICENCE_FROM_INSTALLED');
        expect(codes).toContain('LEGACY_DECLARATION');
    });

    it('fails a package whose licence is in neither place', () => {
        expect(record(report, 'fixture-no-licence-anywhere')).toMatchObject({ verdict: 'fail', code: 'MISSING', licenceSource: 'none' });
    });

    it('does not trust an installed manifest of another version', () => {
        expect(record(report, 'fixture-stale-install')).toMatchObject({ verdict: 'fail', code: 'MISSING' });
        expect(report.notices.map((n) => n.code)).toContain('STALE_NODE_MODULES');
    });

    it('fails when the installed manifest contradicts the lockfile', () => {
        const tampered = record(report, 'fixture-tampered');
        expect(tampered).toMatchObject({ verdict: 'fail', code: 'LICENCE_MISMATCH' });
        expect(tampered.reason).toContain('"MIT"');
        expect(tampered.reason).toContain('"GPL-3.0-only"');
    });

    it('accepts the { type } object that npm wrote to the lockfile as its type', () => {
        expect(record(report, 'fixture-object-licence')).toMatchObject({ verdict: 'pass', licenceSource: 'lockfile' });
    });
});

describe('exemptions', () => {
    const valid = {
        licence: 'GPL-3.0',
        reason: 'Fixture: LICENSE read at 1.0.0; used unmodified.',
        adr: FIXTURE_ADR,
    };
    const check = (exemptions: unknown) => checkDependencies(lockfile('planted-gpl'), { root: FIXTURE_ROOT, exemptions });

    it('exempts a package when the entry gives a reason and an ADR that exists', () => {
        const report = check({ 'fixture-gpl-lib': valid });
        expect(report.failures).toEqual([]);
        expect(report.exemptionProblems).toEqual([]);
        expect(report.exempted).toEqual([expect.objectContaining({ name: 'fixture-gpl-lib', licence: 'GPL-3.0', adr: FIXTURE_ADR })]);
        expect(record(report, 'fixture-gpl-lib').verdict).toBe('exempt');
    });

    it.each<[string, Record<string, unknown>, string]>([
        ['no reason', { licence: 'GPL-3.0', adr: FIXTURE_ADR }, '"reason" is required'],
        ['a blank reason', { ...valid, reason: '   ' }, '"reason" is required'],
        ['no adr', { licence: 'GPL-3.0', reason: valid.reason }, '"adr" is required'],
        ['an adr that does not exist', { ...valid, adr: 'docs/adr/0042-missing.md' }, 'which does not exist'],
        ['an adr outside docs/adr', { ...valid, adr: 'README.md' }, 'must be a repository path'],
        ['an adr path that climbs out', { ...valid, adr: 'docs/adr/../../x.md' }, 'must be a repository path'],
        ['an adr that does not name the package', { ...valid, adr: UNRELATED_ADR }, 'does not mention fixture-gpl-lib'],
        ['no licence', { reason: valid.reason, adr: FIXTURE_ADR }, '"licence" is required'],
        ['a licence that is not SPDX', { ...valid, licence: 'GPL v3' }, 'not an SPDX expression'],
        ['an unknown field', { ...valid, reviewBy: '2027-01-01' }, 'unknown field "reviewBy"'],
        ['a blank version', { ...valid, version: '' }, '"version"'],
        ['an empty version list', { ...valid, version: [] }, '"version"'],
        ['a blank entry in the version list', { ...valid, version: ['1.0.0', ' '] }, '"version"'],
        ['a version listed twice', { ...valid, version: ['1.0.0', '1.0.0'] }, 'the same version twice'],
    ])('does not apply an exemption with %s', (_label, exemption, problem) => {
        const report = check({ 'fixture-gpl-lib': exemption });
        expect(report.failures.map((f) => f.name)).toEqual(['fixture-gpl-lib']);
        expect(report.exemptionProblems).toEqual([{ name: 'fixture-gpl-lib', code: 'EXEMPTION_INVALID', problem: expect.stringContaining(problem) }]);
    });

    it('refuses an exemptions file that is not one object', () => {
        const report = check([valid]);
        expect(report.exemptionProblems).toEqual([{ name: null, code: 'EXEMPTIONS_NOT_AN_OBJECT', problem: expect.stringContaining('one JSON object') }]);
        expect(report.failures.map((f) => f.name)).toEqual(['fixture-gpl-lib']);
    });

    it('binds an exemption to the licence it was granted for', () => {
        const moved = check({ 'fixture-gpl-lib': { ...valid, licence: 'GPL-2.0-only' } });
        expect(moved.failures[0]?.reason).toContain('the exemption does not apply: it records "GPL-2.0-only" but the package declares "GPL-3.0"');
        expect(check({ 'fixture-gpl-lib': { ...valid, licence: 'gpl-3.0' } }).failures).toEqual([]);
    });

    it('binds an exemption to a version when it names one', () => {
        expect(check({ 'fixture-gpl-lib': { ...valid, version: '1.0.0' } }).failures).toEqual([]);
        const upgraded = check({ 'fixture-gpl-lib': { ...valid, version: '0.9.0' } });
        expect(upgraded.failures[0]?.reason).toContain('bound to version 0.9.0 and the tree holds 1.0.0');
    });

    it('binds an exemption to a list of versions, each of which must be in the tree', () => {
        // The fixture tree holds fixture-gpl-lib at 1.0.0 only.
        expect(check({ 'fixture-gpl-lib': { ...valid, version: ['1.0.0'] } }).exemptionProblems).toEqual([]);
        const notListed = check({ 'fixture-gpl-lib': { ...valid, version: ['0.9.0', '0.8.0'] } });
        expect(notListed.failures[0]?.reason).toContain('bound to versions 0.9.0, 0.8.0 and the tree holds 1.0.0');
        const extra = check({ 'fixture-gpl-lib': { ...valid, version: ['1.0.0', '2.0.0'] } });
        expect(extra.failures).toEqual([]);
        expect(extra.exemptionProblems).toEqual([
            { name: 'fixture-gpl-lib', code: 'EXEMPTION_STALE', problem: expect.stringContaining('version 2.0.0 is not in the tree') },
        ]);
    });

    it('exempts each listed version of a package installed at several versions', () => {
        const { entries, errors } = validateExemptions(
            { 'fixture-lib': { licence: 'MIT', version: ['1.0.0', '2.0.0-alpha.0'], reason: 'Fixture: both versions read.', adr: FIXTURE_ADR } },
            FIXTURE_ROOT,
        );
        expect(errors).toEqual([]);
        const at = (version: string) =>
            judgePackage({ name: 'fixture-lib', version, location: 'node_modules/fixture-lib', declaration: normaliseDeclaration({ license: 'MIT and ISC' }) }, entries).verdict;
        expect(at('1.0.0')).toBe('exempt');
        expect(at('2.0.0-alpha.0')).toBe('exempt');
        expect(at('3.0.0')).toBe('fail');
    });

    it('exempts a "SEE LICENSE IN" package at the version whose file a person read', () => {
        const { entries, errors } = validateExemptions(
            { 'fixture-lib': { licence: 'MIT', version: '1.0.0', reason: 'Fixture: LICENSE.md at 1.0.0 holds the MIT text.', adr: FIXTURE_ADR } },
            FIXTURE_ROOT,
        );
        expect(errors).toEqual([]);
        expect(judge({ license: 'SEE LICENSE IN LICENSE.md' }, 'fixture-lib', entries).verdict).toBe('exempt');
        expect(judge({ license: 'SEE LICENSE IN LICENSE.md' }, 'other-lib', entries).verdict).toBe('fail');
    });

    it.each([
        ['SEE LICENSE IN NEW-TERMS.txt', 'SEE_LICENCE_IN'],
        ['UNLICENSED', 'UNLICENSED'],
        [null, 'MISSING'],
        ['GPL 3', 'INVALID'],
    ])('does not apply an unpinned exemption once the package declares %j, which it cannot be bound to', (declared, code) => {
        const { entries } = validateExemptions(
            { 'vendor-grid': { licence: 'LicenseRef-VendorGrid-EULA', reason: 'Fixture: EULA read at 2.0.0.', adr: FIXTURE_ADR } },
            FIXTURE_ROOT,
        );
        const result = judgePackage({ name: 'vendor-grid', version: '3.0.0', location: 'node_modules/vendor-grid', declaration: normaliseDeclaration({ license: declared }) }, entries);
        expect(result).toMatchObject({ verdict: 'fail', code });
        expect(result.reason).toContain('must name the "version"');
    });

    it('keeps applying an unpinned exemption while the package declares the SPDX licence it was granted for', () => {
        const { entries } = validateExemptions({ 'fixture-gpl-lib': valid }, FIXTURE_ROOT);
        const at = (license: string) =>
            judgePackage({ name: 'fixture-gpl-lib', version: '9.9.9', location: 'node_modules/fixture-gpl-lib', declaration: normaliseDeclaration({ license }) }, entries).verdict;
        expect(at('GPL-3.0')).toBe('exempt');
        expect(at('AGPL-3.0-only')).toBe('fail');
    });

    it('reports an exemption for a package the tree does not hold', () => {
        const report = check({ 'fixture-gpl-lib': valid, 'left-the-tree': { ...valid, licence: 'MIT' } });
        expect(report.exemptionProblems).toEqual([{ name: 'left-the-tree', code: 'EXEMPTION_STALE', problem: expect.stringContaining('stale') }]);
    });

    it('reports an exemption that is not needed', () => {
        const report = check({ 'fixture-gpl-lib': valid, 'fixture-mit-lib': { ...valid, licence: 'MIT' } });
        expect(report.exemptionProblems).toEqual([{ name: 'fixture-mit-lib', code: 'EXEMPTION_NOT_NEEDED', problem: expect.stringContaining('not needed') }]);
    });

    describe('the cited ADR must be Accepted', () => {
        it('does not apply an exemption whose ADR is Proposed, and says which status it found', () => {
            const report = check({ 'fixture-gpl-lib': { ...valid, adr: PROPOSED_ADR } });
            expect(report.exemptionProblems).toEqual([
                {
                    name: 'fixture-gpl-lib',
                    code: 'ADR_NOT_ACCEPTED',
                    problem: expect.stringContaining('whose status is "Status: Proposed — awaiting owner sign-off'),
                },
            ]);
            expect(report.failures).toEqual([expect.objectContaining({ name: 'fixture-gpl-lib', code: 'NOT_ALLOWED' })]);
            expect(report.exempted).toEqual([]);
        });

        it('applies the same exemption once it cites an Accepted ADR', () => {
            const report = check({ 'fixture-gpl-lib': valid });
            expect(report.exemptionProblems).toEqual([]);
            expect(report.exempted.map((e) => e.name)).toEqual(['fixture-gpl-lib']);
        });

        it('reports a Proposed ADR beside any other problem with the entry, each under its own code', () => {
            const report = check({ 'fixture-gpl-lib': { licence: 'GPL-3.0', adr: PROPOSED_ADR } });
            expect(report.exemptionProblems.map((p) => p.code)).toEqual(['EXEMPTION_INVALID', 'ADR_NOT_ACCEPTED']);
        });

        // What the status line says. Each case has the template's title, so only
        // the wording of the line decides.
        it.each<[string, boolean]>([
            ['Status: Accepted — Owner decision, 2026-11-18', true],
            ['Status: Accepted (owner decisions, 2026-11-18)', true],
            ['Status: Accepted', true],
            ['Status: Accepted.', true],
            ['Status: Accepted   ', true],
            ['Status: Proposed — awaiting owner sign-off (2026-11-18 drafted)', false],
            // Accepted with a qualifier that takes full acceptance away.
            ['Status: Accepted (superseded in part by 0009)', false],
            ['Status: Accepted — superseded by 0009', false],
            ['Status: Accepted — Superseded by 0009', false],
            ['Status: Accepted in part — D2 awaits sign-off', false],
            ['Status: Accepted (in part; D2 awaits sign-off)', false],
            ['Status: Accepted — partly', false],
            ['Status: Accepted (partially)', false],
            ['Status: Accepted (D2 pending)', false],
            ['Status: Accepted — D2 awaiting the owner', false],
            ['Status: Accepted — deprecated', false],
            // Not followed by end of line, " (", " —" or ".".
            ['Status: Accepted: no', false],
            ['Status: Accepted, then reopened', false],
            ['Status: Acceptedish', false],
            ['Status: Accepted-ish', false],
            ['Status: Accepted - owner decision', false],
            ['Status: Superseded by 0009', false],
            ['Status:Accepted', false],
            ['status: Accepted', false],
            [' Status: Accepted', false],
            ['**Status:** Accepted', false],
        ])('reads the status line %j as Accepted: %s', (line, accepted) => {
            expect(isAcceptedAdr(`# 0001 — T\n\n${line}\n\n## Context\n`)).toBe(accepted);
        });

        // Where the status line is. It is the first non-blank line after the
        // "# " title, and nowhere else; anything in that place hides nothing.
        it.each<[string, string, boolean]>([
            ['the template layout', '# 0001 — T\n\nStatus: Accepted — Owner decision, 2026-11-18\n', true],
            ['CRLF line endings', '# T\r\n\r\nStatus: Accepted\r\n\r\n## Context\r\n', true],
            ['a byte-order mark before the title', '﻿# T\n\nStatus: Accepted\n', true],
            ['no blank line after the title', '# T\nStatus: Accepted\n', true],
            ['a later Accepted line below the real Proposed one', '# T\n\nStatus: Proposed\n\nStatus: Accepted\n', false],
            ['no title', 'Status: Accepted\n', false],
            ['a level-two heading as the title', '## T\n\nStatus: Accepted\n', false],
            ['a paragraph before the status', '# T\n\nSome text.\n\nStatus: Accepted\n', false],
            ['a status only inside a fence', '# T\n\n```markdown\nStatus: Accepted\n```\n', false],
            ['a status only after a section heading', '# T\n\n## Context\n\nStatus: Accepted\n', false],
            ['a fence before the status', '# T\n\n~~~md\nStatus: Proposed\n~~~\n\nStatus: Accepted\n', false],
            // Three ways to hide an Accepted line above a visible Proposed one.
            ['an HTML comment above the real status', '# T\n\n<!--\nStatus: Accepted\n-->\nStatus: Proposed — awaiting owner sign-off\n', false],
            ['a one-line HTML comment as the status', '# T\n\n<!-- Status: Accepted -->\nStatus: Proposed\n', false],
            [
                'a fence whose "closing" line carries text, so it never closes',
                '# T\n\n```\n``` x\nStatus: Accepted\n```\n\nStatus: Proposed — awaiting owner sign-off\n',
                false,
            ],
            ['a setext heading, with no status line of its own', '# T\n\nContext\n-------\n\nStatus: Accepted\n', false],
            ['a setext title', 'T\n=\n\nStatus: Accepted\n', false],
            ['no status line at all', '# 0001 — No status line\n\nAccepted.\n', false],
            ['an empty file', '', false],
        ])('reads an ADR with %s as Accepted: %s', (_shape, text, accepted) => {
            expect(isAcceptedAdr(text)).toBe(accepted);
        });

        it('takes the line right after the title as the status, and nothing further down', () => {
            expect(adrStatusLine('# T\n\nStatus: Proposed — x\r\n\nStatus: Accepted\n')).toBe('Status: Proposed — x');
            expect(adrStatusLine('# T\n\n<!--\nStatus: Accepted\n-->\nStatus: Proposed\n')).toBeNull();
            expect(adrStatusLine('# T\n')).toBeNull();
            expect(isAcceptedAdr(fs.readFileSync(path.join(FIXTURE_ROOT, PROPOSED_ADR), 'utf8'))).toBe(false);
            expect(isAcceptedAdr(fs.readFileSync(path.join(FIXTURE_ROOT, FIXTURE_ADR), 'utf8'))).toBe(true);
        });

        it('reads every ADR in this repository as Accepted exactly when its index says so', () => {
            const index = fs.readFileSync(path.join(REPO_ROOT, 'docs/adr/README.md'), 'utf8');
            const rows = [...index.matchAll(/^\| \[(\d{4})\]\(([^)]+)\) \| [^|]+ \| ([^|]+) \|/gm)];
            expect(rows.length).toBeGreaterThan(0);
            for (const [, number, file, status] of rows) {
                const text = fs.readFileSync(path.join(REPO_ROOT, 'docs/adr', file as string), 'utf8');
                expect({ number, accepted: isAcceptedAdr(text) }).toEqual({ number, accepted: (status as string).startsWith('Accepted') });
            }
        });
    });
});

describe('the import scan', () => {
    const violations = readFixture('sources/violations.ts');
    const lines = violations.split('\n');
    const lineOf = (needle: string) => {
        const index = lines.findIndex((line) => line.includes(needle));
        if (index === -1) throw new Error(`no line holds ${needle}`);
        return index + 1;
    };
    const result = scanSourceText(violations, 'violations.ts');

    it.each([
        ["'posthog-node/ee/flags'", 'EE_PATH', 'from'],
        ["'@acme/sdk/ee'", 'EE_PATH', 'from'],
        ["'../vendor/ee/side-effect'", 'EE_PATH', 'import'],
        ["import('./ee/lazy-module')", 'EE_PATH', 'import()'],
        ['const legacy', 'EE_PATH', 'require()'],
        ['import.meta.resolve', 'EE_PATH', 'import.meta.resolve()'],
        ["from 'n8n'", 'DENIED_PACKAGE', 'from'],
        ["'hyperformula/es'", 'DENIED_PACKAGE', 'from'],
        ["'@blocknote/xl-ai'", 'DENIED_PACKAGE', 'from'],
        ["require('handsontable')", 'DENIED_PACKAGE', 'require()'],
        ["require.resolve('planby')", 'DENIED_PACKAGE', 'require.resolve()'],
        ['`@liveblocks/server`', 'DENIED_PACKAGE', 'import()'],
        ['`windmill-components/', 'DENIED_PACKAGE', 'import()'],
        ['`@blocknote/xl-', 'DENIED_PACKAGE', 'import()'],
    ])('flags %s as %s at its line', (needle, code, kind) => {
        expect(result.failures).toContainEqual(expect.objectContaining({ line: lineOf(needle), code, kind }));
    });

    it('flags nothing else in that file', () => {
        expect(result.failures).toHaveLength(14);
        expect(result.notices).toEqual([]);
    });

    it('flags nothing in a file of look-alikes: comments, strings, regexes, JSX text, near-miss names', () => {
        const scanned = scanSourceText(readFixture('sources/clean.tsx'), 'clean.tsx');
        expect({ failures: scanned.failures, notices: scanned.notices }).toEqual({ failures: [], notices: [] });
    });

    it('notices every computed specifier it cannot check, relative ones included, rather than passing it silently', () => {
        const scanned = scanSourceText(
            [
                'const a = await import(name);',
                'const b = import(`${base}/x`);',
                'const c = require(`./locales/${locale}.json`);',
                "const d = import('./plugins/' + plugin);",
            ].join('\n'),
        );
        expect(scanned.failures).toEqual([]);
        expect(scanned.notices.map((n) => `${n.line} ${n.code}`)).toEqual(['1 COMPUTED_SPECIFIER', '2 COMPUTED_SPECIFIER', '3 COMPUTED_SPECIFIER', '4 COMPUTED_SPECIFIER']);
    });

    // Each of these loads ee code or a deny-listed package when Node or a
    // bundler runs it, and each once passed the scan silently.
    it.each<[string, string, string]>([
        ['a \\x escape', 'import x from "../vendor/\\x65e/feature.mjs";', 'EE_PATH'],
        ['a \\u escape', 'import x from "../vendor/\\u0065e/feature.mjs";', 'EE_PATH'],
        ['a \\u{} escape', 'import x from "../vendor/\\u{65}e/feature.mjs";', 'EE_PATH'],
        ['a percent-encoded segment', 'import x from "./vendor/e%65/feature.mjs";', 'EE_PATH'],
        ['a concatenation', 'const m = require("hyperform" + "ula");', 'DENIED_PACKAGE'],
        ['a concatenation that spells /ee/', "const m = import('../e' + 'e/x');", 'EE_PATH'],
        ['an escape in a package name', 'const m = require("hyperformul\\x61");', 'DENIED_PACKAGE'],
        ['a line continuation', "const m = require('hyper\\\nformula');", 'DENIED_PACKAGE'],
        ['a parenthesised argument', 'require(("hyperformula"));', 'DENIED_PACKAGE'],
        ['optional call', 'const m = require?.("hyperformula");', 'DENIED_PACKAGE'],
        ['an alias of require', 'const r = require; r("hyperformula");', 'DENIED_PACKAGE'],
        ['an escaped identifier', '\\u0072equire("hyperformula");', 'DENIED_PACKAGE'],
        ['module.require', 'module.require("hyperformula");', 'DENIED_PACKAGE'],
        ['a template whose substitution is a literal', "import(`../e${'e'}/x`);", 'EE_PATH'],
        ['createRequire, called at once', "import { createRequire } from 'node:module'; createRequire(import.meta.url)('hyperformula');", 'DENIED_PACKAGE'],
        ['createRequire, bound', "import { createRequire as make } from 'node:module'; const req = make(import.meta.url); req('hyperformula');", 'DENIED_PACKAGE'],
        ['require.context', "const ctx = require.context('../vendor/posthog/ee', true);", 'EE_PATH'],
        ['import.meta.webpackContext', "const ctx = import.meta.webpackContext('../vendor/posthog/ee', {});", 'EE_PATH'],
        ['new URL(…, import.meta.url)', "new Worker(new URL('../vendor/posthog/ee/worker.js', import.meta.url));", 'EE_PATH'],
        ["n8n's .ee. file convention", "import l from './license.ee.js';", 'EE_PATH'],
        ["n8n's .ee directory convention", "import s from './sso.ee/index';", 'EE_PATH'],
    ])('flags %s', (_label, source, code) => {
        expect(scanSourceText(source, 'x.mjs').failures.map((f) => f.code)).toEqual([code]);
    });

    it('reads JSX text as text, so a backtick or "/*" in it does not hide the imports after it', () => {
        for (const file of ['sources/jsx-backtick.tsx', 'sources/jsx-comment.tsx']) {
            const scanned = scanSourceText(readFixture(file), file);
            expect(scanned.failures.map((f) => `${f.line} ${f.code}`)).toEqual(['2 EE_PATH', '3 DENIED_PACKAGE']);
        }
    });

    it('reads a slash after an object literal as division, so it does not hide the call after it', () => {
        const scanned = scanSourceText(readFixture('sources/division.js'), 'division.js');
        expect(scanned.failures.map((f) => `${f.line} ${f.code}`)).toEqual(['2 DENIED_PACKAGE']);
    });

    it.each([
        ['a template literal', "const s = `abc;\nimport 'n8n';"],
        ['a block comment', "const s = 1; /* abc\nimport 'n8n';"],
        ['a JSX element', "const el = <div>\n<p>Press `</p>\nimport 'n8n';"],
        ['a brace', "function f() {\n  return 1;\nimport 'n8n';"],
    ])('fails a file whose %s never closes, rather than skipping the rest of it', (_label, source) => {
        const codes = scanSourceText(source, 'x.tsx').failures.map((f) => f.code);
        expect(codes).toContain('UNPARSEABLE');
    });

    it('reads TypeScript type parameters at the start of an expression, in a .tsx file, without failing', () => {
        expect(scanSourceText("const id = <T,>(x: T) => x;\ntype F = <T>(x: T) => T;\nimport 'n8n';", 'x.tsx').failures.map((f) => f.code)).toEqual([
            'DENIED_PACKAGE',
        ]);
    });

    it('marks type-only imports, which ship nothing', () => {
        const { specifiers } = scanSourceText(
            [
                "import type { A } from 'a';",
                "import { type B } from 'b';",
                "import { type C, d } from 'c';",
                "export type { E } from 'e';",
                "import f from 'f';",
                "import type G from 'g';",
                "type Q = typeof import('q');",
                "import type, { h } from 'h';",
            ].join('\n'),
            'x.ts',
        );
        expect(specifiers.map((s) => `${s.specifier}${s.typeOnly ? ' type' : ''}`)).toEqual(['a type', 'b type', 'c', 'e type', 'f', 'g type', 'q type', 'h']);
    });

    it('reads stylesheet imports, comments excepted', () => {
        const { specifiers, problems } = extractStyleSpecifiers(
            [
                "@import 'tailwindcss';",
                '/* @import "hyperformula/styles.css"; */',
                '@import url("./base.css") layer(base);',
                '@plugin "@acme/plugin";',
                '@use "../vendor/\\65 e/mixins";',
                '@import url(theme.css);',
            ].join('\n'),
        );
        expect(problems).toEqual([]);
        expect(specifiers.map((s) => `${s.line} ${s.kind} ${s.specifier}`)).toEqual([
            '1 @import tailwindcss',
            '3 @import ./base.css',
            '4 @plugin @acme/plugin',
            '5 @use ../vendor/ee/mixins',
            '6 @import theme.css',
        ]);
        expect(scanSourceText('/* never closed\n@import "x";', 'x.css').failures.map((f) => f.code)).toEqual(['UNPARSEABLE']);
    });

    it("reads MDX's import and export blocks, and not code inside a fence", () => {
        const { specifiers } = extractMdxSpecifiers(
            [
                "import Chart from '../components/chart';",
                '',
                "Prose that mentions import('hyperformula') is not code.",
                '',
                '```js',
                "import 'n8n';",
                '```',
                '',
                "export { meta } from './meta';",
            ].join('\n'),
        );
        expect(specifiers.map((s) => `${s.line} ${s.specifier}`)).toEqual(['1 ../components/chart', '9 ./meta']);
    });

    it('checks the static parts of a computed specifier', () => {
        expect(scanSourceText('import(`./plugins/ee/${name}`);').failures.map((f) => f.code)).toEqual(['EE_PATH']);
        expect(scanSourceText('import(`hyperformula/${entry}`);').failures.map((f) => f.code)).toEqual(['DENIED_PACKAGE']);
    });

    it('keeps its place across a regex literal, a division and JSX text', () => {
        const text = ["const a = /'/;", 'const b = x / 2; const c = y / 3;', "const el = <p>it's fine</p>;", "import z from 'n8n';"].join('\n');
        expect(scanSourceText(text).failures).toEqual([expect.objectContaining({ line: 4, code: 'DENIED_PACKAGE' })]);
    });

    it('reads a regex literal as a regex, not as code or as the start of a string', () => {
        // Read as code, this regex would hold an import of n8n.
        expect(scanSourceText("const looksLikeCode = /import('n8n')/;").failures).toEqual([]);
        // Read as code, the quote would open a string that hides the import after it.
        expect(scanSourceText("const quote = /'/; const lazy = import('hyperformula');").failures).toEqual([
            expect.objectContaining({ line: 1, code: 'DENIED_PACKAGE', kind: 'import()' }),
        ]);
        // After an identifier, a slash divides.
        expect(scanSourceText("const n = total / 2; import('./ee/x'); const m = n / 3;").failures.map((f) => f.code)).toEqual(['EE_PATH']);
    });

    it('matches deny-list names whole, or by the prefix a pattern names', () => {
        expect(isDeniedPackage('n8n')).toBe(true);
        // n8n's libraries ship under their own names, under the Sustainable Use licence.
        for (const name of ['n8n-workflow', 'n8n-core', '@n8n/config', '@n8n/n8n-nodes-langchain']) expect(isDeniedPackage(name)).toBe(true);
        expect(isDeniedPackage('n8nx')).toBe(false);
        // Windmill's AGPL UI is denied; the npm package "windmill" is an unrelated BSD blog engine.
        expect(isDeniedPackage('windmill-components')).toBe(true);
        expect(isDeniedPackage('windmill')).toBe(false);
        expect(isDeniedPackage('task-master-ai')).toBe(true);
        expect(isDeniedPackage('@handsontable/react')).toBe(true);
        expect(isDeniedPackage('@blocknote/xl-ai')).toBe(true);
        expect(isDeniedPackage('@blocknote/core')).toBe(false);
        expect(isDeniedPackage('@liveblocks/server')).toBe(true);
        expect(isDeniedPackage('@liveblocks/client')).toBe(false);
    });

    it('does not let an exemption lift a deny-listed n8n library', () => {
        const exemption: Exemption = {
            name: 'n8n-workflow',
            licence: 'LicenseRef-n8n-sustainable-use',
            licenceKey: 'licenseref-n8n-sustainable-use',
            reason: 'Fixture: an exemption for a deny-listed package.',
            adr: FIXTURE_ADR,
            versions: ['1.0.0'],
        };
        const result = judge({ license: 'SEE LICENSE IN LICENSE.md' }, 'n8n-workflow', new Map([['n8n-workflow', exemption]]));
        expect(result).toMatchObject({ verdict: 'fail', code: 'DENY_LISTED' });
    });

    it('finds an ee folder by segment or by n8n\'s .ee convention, and not in look-alikes', () => {
        for (const yes of ['posthog-node/ee/flags', '../ee', 'n8n-core/dist/sso.ee/index.js', './License.ee.ts', 'x/ee?raw']) expect(hasEePath(yes)).toBe(true);
        for (const no of ['./fee/index', 'ee/sub', './tree/ee-utils', './coffee.eex', 'https://cdn.example.ee/x.js', './employee.ts']) expect(hasEePath(no)).toBe(false);
    });
});

describe('which files the import scan reads', () => {
    it.each<[string, boolean]>([
        ['src/app/page.tsx', true],
        ['src/app/globals.css', true],
        ['src/content/guide.mdx', true],
        ['packages/ui/src/button.tsx', true],
        ['scripts/licence-gate.mjs', true],
        ['next.config.ts', true],
        ['eslint.config.mjs', true],
        ['app/page.tsx', true],
        ['lib/sheet.ts', true],
        ['vendor/lib.js', true],
        ['prisma/seed.ts', true],
        ['tests/unit/licence-gate.test.ts', true],
        ['tests/fixtures/licence-gate/sources/violations.ts', false],
        ['src/data.json', false],
        ['docs/ROADMAP.md', false],
        ['packages/ui/node_modules/x/index.js', false],
    ])('%s: %s', (file, scanned) => {
        expect(isScannedSourcePath(file)).toBe(scanned);
    });

    it.each<[string, boolean]>([
        ['tests/unit/x.test.ts', true],
        ['tests', true],
        ['eslint.config.mjs', true],
        ['playwright.config.ts', true],
        ['src/tests/x.ts', false],
        ['testsuite/x.ts', false],
        ['next.config.ts', false],
        ['scripts/licence-gate.mjs', false],
    ])('%s is dev-only: %s', (file, devOnly) => {
        expect(devOnlyEntry(file) !== null).toBe(devOnly);
    });

    it("takes the real repository's population from git and leaves only the gate's fixtures out", () => {
        const files = listSourceFiles(REPO_ROOT);
        expect(files).toEqual(
            expect.arrayContaining(['scripts/licence-gate.mjs', 'src/env.ts', 'src/app/globals.css', 'next.config.ts', 'tests/unit/licence-gate.test.ts']),
        );
        expect(files.filter((f) => f.startsWith('tests/fixtures/licence-gate/'))).toEqual([]);
        // The fixtures do break the policy, so leaving them out is load-bearing.
        expect(scanSources(REPO_ROOT, ['tests/fixtures/licence-gate/sources/violations.ts']).failures).toHaveLength(14);
    });

    it('reads tsconfig.json with comments and trailing commas', () => {
        expect(parseJsonc('{\n  // a comment\n  "a": "//not a comment", /* b */ "c": [1, 2,],\n}')).toEqual({ a: '//not a comment', c: [1, 2] });
    });
});

describe('the command line', () => {
    const roots: string[] = [];
    afterAll(() => {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    });

    /** The package.json npm would have written beside a lockfile: its root entry's manifest fields. */
    function manifestOf(lockText: string): string {
        const rootEntry = (JSON.parse(lockText) as Lock).packages[''] ?? {};
        const fields = ['name', 'version', 'license', 'workspaces', 'dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'devDependencies'];
        return JSON.stringify(Object.fromEntries(fields.filter((f) => f in rootEntry).map((f) => [f, rootEntry[f]])), null, 2);
    }

    /**
     * A throwaway repository. Unless the files name one, its package.json is
     * the one its lockfile describes, so the two agree.
     */
    function plant(files: Record<string, string>, { git = true } = {}): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-licence-gate-'));
        roots.push(root);
        if (git) execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const lock = files['npm-shrinkwrap.json'] ?? files['package-lock.json'];
        const all = lock !== undefined && !('package.json' in files) ? { 'package.json': manifestOf(lock), ...files } : files;
        for (const [relative, content] of Object.entries(all)) {
            fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
            fs.writeFileSync(path.join(root, relative), content);
        }
        return root;
    }

    function report(root: string): GateReport & { status: number | null } {
        const result = run(root, '--json');
        return { ...(JSON.parse(result.stdout) as GateReport), status: result.status };
    }

    /** A lockfile whose root has the given production and dev dependencies, each a made-up package. */
    function lockWith(
        packages: Record<string, { license: string; dev?: boolean; name?: string; version?: string }>,
        { dependencies = {}, devDependencies = {} }: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {},
    ): string {
        const entries: Record<string, LockEntry> = {
            '': { name: 'fixture-app', version: '1.0.0', license: 'UNLICENSED', dependencies, devDependencies },
        };
        for (const [location, p] of Object.entries(packages)) {
            entries[`node_modules/${location}`] = { ...(p.name ? { name: p.name } : {}), version: p.version ?? '1.0.0', ...(p.dev ? { dev: true } : {}), license: p.license };
        }
        return JSON.stringify({ name: 'fixture-app', version: '1.0.0', lockfileVersion: 3, requires: true, packages: entries }, null, 2);
    }

    const codes = (r: GateReport) =>
        [...r.dependencies.failures.map((f) => `${f.code} ${f.name ?? (f.location || '(root)')}`), ...r.sources.failures.map((f) => `${f.code} ${f.file}`)].sort();

    function run(root: string, ...args: string[]) {
        return spawnSync(process.execPath, [GATE, '--root', root, ...args], { encoding: 'utf8', env: gitEnvFor() });
    }

    const lockText = (name: string) => readFixture(`lockfiles/${name}.lock.json`);
    const adrText = fs.readFileSync(path.join(FIXTURE_ROOT, FIXTURE_ADR), 'utf8');
    const benign = "export const ok = 1;\n";

    it('exits 1 on a planted GPL-3.0 dependency and names it, in both output formats', () => {
        const root = plant({ 'package-lock.json': lockText('planted-gpl'), 'src/index.ts': benign });
        const human = run(root);
        expect(human.status).toBe(1);
        expect(human.stdout).toContain('Licence gate: FAIL');
        expect(human.stdout).toContain('FAIL  fixture-gpl-lib@1.0.0  [NOT_ALLOWED]');
        expect(human.stdout).toContain('reached through: fixture-mit-lib > fixture-gpl-lib');
        const json = run(root, '--json');
        expect(json.status).toBe(1);
        const report = JSON.parse(json.stdout) as { ok: boolean; dependencies: { failures: { name: string }[] } };
        expect(report.ok).toBe(false);
        expect(report.dependencies.failures.map((f) => f.name)).toEqual(['fixture-gpl-lib']);
    });

    it('exits 0 when the GPL dependencies are dev-only', () => {
        const root = plant({ 'package-lock.json': lockText('dev-only-gpl'), 'src/index.ts': benign });
        const result = run(root);
        expect(result.stdout).toContain('Licence gate: PASS');
        expect(result.status).toBe(0);
    });

    it('exits 1 on a planted /ee/ import, naming the file and line', () => {
        const root = plant({
            'package-lock.json': lockText('dev-only-gpl'),
            'src/index.ts': benign,
            'packages/ui/src/flags.ts': "export const a = 1;\nexport { flags } from 'posthog-node/ee/flags';\n",
        });
        const result = run(root);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('FAIL  packages/ui/src/flags.ts:2  [EE_PATH]');
    });

    it("leaves out files git ignores and the gate's own fixtures", () => {
        const root = plant({
            'package-lock.json': lockText('dev-only-gpl'),
            '.gitignore': 'src/generated/\n',
            'src/generated/client.ts': "import 'hyperformula';\n",
            'tests/fixtures/licence-gate/sources/violations.ts': violationsCopy(),
            'src/index.ts': benign,
        });
        const result = run(root, '--json');
        expect(result.status).toBe(0);
        const report = JSON.parse(result.stdout) as { sources: { files: string[] } };
        expect(report.sources.files).toEqual(['src/index.ts']);
    });

    it('reads scripts/licence-exemptions.json, or the file --exemptions names', () => {
        const exemptions = JSON.stringify({
            'fixture-gpl-lib': { licence: 'GPL-3.0', reason: 'Fixture: decided in ADR 0099.', adr: FIXTURE_ADR },
        });
        const root = plant({
            'package-lock.json': lockText('planted-gpl'),
            'src/index.ts': benign,
            [FIXTURE_ADR]: adrText,
            'scripts/licence-exemptions.json': exemptions,
            'config/other-exemptions.json': '{}',
        });
        const byDefault = run(root);
        expect(byDefault.stdout).toContain('EXEMPT  fixture-gpl-lib@1.0.0  as GPL-3.0  (docs/adr/0099-fixture-exemption.md)');
        expect(byDefault.status).toBe(0);
        expect(run(root, '--exemptions', 'config/other-exemptions.json').status).toBe(1);
    });

    it('reads an installed package.json when the lockfile has no licence', () => {
        const manifests = JSON.parse(readFixture('installed-manifests.json')) as Record<string, unknown>;
        const lock = {
            lockfileVersion: 3,
            packages: {
                '': { name: 'fixture-app', license: 'UNLICENSED', dependencies: { 'fixture-no-licence-recorded': '1.0.0' } },
                'node_modules/fixture-no-licence-recorded': { version: '1.0.0' },
            },
        };
        const root = plant({
            'package-lock.json': JSON.stringify(lock),
            'node_modules/fixture-no-licence-recorded/package.json': JSON.stringify(manifests['node_modules/fixture-no-licence-recorded']),
            'src/index.ts': benign,
        });
        const result = run(root, '--json');
        expect(result.status).toBe(0);
        const report = JSON.parse(result.stdout) as { dependencies: { packages: PackageRecord[] } };
        expect(report.dependencies.packages).toEqual([
            expect.objectContaining({ name: 'fixture-no-licence-recorded', licenceSource: 'installed', verdict: 'pass' }),
        ]);
    });

    it('fails when the lockfile root entry was edited to hide a production dependency that package.json declares', () => {
        const honest = lockText('planted-gpl');
        const tampered = JSON.parse(honest) as Lock;
        Object.assign(entry(tampered, ''), { dependencies: undefined, devDependencies: { 'fixture-dev-tool': '1.0.0', 'fixture-mit-lib': '1.0.0' } });
        entry(tampered, 'node_modules/fixture-mit-lib').dev = true;
        entry(tampered, 'node_modules/fixture-gpl-lib').dev = true;
        const root = plant({ 'package.json': manifestOf(honest), 'package-lock.json': JSON.stringify(tampered), 'src/index.ts': benign });
        const r = report(root);
        expect(r.status).toBe(1);
        expect(codes(r)).toEqual(['MANIFEST_LOCK_MISMATCH (root)', 'NOT_ALLOWED fixture-gpl-lib']);
    });

    it('reads npm-shrinkwrap.json when it exists, because npm installs from it', () => {
        const root = plant({
            'npm-shrinkwrap.json': lockText('planted-gpl'),
            // A clean but stale package-lock.json beside it is ignored by npm, so by the gate too.
            'package-lock.json': lockText('dev-only-gpl'),
            'src/index.ts': benign,
        });
        const r = report(root);
        expect(r.status).toBe(1);
        expect(r.lockfile).toBe('npm-shrinkwrap.json');
        expect(codes(r)).toEqual(['NOT_ALLOWED fixture-gpl-lib']);
        expect(r.dependencies.notices.map((n) => n.code)).toContain('SHRINKWRAP');
    });

    it('fails "MIT WITH Commons-Clause", and task-master-ai by name', () => {
        const root = plant({
            'package-lock.json': lockWith(
                { 'task-master-ai': { license: 'MIT WITH Commons-Clause' }, 'fixture-clause': { license: 'Apache-2.0 WITH Commons-Clause' } },
                { dependencies: { 'task-master-ai': '1.0.0', 'fixture-clause': '1.0.0' } },
            ),
            'src/index.ts': benign,
        });
        const r = report(root);
        expect(r.status).toBe(1);
        expect(codes(r)).toEqual(['DENY_LISTED task-master-ai', 'UNKNOWN_EXCEPTION fixture-clause']);
    });

    it('checks a dev dependency that code which can ship imports, by its real name through an alias, CSS included', () => {
        const lock = lockWith(
            {
                'gpl-grid': { license: 'GPL-3.0-only', dev: true },
                sheet: { name: 'hyperformula', version: '3.0.0', license: 'GPL-3.0-only', dev: true },
                'gpl-theme': { license: 'GPL-3.0-only', dev: true },
                'gpl-types': { license: 'GPL-3.0-only', dev: true },
                'gpl-test-helper': { license: 'GPL-3.0-only', dev: true },
                'fixture-mit-lib': { license: 'MIT' },
            },
            {
                dependencies: { 'fixture-mit-lib': '1.0.0' },
                devDependencies: { 'gpl-grid': '1.0.0', sheet: 'npm:hyperformula@3.0.0', 'gpl-theme': '1.0.0', 'gpl-types': '1.0.0', 'gpl-test-helper': '1.0.0' },
            },
        );
        const root = plant({
            'package-lock.json': lock,
            'src/app/page.tsx': "'use client';\nimport { Grid } from 'gpl-grid';\nimport Sheet from 'sheet';\nimport type { T } from 'gpl-types';\nexport const used = [Grid, Sheet] as unknown as T;\n",
            'src/app/globals.css': "@import 'gpl-theme/base.css';\n",
            // Test code is dev-only: what it imports does not ship.
            'tests/unit/grid.test.ts': "import { helper } from 'gpl-test-helper';\nexport const h = helper;\n",
        });
        const r = report(root);
        expect(r.status).toBe(1);
        expect(codes(r)).toEqual(['DENIED_PACKAGE src/app/page.tsx', 'DENY_LISTED hyperformula', 'NOT_ALLOWED gpl-grid', 'NOT_ALLOWED gpl-theme']);
        const grid = r.dependencies.failures.find((f) => f.name === 'gpl-grid');
        expect(grid?.chain).toEqual(['src/app/page.tsx', 'gpl-grid']);
    });

    it('fails an import of a package the lockfile does not hold, from code that can ship', () => {
        const root = plant({
            'package-lock.json': lockText('dev-only-gpl'),
            'src/index.ts': "import 'server-only';\nimport { x } from 'not-installed';\nimport fs from 'node:fs';\nexport const used = [x, fs];\n",
        });
        const r = report(root);
        expect(codes(r)).toEqual(['UNRESOLVED_IMPORT src/index.ts']);
    });

    it('scans every directory, and fails code that can ship when it imports test code', () => {
        const root = plant({
            'package-lock.json': lockText('dev-only-gpl'),
            'src/app/page.tsx': "import { sheet } from '../../lib/sheet';\nimport { flags } from '../../tests/support/flags';\nexport const used = [sheet, flags];\n",
            'lib/sheet.ts': "export { sheet } from '../vendor/posthog/ee/feature-flags';\n",
            'app/page.tsx': "import HyperFormula from 'hyperformula';\nexport default HyperFormula;\n",
            'tests/support/flags.ts': "export * from '../../vendor/growthbook/ee/flags';\n",
            'vendor/posthog/ee/feature-flags.ts': 'export const sheet = 1;\n',
            'vendor/growthbook/ee/flags.ts': 'export const flags = 1;\n',
        });
        const r = report(root);
        expect(r.status).toBe(1);
        expect(codes(r)).toEqual([
            'DENIED_PACKAGE app/page.tsx',
            'EE_PATH lib/sheet.ts',
            'EE_PATH tests/support/flags.ts',
            'IMPORTS_DEV_ONLY_PATH src/app/page.tsx',
            // Not installed either, so its licence cannot be read.
            'UNRESOLVED_IMPORT app/page.tsx',
        ]);
    });

    it('follows #imports and tsconfig paths to where they point', () => {
        const manifest = JSON.stringify({
            name: 'fixture-app',
            version: '1.0.0',
            license: 'UNLICENSED',
            dependencies: { 'fixture-mit-lib': '1.0.0' },
            devDependencies: { 'fixture-dev-gpl': '1.0.0' },
            imports: { '#flags': './vendor/posthog/ee/flags.mjs', '#sheet': { node: 'hyperformula', default: './src/sheet.ts' } },
        });
        const root = plant({
            'package.json': manifest,
            'package-lock.json': lockText('dev-only-gpl'),
            'tsconfig.json': '{\n  // aliases\n  "compilerOptions": { "paths": { "~ee/*": ["./vendor/ee/*"], "@/*": ["./src/*"], }, },\n}\n',
            'scripts/worker.mjs': "import { flags } from '#flags';\nimport sheet from '#sheet';\nimport { gone } from '#missing';\nexport const used = [flags, sheet, gone];\n",
            'src/index.ts': "import { x } from '~ee/x';\nimport { y } from '@/y';\nexport const used = [x, y];\n",
        });
        const r = report(root);
        expect(r.status).toBe(1);
        expect(codes(r)).toEqual([
            // #sheet names hyperformula under the "node" condition.
            'DENIED_PACKAGE scripts/worker.mjs',
            // #flags points into an ee folder its own name does not mention.
            'EE_PATH scripts/worker.mjs',
            // So does the tsconfig alias ~ee/*.
            'EE_PATH src/index.ts',
            // #missing matches no "imports" entry.
            'UNRESOLVED_IMPORT scripts/worker.mjs',
            // hyperformula, reached through #sheet, is not installed.
            'UNRESOLVED_IMPORT scripts/worker.mjs',
        ]);
    });

    it('fails a file the scanner cannot read to the end', () => {
        const root = plant({ 'package-lock.json': lockText('dev-only-gpl'), 'src/index.ts': "const s = `never closed;\nimport 'n8n';\n" });
        const r = report(root);
        expect(r.status).toBe(1);
        expect(codes(r)).toEqual(['UNPARSEABLE src/index.ts']);
    });

    it("judges a workspace by its package.json, not by a stale lockfile's licence", () => {
        const lock = {
            name: 'fixture-app',
            version: '1.0.0',
            lockfileVersion: 3,
            requires: true,
            packages: {
                '': { name: 'fixture-app', version: '1.0.0', license: 'UNLICENSED', workspaces: ['packages/*'] },
                'node_modules/@fixture/ui': { resolved: 'packages/ui', link: true },
                'packages/ui': { name: '@fixture/ui', version: '1.0.0', license: 'UNLICENSED' },
            },
        };
        const root = plant({
            'package-lock.json': JSON.stringify(lock),
            // A ported BUSL-1.1 package replaced the workspace; nobody ran npm install.
            'packages/ui/package.json': JSON.stringify({ name: '@fixture/ui', version: '1.0.0', license: 'BUSL-1.1' }),
            'packages/ui/index.ts': benign,
        });
        const r = report(root);
        expect(r.status).toBe(1);
        expect(codes(r)).toEqual(['MANIFEST_LOCK_MISMATCH packages/ui', 'NOT_ALLOWED @fixture/ui']);
    });

    it('refuses an exemption whose ADR does not name the package', () => {
        const root = plant({
            'package-lock.json': lockText('planted-gpl'),
            'src/index.ts': benign,
            [UNRELATED_ADR]: fs.readFileSync(path.join(FIXTURE_ROOT, UNRELATED_ADR), 'utf8'),
            'scripts/licence-exemptions.json': JSON.stringify({ 'fixture-gpl-lib': { licence: 'GPL-3.0', reason: 'Fixture.', adr: UNRELATED_ADR } }),
        });
        const r = report(root);
        expect(r.status).toBe(1);
        expect(r.dependencies.exemptionProblems).toEqual([
            { name: 'fixture-gpl-lib', code: 'EXEMPTION_INVALID', problem: expect.stringContaining('does not mention fixture-gpl-lib') },
        ]);
    });

    it('refuses an exemption whose ADR is not Accepted, and applies it once the ADR is', () => {
        const proposed = fs.readFileSync(path.join(FIXTURE_ROOT, PROPOSED_ADR), 'utf8');
        const root = plant({
            'package-lock.json': lockText('planted-gpl'),
            'src/index.ts': benign,
            [PROPOSED_ADR]: proposed,
            'scripts/licence-exemptions.json': JSON.stringify({ 'fixture-gpl-lib': { licence: 'GPL-3.0', reason: 'Fixture.', adr: PROPOSED_ADR } }),
        });
        const human = run(root);
        expect(human.status).toBe(1);
        expect(human.stdout).toContain('FAIL  fixture-gpl-lib  [ADR_NOT_ACCEPTED]');
        expect(human.stdout).toContain('FAIL  fixture-gpl-lib@1.0.0  [NOT_ALLOWED]');
        expect(report(root).dependencies.exemptionProblems).toEqual([
            { name: 'fixture-gpl-lib', code: 'ADR_NOT_ACCEPTED', problem: expect.stringContaining('not Accepted') },
        ]);

        // A hidden "Status: Accepted" placed above the visible Proposed line does
        // not accept it, whichever Markdown construct hides it: the status is the
        // line right after the title, and here that line is not a status at all.
        for (const hidden of [
            '<!--\nStatus: Accepted\n-->\n',
            '```\n``` x\nStatus: Accepted\n```\n\n',
            'Context\n-------\n\nStatus: Accepted\n\n',
        ]) {
            fs.writeFileSync(path.join(root, PROPOSED_ADR), proposed.replace(/^Status: Proposed/m, `${hidden}Status: Proposed`));
            const hiddenRun = run(root);
            expect(hiddenRun.status).toBe(1);
            expect(report(root).dependencies.exemptionProblems).toEqual([
                { name: 'fixture-gpl-lib', code: 'ADR_NOT_ACCEPTED', problem: expect.stringContaining('not Accepted') },
            ]);
        }

        // Nor is an ADR accepted only in part, or accepted and since superseded.
        for (const qualified of ['Status: Accepted in part — D2 awaits sign-off', 'Status: Accepted — superseded by 0009']) {
            fs.writeFileSync(path.join(root, PROPOSED_ADR), proposed.replace(/^Status: Proposed.*$/m, qualified));
            expect(report(root).dependencies.exemptionProblems).toEqual([
                { name: 'fixture-gpl-lib', code: 'ADR_NOT_ACCEPTED', problem: expect.stringContaining(`"${qualified}", not Accepted`) },
            ]);
        }

        // An ADR with no status line at all is not Accepted either.
        fs.writeFileSync(path.join(root, PROPOSED_ADR), proposed.replace(/^Status: .*\n/m, ''));
        expect(report(root).dependencies.exemptionProblems).toEqual([
            { name: 'fixture-gpl-lib', code: 'ADR_NOT_ACCEPTED', problem: expect.stringContaining('no "Status:" line') },
        ]);

        // The owner accepts the ADR: the same exemption now applies.
        fs.writeFileSync(path.join(root, PROPOSED_ADR), proposed.replace(/^Status: Proposed.*$/m, 'Status: Accepted — owner decision, 2026-11-18'));
        const accepted = run(root);
        expect(accepted.stdout).toContain('EXEMPT  fixture-gpl-lib@1.0.0  as GPL-3.0  (docs/adr/0097-fixture-proposed.md)');
        expect(accepted.status).toBe(0);
    });

    it("checks a workspace that holds UPSTREAM.json like any dependency, even with the root's BUSL-1.1 licence", () => {
        const lock = {
            name: 'fixture-app',
            version: '1.0.0',
            lockfileVersion: 3,
            requires: true,
            packages: {
                '': { name: 'fixture-app', version: '1.0.0', license: 'BUSL-1.1', workspaces: ['packages/*'] },
                'node_modules/@fixture/ui': { resolved: 'packages/ui', link: true },
                'packages/ui': { name: '@fixture/ui', version: '0.0.0', license: 'BUSL-1.1' },
            },
        };
        const root = plant({
            'package-lock.json': JSON.stringify(lock),
            'packages/ui/package.json': JSON.stringify({ name: '@fixture/ui', version: '0.0.0', license: 'BUSL-1.1' }),
            'packages/ui/src/index.ts': benign,
        });
        // Without UPSTREAM.json the workspace is Islestone's own code.
        const own = report(root);
        expect(own.status).toBe(0);
        expect(own.dependencies.skipped.map((s) => s.name)).toEqual(['fixture-app', '@fixture/ui']);

        // A mirror is another project's code, so BUSL-1.1 is not on the allowlist for it.
        fs.writeFileSync(path.join(root, 'packages/ui/UPSTREAM.json'), '{}\n');
        const mirror = report(root);
        expect(mirror.status).toBe(1);
        expect(codes(mirror)).toEqual(['NOT_ALLOWED @fixture/ui']);
        expect(mirror.dependencies.notices.map((n) => n.code)).toContain('UPSTREAM_MIRROR');

        // Hiding the file from git does not hide the mirror.
        fs.writeFileSync(path.join(root, '.gitignore'), 'packages/ui/UPSTREAM.json\n');
        expect(codes(report(root))).toEqual(['NOT_ALLOWED @fixture/ui']);
    });

    it('exits 2, saying why, when it cannot run', () => {
        const notGit = plant({ 'package-lock.json': lockText('dev-only-gpl') }, { git: false });
        const outsideGit = run(notGit);
        expect(outsideGit.status).toBe(2);
        expect(outsideGit.stderr).toContain('needs a git work tree');

        const noLockfile = plant({ 'src/index.ts': benign });
        expect(run(noLockfile).status).toBe(2);
        const asJson = run(noLockfile, '--json');
        expect(asJson.status).toBe(2);
        expect(JSON.parse(asJson.stdout)).toEqual({ ok: false, error: expect.stringContaining('the lockfile') });

        const withLock = plant({ 'package-lock.json': lockText('dev-only-gpl') });
        expect(run(withLock, '--exemptions', 'nowhere.json').stderr).toContain('does not exist');

        const noManifest = plant({ 'package-lock.json': lockText('dev-only-gpl'), 'package.json': '' });
        fs.rmSync(path.join(noManifest, 'package.json'));
        const missingManifest = run(noManifest);
        expect(missingManifest.status).toBe(2);
        expect(missingManifest.stderr).toContain('no package.json');

        const badArgument = run(withLock, '--strict');
        expect(badArgument.status).toBe(2);
        expect(badArgument.stderr).toContain('unknown argument "--strict"');
        expect(badArgument.stderr).toContain('Usage:');
    });

    it('prints its usage with --help', () => {
        const result = spawnSync(process.execPath, [GATE, '--help'], { encoding: 'utf8' });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Exit status: 0 pass, 1 policy problems found, 2 the gate could not run.');
    });

    function violationsCopy(): string {
        return readFixture('sources/violations.ts');
    }
});
