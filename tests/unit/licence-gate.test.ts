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

import type { Exemption, PackageRecord } from '../../scripts/licence-gate.mjs';
import {
    ALLOWED_LICENCES,
    checkDependencies,
    DATA_ONLY_LICENCES,
    declarationKey,
    DENIED_PACKAGES,
    GateError,
    isDeniedPackage,
    isScannedSourcePath,
    judgePackage,
    listProductionPackages,
    listSourceFiles,
    NOTICE_LICENCES,
    normaliseDeclaration,
    scanSources,
    scanSourceText,
    validateExemptions,
} from '../../scripts/licence-gate.mjs';
import { gitEnvFor, REPO_ROOT } from '../helpers/git-files';

const GATE = path.join(REPO_ROOT, 'scripts/licence-gate.mjs');
const FIXTURES = path.join(REPO_ROOT, 'tests/fixtures/licence-gate');
const FIXTURE_ROOT = path.join(FIXTURES, 'root');
const FIXTURE_ADR = 'docs/adr/0099-fixture-exemption.md';

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

    it('reads WITH as adding permissions to an allowed licence, never as making one allowed', () => {
        expect(judge({ license: 'Apache-2.0 WITH LLVM-exception' }).verdict).toBe('pass');
        expect(judge({ license: 'GPL-2.0-only WITH Classpath-exception-2.0' })).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
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
        expect(judge({ license: 'Unlicense' }).verdict).toBe('pass');
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

    it('passes CC-BY-4.0 only for a listed data-only package', () => {
        expect(DATA_ONLY_LICENCES['CC-BY-4.0']).toContain('caniuse-lite');
        const data = judge({ license: 'CC-BY-4.0' }, 'caniuse-lite');
        expect(data.verdict).toBe('pass');
        expect(data.notices.map((n) => n.code)).toEqual(['DATA_ONLY_CC-BY-4.0']);
        const code = judge({ license: 'CC-BY-4.0' }, 'some-code-library');
        expect(code).toMatchObject({ verdict: 'fail', code: 'NOT_ALLOWED' });
        expect(code.reason).toContain('data-only');
        expect(judge({ license: 'MIT OR CC-BY-4.0' }, 'some-code-library').verdict).toBe('pass');
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

    it('fails a deny-listed package in the tree whatever its licence says, and no exemption lifts it', () => {
        expect(DENIED_PACKAGES).toEqual(expect.arrayContaining(['n8n', 'hyperformula', '@blocknote/xl-*']));
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
        ['no licence', { reason: valid.reason, adr: FIXTURE_ADR }, '"licence" is required'],
        ['a licence that is not SPDX', { ...valid, licence: 'GPL v3' }, 'not an SPDX expression'],
        ['an unknown field', { ...valid, reviewBy: '2027-01-01' }, 'unknown field "reviewBy"'],
        ['a blank version', { ...valid, version: '' }, '"version"'],
    ])('does not apply an exemption with %s', (_label, exemption, problem) => {
        const report = check({ 'fixture-gpl-lib': exemption });
        expect(report.failures.map((f) => f.name)).toEqual(['fixture-gpl-lib']);
        expect(report.exemptionProblems).toEqual([{ name: 'fixture-gpl-lib', problem: expect.stringContaining(problem) }]);
    });

    it('refuses an exemptions file that is not one object', () => {
        const report = check([valid]);
        expect(report.exemptionProblems).toEqual([{ name: null, problem: expect.stringContaining('one JSON object') }]);
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

    it('exempts a "SEE LICENSE IN" package with the licence a person read in the file', () => {
        const { entries, errors } = validateExemptions(
            { 'fixture-lib': { licence: 'MIT', reason: 'Fixture: LICENSE.md holds the MIT text.', adr: FIXTURE_ADR } },
            FIXTURE_ROOT,
        );
        expect(errors).toEqual([]);
        expect(judge({ license: 'SEE LICENSE IN LICENSE.md' }, 'fixture-lib', entries).verdict).toBe('exempt');
        expect(judge({ license: 'SEE LICENSE IN LICENSE.md' }, 'other-lib', entries).verdict).toBe('fail');
    });

    it('reports an exemption for a package the tree does not hold', () => {
        const report = check({ 'fixture-gpl-lib': valid, 'left-the-tree': { ...valid, licence: 'MIT' } });
        expect(report.exemptionProblems).toEqual([{ name: 'left-the-tree', problem: expect.stringContaining('stale') }]);
    });

    it('reports an exemption that is not needed', () => {
        const report = check({ 'fixture-gpl-lib': valid, 'fixture-mit-lib': { ...valid, licence: 'MIT' } });
        expect(report.exemptionProblems).toEqual([{ name: 'fixture-mit-lib', problem: expect.stringContaining('not needed') }]);
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
    const result = scanSourceText(violations);

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
        ['`windmill/', 'DENIED_PACKAGE', 'import()'],
        ['`@blocknote/xl-', 'DENIED_PACKAGE', 'import()'],
    ])('flags %s as %s at its line', (needle, code, kind) => {
        expect(result.failures).toContainEqual(expect.objectContaining({ line: lineOf(needle), code, kind }));
    });

    it('flags nothing else in that file', () => {
        expect(result.failures).toHaveLength(14);
        expect(result.notices).toEqual([]);
    });

    it('flags nothing in a file of look-alikes: comments, strings, regexes, JSX text, near-miss names', () => {
        expect(scanSourceText(readFixture('sources/clean.tsx'))).toEqual({ failures: [], notices: [] });
    });

    it('notices a computed specifier it cannot check, rather than passing it silently', () => {
        const scanned = scanSourceText(
            ['const a = await import(name);', 'const b = import(`${base}/x`);', 'const c = require(`./locales/${locale}.json`);'].join('\n'),
        );
        expect(scanned.failures).toEqual([]);
        expect(scanned.notices.map((n) => `${n.line} ${n.code}`)).toEqual(['1 COMPUTED_SPECIFIER', '2 COMPUTED_SPECIFIER']);
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
        expect(isDeniedPackage('n8n-workflow')).toBe(false);
        expect(isDeniedPackage('@blocknote/xl-ai')).toBe(true);
        expect(isDeniedPackage('@blocknote/core')).toBe(false);
        expect(isDeniedPackage('@liveblocks/server')).toBe(true);
        expect(isDeniedPackage('@liveblocks/client')).toBe(false);
    });
});

describe('which files the import scan reads', () => {
    it.each<[string, boolean]>([
        ['src/app/page.tsx', true],
        ['packages/ui/src/button.tsx', true],
        ['scripts/licence-gate.mjs', true],
        ['next.config.ts', true],
        ['eslint.config.mjs', true],
        ['tests/unit/licence-gate.test.ts', false],
        ['tests/fixtures/licence-gate/sources/violations.ts', false],
        ['src/data.json', false],
        ['docs/ROADMAP.md', false],
        ['vendor/lib.js', false],
    ])('%s: %s', (file, scanned) => {
        expect(isScannedSourcePath(file)).toBe(scanned);
    });

    it("takes the real repository's population from git and leaves the gate's fixtures out", () => {
        const files = listSourceFiles(REPO_ROOT);
        expect(files).toEqual(expect.arrayContaining(['scripts/licence-gate.mjs', 'src/env.ts', 'next.config.ts']));
        expect(files.filter((f) => f.startsWith('tests/'))).toEqual([]);
        // The fixtures do break the policy, so leaving them out is load-bearing.
        expect(scanSources(REPO_ROOT, ['tests/fixtures/licence-gate/sources/violations.ts']).failures).toHaveLength(14);
    });
});

describe('the command line', () => {
    const roots: string[] = [];
    afterAll(() => {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    });

    function plant(files: Record<string, string>, { git = true } = {}): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-licence-gate-'));
        roots.push(root);
        if (git) execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        for (const [relative, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
            fs.writeFileSync(path.join(root, relative), content);
        }
        return root;
    }

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
